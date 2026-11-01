#!/usr/bin/env python3
"""Atelier Laser : logiciel autonome pour les lasers xTool P2 et F1 Ultra sous Linux.

L'interface (dossier web/) reprend la disposition de xTool Studio. Elle est
affichée dans une fenêtre GTK 4 + WebKit, ou à défaut dans le navigateur
(option --navigateur). Le G-code, l'envoi, la caméra et le cadrage
réutilisent le code de l'extension Inkscape (xtool_common, xtool_raster).

  atelier_laser.py               ouvre la fenêtre
  atelier_laser.py --navigateur  ouvre l'interface dans le navigateur
"""
import base64
import concurrent.futures
import io
import ipaddress
import json
import math
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import urllib.error
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ICI = os.path.dirname(os.path.realpath(__file__))
RACINE = os.path.dirname(ICI)
sys.path.insert(0, RACINE)

import xtool_common as xc  # noqa: E402

WEB = os.path.join(ICI, "web")
DOSSIER_CONFIG = os.path.join(os.environ.get("XDG_CONFIG_HOME", os.path.expanduser("~/.config")), "atelier-laser")
# materiaux.json est partagé avec l'extension Inkscape. Installé par le paquet
# .deb (dossier non modifiable), il est copié dans la configuration de
# l'utilisateur dès le premier matériau enregistré.
FICHIER_MATERIAUX = os.path.join(RACINE, "materiaux.json")
if not os.access(RACINE, os.W_OK):
    _copie = os.path.join(DOSSIER_CONFIG, "materiaux.json")
    if os.path.exists(_copie):
        FICHIER_MATERIAUX = _copie
FICHIER_REGLAGES = os.path.join(DOSSIER_CONFIG, "reglages.json")
FICHIER_SECOURS = os.path.join(DOSSIER_CONFIG, "secours.alaser")
FICHIER_MESURES = os.path.join(DOSSIER_CONFIG, "mesures.log")

FENETRE = None  # fenêtre GTK, pour les boîtes de dialogue d'enregistrement


# --- G-code -------------------------------------------------------------------

def _image_depuis_data_url(url):
    from PIL import Image
    donnees = base64.b64decode(url.split(",", 1)[1])
    image = Image.open(io.BytesIO(donnees))
    image.load()
    return image


