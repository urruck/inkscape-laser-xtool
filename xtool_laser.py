#!/usr/bin/env python3
"""Extension Inkscape : envoi vers une xTool P2 ou F1 Ultra.

- Images (photos, logos importés) : gravure par balayage, onglet Images.
- Quatre couches : chaque couche associe une couleur à un réglage. Marquage et
  découpe suivent les contours ; la gravure remplit les formes de cette couleur.
- Un matériau (materiaux.json) peut remplacer l'épaisseur et les réglages.
Ordre de travail : images, puis couches 1 à 4.
"""
import copy
import json
import math
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import inkex  # noqa: E402
from inkex import bezier  # noqa: E402
from inkex.command import inkscape  # noqa: E402

import xtool_common as xc  # noqa: E402

FORMES = (
    inkex.PathElement, inkex.Rectangle, inkex.Circle, inkex.Ellipse,
    inkex.Line, inkex.Polyline, inkex.Polygon,
)
DESSINS = FORMES + (inkex.TextElement, inkex.Image, inkex.Use, inkex.FlowRoot)
ID_CAMERA = "xtool-camera-p2"
NB_COUCHES = 4


def hexa(couleur):
    return str(inkex.Color(couleur).to_rgb()).lower()


def ordonner(chemins):
    """Ordre « plus proche voisin » pour limiter les déplacements à vide."""
    restants = list(chemins)
    ordre = []
    pos = (0.0, 0.0)
    while restants:
        i = min(range(len(restants)), key=lambda k: math.dist(pos, restants[k][0]))
        ch = restants.pop(i)
        ordre.append(ch)
        pos = ch[-1]
    return ordre


def charger_materiaux():
    ici = os.path.dirname(os.path.realpath(__file__))
    with open(os.path.join(ici, "materiaux.json"), encoding="utf-8") as f:
        return {m["nom"]: m for m in json.load(f)["materiaux"]}