def construire_gcode(travail):
    """travail = {machine, epaisseur, laser, frequence, blocs:[...]}.
    Bloc vectoriel : {type: contour|couper, chemins, puissance, vitesse, passes, air}.
    Bloc gravé : {type: graver, png, x0, y0, res (px/mm), mode, image, puissance,
    puissance_min, vitesse, passes, air}. Renvoie (gcode, résumé)."""
    import numpy as np
    import xtool_raster as xr

    machine = travail.get("machine", "P2")
    if machine not in xc.MACHINES:
        raise ValueError(f"Machine inconnue : {machine}")
    m = xc.MACHINES[machine]
    larg, haut = m["zone"]
    epaisseur = float(travail.get("epaisseur", 3))
    z = xc.z_p2(epaisseur)
    calques, boites = [], []

    for n, b in enumerate(travail.get("blocs", []), start=1):
        p, v = float(b["puissance"]), float(b["vitesse"])
        nom = b.get("nom") or f"Bloc {n}"
        if not 0 < p <= 100:
            raise ValueError(f"{nom} : puissance hors limites ({p:g} %)")
        passes = max(1, int(b.get("passes", 1)))
        air = int(b.get("air", 100))
        if b["type"] == "graver":
            if machine != "P2":
                raise ValueError("La gravure (images, remplissages) n'est disponible que pour la P2 pour l'instant.")
            if not 0 < v <= 600:
                raise ValueError(f"{nom} : vitesse hors limites ({v:g} mm/s, max 600)")
            image = _image_depuis_data_url(b["png"])
            res = float(b["res"])
            mode = b.get("mode", "tramage") if b.get("image") else "seuil"
            s = xr.puissances(image, mode, p, float(b.get("puissance_min", 0)))
            lignes_on, colonnes_on = np.nonzero(s)
            if lignes_on.size == 0:
                continue
            x0, y0 = float(b["x0"]), float(b["y0"])
            boites.append((x0 + colonnes_on.min() / res, y0 + lignes_on.min() / res,
                           x0 + (colonnes_on.max() + 1) / res, y0 + (lignes_on.max() + 1) / res))
            lignes = xr.bloc_p2(s, x0, y0, res, v, p, z, air,
                                type_="image" if b.get("image") else "remplissage",
                                mode=mode, x_max=larg, passes=passes)
            calques.append({"lignes": lignes, "puissance": p, "vitesse": v})
        else:
            if not 0 < v <= m["vitesse_max"]:
                raise ValueError(f"{nom} : vitesse hors limites ({v:g} mm/s, max {m['vitesse_max']:g})")
            chemins = [[(float(x), float(y)) for x, y in ch] for ch in b["chemins"] if len(ch) >= 2]
            if not chemins:
                continue
            pts = [q for ch in chemins for q in ch]
            boites.append((min(q[0] for q in pts), min(q[1] for q in pts),
                           max(q[0] for q in pts), max(q[1] for q in pts)))
            calques.append({"chemins": chemins, "puissance": p, "vitesse": v, "passes": passes, "air": air,
                            "type": "decoupe" if b["type"] == "couper" else "marquage"})

    if not calques:
        raise ValueError("Rien à traiter : aucun objet à graver, marquer ou couper.")
    xmin, ymin = min(b[0] for b in boites), min(b[1] for b in boites)
    xmax, ymax = max(b[2] for b in boites), max(b[3] for b in boites)
    if xmin < -0.01 or ymin < -0.01 or xmax > larg + 0.01 or ymax > haut + 0.01:
        raise ValueError(f"Le dessin dépasse la zone de la {m['nom']} ({larg:g} × {haut:g} mm) : "
                         f"X {xmin:.1f} à {xmax:.1f}, Y {ymin:.1f} à {ymax:.1f} mm.")
    if machine == "P2":
        gcode = xc.gcode_p2(calques, epaisseur=epaisseur)
    else:
        gcode = xc.gcode_f1u(calques, laser=travail.get("laser", "bleu"),
                             frequence=int(travail.get("frequence", 30)))
    resume = {"zone": [round(xmin, 2), round(ymin, 2), round(xmax, 2), round(ymax, 2)],
              "duree": estimer_duree(gcode), "taille": len(gcode), "z": z}
    return gcode, resume


def estimer_duree(gcode):
    """Durée approchée en secondes (distances / vitesses, sans accélérations)."""
    x = y = 0.0
    f1, f0 = 1000.0, 9600.0
    total = 0.0
    nombre = re.compile(r"([XYFZ])(-?[\d.]+)")
    for ligne in gcode.splitlines():
        if not ligne.startswith(("G0", "G1")) or ligne.startswith(("G0Z", "G0 Z")):
            continue
        rapide = ligne.startswith("G0") and not ligne.startswith("G0Q")
        nx, ny = x, y
        for lettre, val in nombre.findall(ligne):
            val = float(val)
            if lettre == "X":
                nx = val
            elif lettre == "Y":
                ny = val
            elif lettre == "F":
                if rapide:
                    f0 = val
                else:
                    f1 = val
        d = math.hypot(nx - x, ny - y)
        total += d / max(f0 if rapide else f1, 1) * 60
        x, y = nx, ny
    return round(total)


# --- Réseau : recherche des machines -------------------------------------------

def _ip_locale():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            return s.getsockname()[0]
    except OSError:
        return None


def _essayer(ip):
    try:
        with urllib.request.urlopen(f"http://{ip}:{xc.PORT}/processing/print_type", timeout=0.8) as r:
            corps = r.read(2000).decode("utf-8", "replace")
        mode = json.loads(corps).get("data", {}).get("mode")
        if not mode:
            return None
    except (urllib.error.URLError, OSError, ValueError, AttributeError):
        return None
    info = {"ip": ip, "mode": mode}
    info.update(infos_machine(ip))
    return info


def rechercher():
    """Cherche les lasers xTool sur le réseau local (/24) : port 8080 qui répond
    à /processing/print_type."""
    locale = _ip_locale()
    if not locale:
        return []
    reseau = ipaddress.ip_network(f"{locale}/24", strict=False)
    with concurrent.futures.ThreadPoolExecutor(max_workers=64) as pool:
        trouves = [r for r in pool.map(_essayer, (str(h) for h in reseau.hosts())) if r]
    return trouves


def infos_machine(ip):
    """Nom, modèle et n° de série si la machine les donne."""
    info = {}
    try:
        brut = json.loads(xc._get(ip, "/device/machineInfo", timeout=3))
        d = brut.get("data", brut) if isinstance(brut, dict) else {}
        for cle_src, cle in (("name", "nom"), ("deviceName", "nom"), ("sn", "serie"),
                             ("type", "modele"), ("deviceType", "modele"), ("firmware", "firmware")):
            if isinstance(d, dict) and d.get(cle_src) and cle not in info:
                info[cle] = str(d[cle_src])
    except (urllib.error.URLError, OSError, ValueError, AttributeError):
        pass
    serie = info.get("serie", "")
    if serie.startswith("MXPK"):
        info["machine"] = "P2"
    elif serie.startswith("MXFK"):
        info["machine"] = "F1U"
    return info


# --- Inkscape : texte en chemin ---------------------------------------------------

def _commande_inkscape():
    if shutil.which("inkscape"):
        return ["inkscape"]
    if shutil.which("flatpak"):
        r = subprocess.run(["flatpak", "info", "org.inkscape.Inkscape"], capture_output=True)
        if r.returncode == 0:
            return ["flatpak", "run", "--filesystem=/tmp", "org.inkscape.Inkscape"]
    return None


def texte_en_chemin(svg):
    cmd = _commande_inkscape()
    if not cmd:
        raise RuntimeError("Inkscape est nécessaire pour convertir un texte en chemin.")
    dossier = tempfile.mkdtemp(prefix="atelier-laser-", dir="/tmp")
    entree, sortie = os.path.join(dossier, "texte.svg"), os.path.join(dossier, "chemin.svg")
    with open(entree, "w", encoding="utf-8") as f:
        f.write(svg)
    r = subprocess.run(cmd + [entree, "--actions=select-all:all;object-to-path",
                              "--export-plain-svg", f"--export-filename={sortie}"],
                       capture_output=True, text=True, timeout=120)
    if not os.path.exists(sortie):
        raise RuntimeError(f"Conversion impossible : {r.stderr[-300:]}")
    with open(sortie, encoding="utf-8") as f:
        resultat = f.read()
    shutil.rmtree(dossier, ignore_errors=True)
    return resultat


# --- Fichiers et réglages -------------------------------------------------------