class XToolLaser(inkex.EffectExtension):
    def add_arguments(self, pars):
        pars.add_argument("--onglet")
        pars.add_argument("--machine", default="P2")
        pars.add_argument("--materiau", default="manuel")
        pars.add_argument("--epaisseur", type=float, default=3.0)
        pars.add_argument("--laser", default="bleu")
        pars.add_argument("--frequence", type=int, default=30)
        # mêmes valeurs par défaut que generer_inx.py
        defauts = [(True, "#0000ff", "marquage", 30, 100), (True, "#ff0000", "decoupe", 90, 25),
                   (False, "#000000", "gravure", 20, 200), (False, "#00ff00", "decoupe", 60, 10)]
        for n, (actif, couleur, type_, puissance, vitesse) in enumerate(defauts, start=1):
            pars.add_argument(f"--c{n}_actif", type=inkex.Boolean, default=actif)
            pars.add_argument(f"--c{n}_couleur", type=inkex.Color, default=inkex.Color(couleur))
            pars.add_argument(f"--c{n}_type", default=type_)
            pars.add_argument(f"--c{n}_puissance", type=float, default=float(puissance))
            pars.add_argument(f"--c{n}_vitesse", type=float, default=float(vitesse))
            pars.add_argument(f"--c{n}_passes", type=int, default=1)
            pars.add_argument(f"--c{n}_air", type=int, default=100)
        pars.add_argument("--img_actif", type=inkex.Boolean, default=True)
        pars.add_argument("--img_mode", default="tramage")
        pars.add_argument("--img_puissance", type=float, default=10.0)
        pars.add_argument("--img_puissance_min", type=float, default=0.0)
        pars.add_argument("--img_vitesse", type=float, default=300.0)
        pars.add_argument("--img_resolution", type=float, default=10.0)
        pars.add_argument("--img_passes", type=int, default=1)
        pars.add_argument("--img_air", type=int, default=100)
        pars.add_argument("--gravure_resolution", type=float, default=10.0)
        pars.add_argument("--tolerance", type=float, default=0.05)
        pars.add_argument("--selection_seule", type=inkex.Boolean, default=True)
        pars.add_argument("--action", default="fichier")
        pars.add_argument("--ip", default="")
        pars.add_argument("--fichier", default="~/xtool-travail.gcode")

    # --- Réglages ---------------------------------------------------------------

    def _reglages(self):
        """Renvoie (épaisseur, couches, réglage images), matériau appliqué."""
        o = vars(self.options)
        epaisseur = o["epaisseur"]
        couches = []
        for n in range(1, NB_COUCHES + 1):
            if o[f"c{n}_actif"]:
                couches.append({
                    "num": n, "couleur": hexa(o[f"c{n}_couleur"]), "type": o[f"c{n}_type"],
                    "puissance": o[f"c{n}_puissance"], "vitesse": o[f"c{n}_vitesse"],
                    "passes": max(1, o[f"c{n}_passes"]), "air": o[f"c{n}_air"],
                })
        image = {
            "actif": o["img_actif"], "mode": o["img_mode"], "puissance": o["img_puissance"],
            "puissance_min": o["img_puissance_min"], "vitesse": o["img_vitesse"],
            "resolution": o["img_resolution"], "passes": max(1, o["img_passes"]), "air": o["img_air"],
        }
        mat = None
        if o["materiau"] != "manuel":
            mat = charger_materiaux().get(o["materiau"])
            if mat is None:
                raise inkex.AbortExtension(
                    f"Matériau « {o['materiau']} » absent de materiaux.json : relancez installer.sh.")
            if mat.get("epaisseur") is not None:
                epaisseur = float(mat["epaisseur"])
            for c in couches:
                c["depuis_materiau"] = c["type"] in mat
                c.update({k: v for k, v in mat.get(c["type"], {}).items()
                          if k in ("puissance", "vitesse", "passes", "air", "resolution")})
            image["depuis_materiau"] = "image" in mat
            image.update({k: v for k, v in mat.get("image", {}).items()
                          if k in ("mode", "puissance", "puissance_min", "vitesse", "resolution", "passes", "air")})
        return epaisseur, couches, image, mat

    # --- Sélection des objets ---------------------------------------------------------

    def _dans_camera(self, el):
        return any(a.get("id") == ID_CAMERA for a in el.ancestors())

    def _visible(self, el):
        node = el
        while node is not None and isinstance(node, inkex.BaseElement):
            st = node.style
            if st.get("display") == "none" or st.get("visibility") == "hidden":
                return False
            node = node.getparent()
        return True

    def _elements(self, types):
        if self.options.selection_seule and self.svg.selection:
            racines = list(self.svg.selection.values())
        else:
            racines = [self.svg]
        vus = []
        for r in racines:
            for el in r.descendants():
                if (isinstance(el, types) and el not in vus and self._visible(el)
                        and not self._dans_camera(el)):
                    vus.append(el)
        return vus

    def _couleurs(self, el):
        """Couleurs (contour, remplissage) en hexadécimal, None si absente."""
        st = el.specified_style()
        res = []
        for prop in ("stroke", "fill"):
            val = st.get(prop)
            try:
                res.append(hexa(val) if val and val != "none" and not str(val).startswith("url(") else None)
            except inkex.colors.ColorError:
                res.append(None)
        return res

    def _polylignes(self, el, uu_par_mm):
        chemin = el.path.to_absolute().transform(el.composed_transform())
        csp = chemin.to_superpath()
        bezier.cspsubdiv(csp, self.options.tolerance * uu_par_mm)
        resultat = []
        for sous in csp:
            pts = [(p[1][0] / uu_par_mm, p[1][1] / uu_par_mm) for p in sous]
            if len(pts) >= 2:
                resultat.append(pts)
        return resultat

    # --- Rendu des gravures -----------------------------------------------------

    def _rendre(self, cibles, resolution, uu_par_mm):
        """Rend seulement les objets `cibles` en PNG (fond blanc) via Inkscape.
        Renvoie (image PIL, x0 mm, y0 mm, résolution réelle en px/mm)."""
        from PIL import Image

        ids = {el.get_id() for el in cibles}
        doc = copy.deepcopy(self.document)
        racine = doc.getroot()
        for el in list(racine.iter()):
            if not isinstance(el, inkex.BaseElement) or el.getparent() is None:
                continue
            if el.get("id") == ID_CAMERA or (isinstance(el, DESSINS) and el.get("id") not in ids):
                el.getparent().remove(el)

        dossier = tempfile.mkdtemp(prefix="xtool-")
        svg_tmp = os.path.join(dossier, "gravure.svg")
        png_tmp = os.path.join(dossier, "gravure.png")
        doc.write(svg_tmp)

        # Boîte englobante exacte (textes compris) demandée à Inkscape :
        # « id,x,y,largeur,hauteur » en px à 96 ppp depuis le coin de la page.
        vb = self.svg.get_viewbox()
        uu_par_px = 25.4 / 96 * uu_par_mm
        boites = []
        for ligne in inkscape(svg_tmp, query_all=True).splitlines():
            champs = ligne.strip().split(",")
            if len(champs) == 5 and champs[0] in ids:
                x, y, w, h = (float(v) * uu_par_px for v in champs[1:])
                boites.append((vb[0] + x, vb[1] + y, vb[0] + x + w, vb[1] + y + h))
        if not boites:
            raise inkex.AbortExtension("Impossible de mesurer les objets à graver.")
        marge = 1 * uu_par_mm
        x0 = min(b[0] for b in boites) - marge
        y0 = min(b[1] for b in boites) - marge
        x1 = max(b[2] for b in boites) + marge
        y1 = max(b[3] for b in boites) + marge

        racine.set("viewBox", f"{x0} {y0} {x1 - x0} {y1 - y0}")
        racine.set("width", f"{(x1 - x0) / uu_par_mm}mm")
        racine.set("height", f"{(y1 - y0) / uu_par_mm}mm")
        doc.write(svg_tmp)
        inkscape(svg_tmp, export_filename=png_tmp, export_type="png", export_area_page=True,
                 export_dpi=resolution * 25.4, export_background="#ffffff",
                 export_background_opacity=1.0)
        image = Image.open(png_tmp)
        image.load()
        larg_mm = (x1 - x0) / uu_par_mm
        return image, x0 / uu_par_mm, y0 / uu_par_mm, image.width / larg_mm

    def _bloc_gravure(self, cibles, reglage, mode, type_, z, uu_par_mm, x_max):
        import numpy as np
        import xtool_raster as xr

        image, x0, y0, res = self._rendre(cibles, reglage["resolution"], uu_par_mm)
        s = xr.puissances(image, mode, reglage["puissance"], reglage.get("puissance_min", 0))
        lignes_on, colonnes_on = np.nonzero(s)
        if lignes_on.size == 0:
            return None, None
        boite = (x0 + colonnes_on.min() / res, y0 + lignes_on.min() / res,
                 x0 + (colonnes_on.max() + 1) / res, y0 + (lignes_on.max() + 1) / res)
        lignes = xr.bloc_p2(s, x0, y0, res, reglage["vitesse"], reglage["puissance"], z,
                            reglage["air"], type_=type_, mode=mode, x_max=x_max,
                            passes=reglage["passes"])
        return lignes, boite

    # --- Programme principal ------------------------------------------------------

    def effect(self):
        opt = self.options
        machine = xc.MACHINES[opt.machine]
        epaisseur, couches, reg_img, mat = self._reglages()
        if not couches and not reg_img["actif"]:
            raise inkex.AbortExtension("Aucune couche active et gravure d'images désactivée.")
        vues = set()
        for c in couches:
            if c["couleur"] in vues:
                raise inkex.AbortExtension(f"Deux couches actives ont la même couleur ({c['couleur']}).")
            vues.add(c["couleur"])

        uu_par_mm = self.svg.unittouu("1mm")
        larg, haut = machine["zone"]
        z = xc.z_p2(epaisseur)
        calques, boites, bilan = [], [], []

        def verifier(nom, puissance, vitesse, vmax):
            if not 0 < puissance <= 100:
                raise inkex.AbortExtension(f"{nom} : puissance hors limites ({puissance:g} %)")
            if not 0 < vitesse <= vmax:
                raise inkex.AbortExtension(f"{nom} : vitesse hors limites ({vitesse:g} mm/s, max {vmax:g})")

        def manque_materiau(nom, type_):
            raise inkex.AbortExtension(
                f"{nom} : le matériau « {mat['nom']} » n'a pas de réglage « {type_} ». "
                "Complétez materiaux.json ou choisissez « Réglages manuels ».")

        # 1. Images
        images = self._elements(inkex.Image) if reg_img["actif"] else []
        if images:
            if opt.machine != "P2":
                raise inkex.AbortExtension("La gravure d'images n'est disponible que pour la P2.")
            if mat is not None and not reg_img["depuis_materiau"]:
                manque_materiau("Images", "image")
            verifier("Images", reg_img["puissance"], reg_img["vitesse"], 600)
            lignes, boite = self._bloc_gravure(images, reg_img, reg_img["mode"], "image", z, uu_par_mm, larg)
            if lignes:
                calques.append({"lignes": lignes, "puissance": reg_img["puissance"], "vitesse": reg_img["vitesse"]})
                boites.append(boite)
                bilan.append(f"  Images : {len(images)} image(s), {reg_img['mode']}, {reg_img['puissance']:g} %, "
                             f"{reg_img['vitesse']:g} mm/s, {reg_img['resolution']:g} lignes/mm, "
                             f"{reg_img['passes']} passe(s), air {reg_img['air']} %")

        # 2. Couches
        vecteurs = self._elements(FORMES)
        remplissables = self._elements(FORMES + (inkex.TextElement,))
        ignores = {}
        for el in vecteurs:
            contour, fond = self._couleurs(el)
            c = contour or fond
            if c is not None and c not in vues:
                ignores[c] = ignores.get(c, 0) + 1
        for c in couches:
            nom = f"Couche {c['num']} ({c['couleur']})"
            if c["type"] == "gravure":
                cibles = [el for el in remplissables if c["couleur"] in self._couleurs(el)]
                if not cibles:
                    continue
                if opt.machine != "P2":
                    raise inkex.AbortExtension("La gravure de remplissage n'est disponible que pour la P2.")
                if mat is not None and not c.get("depuis_materiau"):
                    manque_materiau(nom, "gravure")
                verifier(nom, c["puissance"], c["vitesse"], 600)
                reg = {**c, "resolution": c.get("resolution", opt.gravure_resolution)}
                lignes, boite = self._bloc_gravure(cibles, reg, "seuil", "remplissage", z, uu_par_mm, larg)
                if not lignes:
                    continue
                calques.append({"lignes": lignes, "puissance": c["puissance"], "vitesse": c["vitesse"]})
                boites.append(boite)
                bilan.append(f"  {nom} gravure : {len(cibles)} objet(s), {c['puissance']:g} %, "
                             f"{c['vitesse']:g} mm/s, {c['passes']} passe(s), air {c['air']} %")
            else:
                chemins = []
                for el in vecteurs:
                    contour, fond = self._couleurs(el)
                    if (contour or fond) == c["couleur"]:
                        chemins.extend(self._polylignes(el, uu_par_mm))
                if not chemins:
                    continue
                if mat is not None and not c.get("depuis_materiau"):
                    manque_materiau(nom, c["type"])
                verifier(nom, c["puissance"], c["vitesse"], machine["vitesse_max"])
                calques.append({**c, "chemins": ordonner(chemins)})
                pts = [p for ch in chemins for p in ch]
                boites.append((min(p[0] for p in pts), min(p[1] for p in pts),
                               max(p[0] for p in pts), max(p[1] for p in pts)))
                ligne = (f"  {nom} {c['type']} : {len(chemins)} tracé(s), {c['puissance']:g} %, "
                         f"{c['vitesse']:g} mm/s, {c['passes']} passe(s)")
                bilan.append(ligne + (f", air {c['air']} %" if opt.machine == "P2" else ""))

        if not calques:
            raise inkex.AbortExtension(
                "Rien à faire : aucune image, et aucun objet n'a la couleur d'une couche active.")

        xmin = min(b[0] for b in boites)
        ymin = min(b[1] for b in boites)
        xmax = max(b[2] for b in boites)
        ymax = max(b[3] for b in boites)
        if xmin < 0 or ymin < 0 or xmax > larg or ymax > haut:
            raise inkex.AbortExtension(
                f"Le dessin dépasse la zone de la {machine['nom']} ({larg:g} x {haut:g} mm) : "
                f"X {xmin:.1f}..{xmax:.1f}, Y {ymin:.1f}..{ymax:.1f} mm. "
                "Le coin haut-gauche de la page correspond à l'origine de la machine.")

        entete = [f"{machine['nom']} — zone utilisée X {xmin:.1f}..{xmax:.1f}, Y {ymin:.1f}..{ymax:.1f} mm"]
        if mat is not None:
            entete.append(f"Matériau : {mat['nom']}" + (f" ({mat['source']})" if mat.get("source") else ""))
        if opt.machine == "P2":
            entete.append(f"Épaisseur {epaisseur:g} mm -> hauteur Z {z:g}")
        bilan = entete + bilan
        for c, n in ignores.items():
            bilan.append(f"  IGNORÉ {c} : {n} objet(s) sans couche")
        textes = len([t for t in self._elements(inkex.TextElement)])
        if textes and not any(c["type"] == "gravure" for c in couches):
            bilan.append(f"  Attention : {textes} texte(s) ignoré(s), utilisez Chemin > Objet en chemin.")

        ip = opt.ip.strip()
        if opt.action == "cadrer":
            if opt.machine != "P2":
                raise inkex.AbortExtension("Le cadrage n'est disponible que pour la P2 pour l'instant.")
            if not ip:
                raise inkex.AbortExtension("Indiquez l'adresse IP de la machine (onglet Envoi).")
            try:
                gcode = xc.gcode_cadrage_p2(xmin, ymin, xmax, ymax, epaisseur=epaisseur)
                xc.verifier_libre(ip)
                ok, rep = xc.envoyer(ip, gcode)
            except (OSError, RuntimeError, ValueError) as e:
                raise inkex.AbortExtension(f"Cadrage impossible : {e}")
            if not ok:
                raise inkex.AbortExtension(f"Réponse inattendue de {ip} : {rep[:300]}")
            bilan.append("Cadrage envoyé (2 tours, laser à 0). "
                         "Appuyez sur le bouton de la machine pour le lancer.")
            inkex.errormsg("\n".join(bilan))
            return

        try:
            if opt.machine == "P2":
                gcode = xc.gcode_p2(calques, epaisseur=epaisseur)
            else:
                gcode = xc.gcode_f1u(calques, laser=opt.laser, frequence=opt.frequence)
        except ValueError as e:
            raise inkex.AbortExtension(str(e))

        chemin_fichier = os.path.expanduser(opt.fichier or "~/xtool-travail.gcode")
        with open(chemin_fichier, "w", encoding="utf-8") as f:
            f.write(gcode)
        bilan.append(f"G-code enregistré : {chemin_fichier} ({len(gcode) // 1024} Ko)")

        if opt.action == "envoyer":
            if not ip:
                raise inkex.AbortExtension("Indiquez l'adresse IP de la machine (onglet Envoi).")
            try:
                xc.verifier_libre(ip)
                ok, rep = xc.envoyer(ip, gcode)
            except (OSError, RuntimeError) as e:
                raise inkex.AbortExtension(f"Envoi impossible vers {ip} : {e}")
            if ok:
                bilan.append(f"Envoyé à {ip}. Appuyez sur le bouton de la machine pour démarrer.")
            else:
                bilan.append(f"Réponse inattendue de {ip} : {rep[:300]}")

        inkex.errormsg("\n".join(bilan))


if __name__ == "__main__":
    XToolLaser().run()