def lire_json(chemin, defaut):
    try:
        with open(chemin, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return defaut


def ecrire_json(chemin, donnees):
    os.makedirs(os.path.dirname(chemin), exist_ok=True)
    tmp = chemin + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(donnees, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, chemin)


def enregistrer_materiau(mat):
    """Ajoute ou met à jour un matériau (même nom) dans materiaux.json."""
    global FICHIER_MATERIAUX
    donnees = lire_json(FICHIER_MATERIAUX, {"materiaux": []})
    liste = donnees.setdefault("materiaux", [])
    for existant in liste:
        if existant.get("nom") == mat["nom"]:
            existant.update(mat)
            break
    else:
        liste.append(mat)
    if not os.access(os.path.dirname(FICHIER_MATERIAUX), os.W_OK):
        FICHIER_MATERIAUX = os.path.join(DOSSIER_CONFIG, "materiaux.json")
    ecrire_json(FICHIER_MATERIAUX, donnees)
    return donnees


def polices():
    """Familles de polices installées (fc-list), triées."""
    try:
        r = subprocess.run(["fc-list", "--format", "%{family[0]}\n"], capture_output=True, text=True, timeout=10)
        noms = {n.strip() for n in r.stdout.splitlines() if n.strip() and not n.startswith(".")}
    except (OSError, subprocess.SubprocessError):
        noms = set()
    return sorted(noms | {"Sans", "Serif", "Monospace"}, key=str.lower)


def demander_ouverture():
    """Boîte « Ouvrir » GTK pour un projet. Renvoie le chemin, None si annulé."""
    from gi.repository import Gio, GLib, Gtk

    fini = threading.Event()
    resultat = {}

    def ouvrir():
        dlg = Gtk.FileDialog(title="Ouvrir un projet")
        f = Gtk.FileFilter()
        f.set_name("Projet Atelier Laser")
        f.add_pattern("*.alaser")
        filtres = Gio.ListStore.new(Gtk.FileFilter)
        filtres.append(f)
        dlg.set_filters(filtres)

        def fin(d, res):
            try:
                fichier = d.open_finish(res)
                resultat["chemin"] = fichier.get_path() if fichier else None
            except GLib.Error:
                resultat["chemin"] = None
            fini.set()

        dlg.open(FENETRE, None, fin)
        return False

    GLib.idle_add(ouvrir)
    fini.wait()
    return resultat.get("chemin")


def demander_chemin(nom_defaut, filtre_nom, motif):
    """Boîte « Enregistrer sous » GTK, appelée depuis un fil du serveur.
    Renvoie le chemin choisi, None si annulé. Sans fenêtre GTK : ~/Documents."""
    if FENETRE is None:
        dossier = os.path.join(os.path.expanduser("~/Documents"), "Atelier Laser")
        os.makedirs(dossier, exist_ok=True)
        return os.path.join(dossier, nom_defaut)
    from gi.repository import Gio, GLib, Gtk

    fini = threading.Event()
    resultat = {}

    def ouvrir():
        dlg = Gtk.FileDialog(title="Enregistrer", initial_name=nom_defaut)
        f = Gtk.FileFilter()
        f.set_name(filtre_nom)
        f.add_pattern(motif)
        filtres = Gio.ListStore.new(Gtk.FileFilter)
        filtres.append(f)
        dlg.set_filters(filtres)

        def fin(d, res):
            try:
                fichier = d.save_finish(res)
                resultat["chemin"] = fichier.get_path() if fichier else None
            except GLib.Error:
                resultat["chemin"] = None
            fini.set()

        dlg.save(FENETRE, None, fin)
        return False

    GLib.idle_add(ouvrir)
    fini.wait()
    return resultat.get("chemin")


# --- Serveur HTTP -------------------------------------------------------------

TYPES_MIME = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
              ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
              ".json": "application/json"}


class Gestionnaire(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _envoyer(self, code, corps, type_mime="application/json"):
        if isinstance(corps, (dict, list)):
            corps = json.dumps(corps, ensure_ascii=False).encode("utf-8")
        elif isinstance(corps, str):
            corps = corps.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", type_mime)
        self.send_header("Content-Length", str(len(corps)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(corps)

    def _erreur(self, message, code=400):
        self._envoyer(code, {"erreur": str(message)})

    def do_GET(self):
        chemin = self.path.split("?", 1)[0]
        if chemin.startswith("/api/"):
            return self._api(chemin, {})
        fichier = os.path.normpath(os.path.join(WEB, chemin.lstrip("/") or "index.html"))
        if not fichier.startswith(WEB) or not os.path.isfile(fichier):
            return self._envoyer(404, "introuvable", "text/plain")
        with open(fichier, "rb") as f:
            self._envoyer(200, f.read(), TYPES_MIME.get(os.path.splitext(fichier)[1], "application/octet-stream"))

    def do_POST(self):
        # requêtes de la page seulement (pas d'un autre site ouvert dans le navigateur)
        hote = self.headers.get("Host", "")
        origine = self.headers.get("Origin")
        if origine and origine != f"http://{hote}":
            return self._erreur("origine refusée", 403)
        longueur = int(self.headers.get("Content-Length") or 0)
        try:
            donnees = json.loads(self.rfile.read(longueur) or b"{}")
        except ValueError:
            return self._erreur("JSON invalide")
        self._api(self.path.split("?", 1)[0], donnees)

    def _api(self, chemin, d):
        try:
            if chemin == "/api/materiaux":
                if d.get("materiau"):
                    enregistrer_materiau(d["materiau"])
                return self._envoyer(200, lire_json(FICHIER_MATERIAUX, {"materiaux": []}))
            if chemin == "/api/reglages":
                if d:
                    ecrire_json(FICHIER_REGLAGES, d)
                return self._envoyer(200, {**lire_json(FICHIER_REGLAGES, {}), "_fenetre": FENETRE is not None})
            if chemin == "/api/polices":
                return self._envoyer(200, {"polices": polices()})
            if chemin == "/api/secours":
                if d.get("effacer"):
                    if os.path.exists(FICHIER_SECOURS):
                        os.remove(FICHIER_SECOURS)
                elif d.get("projet"):
                    ecrire_json(FICHIER_SECOURS, {"nom": d.get("nom"), "projet": d["projet"]})
                return self._envoyer(200, lire_json(FICHIER_SECOURS, {}))
            if chemin == "/api/ouvrir_projet":
                if FENETRE is None:
                    return self._erreur("Boîte d'ouverture indisponible hors de la fenêtre.")
                cible = demander_ouverture()
                if not cible:
                    return self._envoyer(200, {"annule": True})
                return self._envoyer(200, {"chemin": cible, "projet": lire_json(cible, {})})
            if chemin == "/api/rechercher":
                return self._envoyer(200, {"machines": rechercher()})
            if chemin == "/api/connecter":
                ip = d["ip"].strip()
                mode = xc.mode_actuel(ip)
                if mode is None:
                    return self._erreur(f"Aucune machine xTool ne répond à l'adresse {ip}.")
                return self._envoyer(200, {"ip": ip, "mode": mode, **infos_machine(ip)})
            if chemin == "/api/etat":
                return self._envoyer(200, {"mode": xc.mode_actuel(d["ip"])})
            if chemin == "/api/camera":
                ip = d["ip"]
                xc.verifier_libre(ip)
                image = xc.redresser(xc.photo_brute(ip, d.get("eclairage", True)), xc.calibration_camera(ip))
                tampon = io.BytesIO()
                image.save(tampon, "JPEG", quality=85)
                return self._envoyer(200, {
                    "image": "data:image/jpeg;base64," + base64.b64encode(tampon.getvalue()).decode("ascii"),
                    "largeur": image.width / xc.PX_PAR_MM, "hauteur": image.height / xc.PX_PAR_MM})
            if chemin == "/api/mesurer":
                ep, details = xc.mesurer_epaisseur(d["ip"], float(d["x"]), float(d["y"]))
                # Journal des mesures, pour mettre au point la fonction sur la machine
                os.makedirs(DOSSIER_CONFIG, exist_ok=True)
                with open(FICHIER_MESURES, "a", encoding="utf-8") as f:
                    f.write(json.dumps({"x": d["x"], "y": d["y"], "epaisseur": ep, **details},
                                       ensure_ascii=False) + "\n")
                return self._envoyer(200, {"epaisseur": ep, "details": details})
            if chemin == "/api/apercu":
                _, resume = construire_gcode(d)
                return self._envoyer(200, resume)
            if chemin == "/api/envoyer":
                gcode, resume = construire_gcode(d)
                xc.verifier_libre(d["ip"])
                ok, rep = xc.envoyer(d["ip"], gcode)
                if not ok:
                    return self._erreur(f"Réponse inattendue de la machine : {rep[:300]}")
                return self._envoyer(200, resume)
            if chemin == "/api/cadrer":
                if d.get("machine", "P2") != "P2":
                    return self._erreur("L'encadrement n'est disponible que pour la P2 pour l'instant.")
                x0, y0, x1, y1 = (float(v) for v in d["zone"])
                gcode = xc.gcode_cadrage_p2(x0, y0, x1, y1, epaisseur=float(d.get("epaisseur", 3)),
                                            vitesse=float(d.get("vitesse", 50)), tours=int(d.get("tours", 2)))
                xc.verifier_libre(d["ip"])
                ok, rep = xc.envoyer(d["ip"], gcode)
                if not ok:
                    return self._erreur(f"Réponse inattendue de la machine : {rep[:300]}")
                return self._envoyer(200, {"ok": True})
            if chemin == "/api/exporter":
                gcode, resume = construire_gcode(d)
                cible = demander_chemin(d.get("nom", "travail") + ".gcode", "G-code", "*.gcode")
                if not cible:
                    return self._envoyer(200, {"annule": True})
                with open(cible, "w", encoding="utf-8") as f:
                    f.write(gcode)
                return self._envoyer(200, {**resume, "chemin": cible})
            if chemin == "/api/sauver_projet":
                cible = d.get("chemin") or demander_chemin(d.get("nom", "projet") + ".alaser",
                                                            "Projet Atelier Laser", "*.alaser")
                if not cible:
                    return self._envoyer(200, {"annule": True})
                if not cible.endswith(".alaser"):
                    cible += ".alaser"
                ecrire_json(cible, d["projet"])
                if os.path.exists(FICHIER_SECOURS):
                    os.remove(FICHIER_SECOURS)
                return self._envoyer(200, {"chemin": cible})
            if chemin == "/api/texte_en_chemin":
                return self._envoyer(200, {"svg": texte_en_chemin(d["svg"])})
            return self._erreur("requête inconnue", 404)
        except (OSError, RuntimeError, ValueError, KeyError, subprocess.SubprocessError) as e:
            return self._erreur(e)


def demarrer_serveur():
    serveur = ThreadingHTTPServer(("127.0.0.1", 0), Gestionnaire)
    threading.Thread(target=serveur.serve_forever, daemon=True).start()
    return serveur, f"http://127.0.0.1:{serveur.server_address[1]}/"


def fenetre_gtk(url):
    global FENETRE
    import gi
    gi.require_version("Gtk", "4.0")
    gi.require_version("WebKit", "6.0")
    from gi.repository import Gtk, WebKit

    app = Gtk.Application(application_id="fr.fablab.AtelierLaser")

    def activer(app):
        global FENETRE
        win = Gtk.ApplicationWindow(application=app, title="Atelier Laser")
        win.set_default_size(1440, 900)
        win.set_icon_name("atelier-laser")
        vue = WebKit.WebView()
        reglages = vue.get_settings()
        reglages.set_enable_developer_extras(True)
        reglages.set_hardware_acceleration_policy(WebKit.HardwareAccelerationPolicy.ALWAYS)
        vue.load_uri(url)
        win.set_child(vue)
        win.maximize()
        win.present()
        FENETRE = win

    app.connect("activate", activer)
    app.run([])


def main():
    serveur, url = demarrer_serveur()
    if "--navigateur" in sys.argv:
        print(f"Atelier Laser : {url}  (Ctrl+C pour quitter)")
        webbrowser.open(url)
        try:
            threading.Event().wait()
        except KeyboardInterrupt:
            pass
        return
    try:
        fenetre_gtk(url)
    except (ImportError, ValueError) as e:
        print(f"Fenêtre GTK/WebKit indisponible ({e}), ouverture dans le navigateur : {url}")
        webbrowser.open(url)
        try:
            threading.Event().wait()
        except KeyboardInterrupt:
            pass
    serveur.shutdown()


if __name__ == "__main__":
    main()
