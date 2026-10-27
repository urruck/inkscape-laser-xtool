"""Code commun : génération du G-code xTool (P2, F1 Ultra), envoi réseau,
déplacement de tête et caméra de la P2.

Formats relevés dans xTool Studio 1.9.14 et dans de vrais travaux envoyés
par xTool Studio (manifest P2, motion.gcode F1 Ultra).
Puissance : S = pourcentage x 10 (0..1000). Vitesse : F en mm/min.
P2 : hauteur Z = 25 - épaisseur du matériau (3 mm -> Z22).
"""
import io
import json
import os
import re
import time
import urllib.error
import urllib.request

MACHINES = {
    # zone de travail (mm), vitesse vectorielle max (mm/s)
    "P2": {"nom": "xTool P2", "zone": (600.0, 305.0), "vitesse_max": 250.0},
    "F1U": {"nom": "xTool F1 Ultra", "zone": (220.0, 220.0), "vitesse_max": 4000.0},
}

PORT = 8080
PORT_CAMERA = 8329

# Type de travail P2 (commande M2519) : S1 marquage, S3 découpe, S4 remplissage, S2 image
TYPES_P2 = {"marquage": 1, "decoupe": 3, "remplissage": 4, "image": 2}

EPAISSEUR_MAX_P2 = 20.0


def _fmt(v):
    """Nombre au format xTool : 3 décimales max, sans zéros inutiles."""
    s = f"{v:.3f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def _mouvements(chemins, puissance, vitesse, passes):
    """Lignes G0/G1 d'un calque. chemins = listes de points (x, y) en mm.
    Comme xTool, la puissance S est redonnée au premier G1 après chaque saut."""
    s = int(round(puissance * 10))
    f = int(round(vitesse * 60))
    lignes = []
    for _ in range(passes):
        for pts in chemins:
            x0, y0 = pts[0]
            lignes.append(f"G0X{_fmt(x0)}Y{_fmt(y0)}")
            premier = True
            for x, y in pts[1:]:
                if premier:
                    lignes.append(f"G1X{_fmt(x)}Y{_fmt(y)}S{s}F{f}")
                    premier = False
                else:
                    lignes.append(f"G1X{_fmt(x)}Y{_fmt(y)}")
    return lignes


def z_p2(epaisseur):
    return 25.0 - epaisseur


def gcode_p2(calques, epaisseur=3.0):
    """calques = liste de dicts {chemins, puissance, vitesse, passes, type, air}.
    type : 'marquage' ou 'decoupe'. air : 0..100 % (0 = coupé)."""
    if not 0 <= epaisseur <= EPAISSEUR_MAX_P2:
        raise ValueError(f"Épaisseur hors limites : {epaisseur} mm (0 à {EPAISSEUR_MAX_P2:g})")
    z = z_p2(epaisseur)
    p0 = calques[0]
    out = [
        "G90",
        "G0 F3000",
        "",
        "# P2 HEAD",
        '# WorkingInfo={"mode":"LASER_PLANE"}',
        f'# WorkingInfo={{"focalLen":{_fmt(z)}}}',
        f'# WorkingInfo={{"speed":{_fmt(p0["vitesse"])}}}',
        f'# WorkingInfo={{"power":{_fmt(p0["puissance"])}}}',
        "G0 F9600",
        "G0 X0 Y0",
        "M4 S0",
        "G1 F1000",
        "M19 S1",
        "M18 S0",
    ]
    for c in calques:
        if "lignes" in c:  # bloc de gravure déjà calculé (xtool_raster)
            out += [""] + c["lignes"]
            continue
        air = c.get("air", 100)
        # même calcul qu'xTool : 0 = coupé, sinon au moins 30 %, sur 255
        s_air = round(max(30, air) * 2.55) if air > 0 else 0
        out += [
            "",
            "# P2 VECTOR HEAD",
            "G4 P0.1",
            "G90",
            "# motion_start",
            "",
            f'# blockConfig={{"powerFactor": {_fmt(c["puissance"] / 100)}, "isVector": true}}',
            "",
            f"M2519S{TYPES_P2[c.get('type', 'decoupe')]}T0",
            f"M15 S{s_air}",
            f"G0Z{z:.3f}",
        ]
        out += _mouvements(c["chemins"], c["puissance"], c["vitesse"], c["passes"])
        out += ["# P2 VECTOR TAIL", "# motion_end"]
    out += [
        "# END",
        "# P2 TAIL",
        "G90",
        "G0 S0",
        "M3 S0",
        "G0 Z0",
        "G0 X0 Y0",
        "G0 F10000",
        "G1 F10000",
        "G4 P0.1",
        "M109 S0",
        "M6 P1",
    ]
    return "\n".join(out) + "\n"


def gcode_cadrage_p2(xmin, ymin, xmax, ymax, epaisseur=3.0, vitesse=50.0, tours=2):
    """Cadrage sous forme de travail : la tête fait le tour de la zone avec
    le laser à puissance 0 (S0). Comme un travail normal, la machine attend
    l'appui sur son bouton pour démarrer."""
    if not 0 <= epaisseur <= EPAISSEUR_MAX_P2:
        raise ValueError(f"Épaisseur hors limites : {epaisseur} mm (0 à {EPAISSEUR_MAX_P2:g})")
    f = int(round(vitesse * 60))
    out = [
        "G90",
        "G0 F3000",
        "",
        "# P2 HEAD",
        '# WorkingInfo={"mode":"LASER_PLANE"}',
        "G0 F9600",
        "G0 X0 Y0",
        "M4 S0",
        "G1 F1000",
        "M19 S1",
        "M18 S0",
        "",
        "# P2 VECTOR HEAD",
        "G4 P0.1",
        "G90",
        "# motion_start",
        "# cadrage : laser à 0",
        "M15 S0",
        f"G0Z{z_p2(epaisseur):.3f}",
        f"G0X{_fmt(xmin)}Y{_fmt(ymin)}",
    ]
    for _ in range(tours):
        out += [
            f"G1X{_fmt(xmax)}Y{_fmt(ymin)}S0F{f}",
            f"G1X{_fmt(xmax)}Y{_fmt(ymax)}S0",
            f"G1X{_fmt(xmin)}Y{_fmt(ymax)}S0",
            f"G1X{_fmt(xmin)}Y{_fmt(ymin)}S0",
        ]
    out += [
        "# P2 VECTOR TAIL",
        "# motion_end",
        "# END",
        "# P2 TAIL",
        "G90",
        "G0 S0",
        "M3 S0",
        "G0 Z0",
        "G0 X0 Y0",
        "G0 F10000",
        "G1 F10000",
        "G4 P0.1",
        "M109 S0",
        "M6 P1",
    ]
    return "\n".join(out) + "\n"


def gcode_f1u(calques, laser="bleu", frequence=30):
    """F1 Ultra : laser 'bleu' (diode, G21) ou 'rouge' (infrarouge, G22)."""
    choix_laser = "G22" if laser == "rouge" else "G21"
    out = [
        "# GS002 HEAD",
        "G0 F180000",
        "M4 S0",
        "G1 F180000",
        "G0 X0 Y0",
    ]
    for c in calques:
        out += [
            "# GS002 VECTOR HEAD",
            "# motion_start",
            "G4M1",
            choix_laser,
            "G90",
            f"G0Q{int(frequence)}",
            "G4M1",
            "M523P40",
            f'# blockConfig={{"powerFactor": {_fmt(c["puissance"] / 100)}, "isVector": true, "crossDot": false}}',
        ]
        out += _mouvements(c["chemins"], c["puissance"], c["vitesse"], c["passes"])
        out += ["# GS002 VECTOR TAIL", "# motion_end"]
    out += [
        "# END",
        "# GS002 TAIL",
        "G90",
        "G0 S0",
        "G1 F180000",
        "M536 U0",
        "M6 P1",
    ]
    return "\n".join(out) + "\n"


# --- Réseau -----------------------------------------------------------------

def _get(ip, chemin, timeout=4, port=PORT, brut=False):
    url = f"http://{ip}:{port}{chemin}"
    with urllib.request.urlopen(url, timeout=timeout) as r:
        data = r.read()
    return data if brut else data.decode("utf-8", "replace")


def _post_json(ip, chemin, donnees, timeout=10, port=PORT):
    req = urllib.request.Request(
        f"http://{ip}:{port}{chemin}", data=json.dumps(donnees).encode("utf-8"),
        method="POST", headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def sonder(ip):
    """Interroge la machine en lecture seule. Renvoie {chemin: réponse ou erreur}."""
    res = {}
    for chemin in (
        "/system?action=version_v2",
        "/device/machineInfo",
        "/processing/print_type",
        "/device/runningStatus",
        "/v1/device/machineInfo",
    ):
        try:
            res[chemin] = _get(ip, chemin)
        except (urllib.error.URLError, OSError) as e:
            res[chemin] = f"ERREUR : {e}"
    return res


def mode_actuel(ip):
    """Mode de travail (P_IDLE, P_WORKING...) ou None si inconnu."""
    try:
        return json.loads(_get(ip, "/processing/print_type")).get("data", {}).get("mode")
    except (urllib.error.URLError, OSError, ValueError, AttributeError):
        return None


MODES_LIBRES = ("P_IDLE", "P_SLEEP", "P_WORK_DONE")


def verifier_libre(ip):
    """Lève RuntimeError si la machine n'est pas joignable ou pas libre."""
    mode = mode_actuel(ip)
    if mode is None:
        raise RuntimeError(f"Machine injoignable ou réponse inconnue ({ip}).")
    if mode not in MODES_LIBRES:
        raise RuntimeError(f"La machine est occupée (mode {mode}).")


def envoyer(ip, gcode, timeout=120):
    """Envoie le G-code (protocole V1, HTTP). La machine attend ensuite
    l'appui sur son bouton pour démarrer (pas de démarrage automatique)."""
    url = f"http://{ip}:{PORT}/processing/upload?gcodeType=processing&fileType=txt"
    req = urllib.request.Request(
        url, data=gcode.encode("utf-8"), method="POST",
        headers={"Content-Type": "text/plain"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        corps = r.read().decode("utf-8", "replace")
    try:
        ok = json.loads(corps).get("code") == 0
    except (ValueError, AttributeError):
        ok = False
    return ok, corps


# --- Tête de la P2 (laser éteint) -------------------------------------------

VITESSE_TETE = 9600  # mm/min, valeur utilisée par xTool Studio


def deplacer_tete(ip, x, y):
    """Déplace la tête de la P2, laser éteint (s=0). Attend la fin du mouvement."""
    return _post_json(ip, "/peripheral/laser_head",
                      {"action": "go_to", "waitTime": 30000, "x": round(x, 3), "y": round(y, 3),
                       "s": 0, "f": VITESSE_TETE}, timeout=35)


def tete_origine(ip):
    return _post_json(ip, "/peripheral/laser_head",
                      {"action": "go_to", "waitTime": 0, "x": 0, "y": 0}, timeout=35)


def cadrer(ip, xmin, ymin, xmax, ymax, tours=1):
    """Fait parcourir à la tête les 4 coins de la zone, puis la renvoie à l'origine."""
    verifier_libre(ip)
    for _ in range(tours):
        for x, y in ((xmin, ymin), (xmax, ymin), (xmax, ymax), (xmin, ymax), (xmin, ymin)):
            deplacer_tete(ip, x, y)
    tete_origine(ip)


# --- Mesure de l'épaisseur (P2) -----------------------------------------------
# Relevé dans xTool Studio (méthode « RULE_TWO », P2 dont le n° de série
# commence par MXPK007 à MXPK010) : la tête porte une LED infrarouge décalée
# en X ; la machine calcule elle-même l'épaisseur sous ce point.

DECALAGE_IR_P2 = (68.0, -0.6)  # mm, valeur par défaut de xTool (LED IR / laser)


def decalage_ir(ip):
    """Décalage LED IR / laser propre à la machine (config « laserMeasureOffset »,
    texte du type « X68.2Y-0.5Z0 »), sinon la valeur par défaut."""
    try:
        rep = json.loads(_post_json(ip, "/config/get", {"alias": "config", "type": "user",
                                                       "kv": ["laserMeasureOffset"]}))
        texte = str((rep.get("data") or rep).get("laserMeasureOffset") or "")
        m = re.match(r"X(-?[\d.]+)Y(-?[\d.]+)", texte)
        if m:
            return float(m.group(1)), float(m.group(2))
    except (urllib.error.URLError, OSError, ValueError, AttributeError):
        pass
    return DECALAGE_IR_P2


def mesurer_epaisseur(ip, x, y):
    """Mesure l'épaisseur du matériau au point (x, y) mm du plateau.
    La tête se déplace tout de suite (laser éteint), puis revient à l'origine.
    Renvoie (épaisseur en mm ou None, détails pour le diagnostic)."""
    verifier_libre(ip)
    dx, _ = decalage_ir(ip)
    tx = x - dx
    if tx < 0:
        raise ValueError(f"Point trop à gauche : la mesure n'est possible qu'à partir de X = {dx:.0f} mm.")
    details = {"decalage_ir": dx, "tete": (round(tx, 3), round(y, 3))}
    try:
        deplacer_tete(ip, tx, y)
        _post_json(ip, "/peripheral/fill_light", {"action": "set_bri", "idx": 0, "value": 0})
        _post_json(ip, "/peripheral/ir_led", {"action": "on", "index": 1})
        time.sleep(0.2)
        brut = _post_json(ip, "/peripheral/ir_measure_distance",
                          {"action": "get_distance", "type": "single"}, timeout=30)
        details["reponse"] = brut
    finally:
        for chemin, donnees in (("/peripheral/ir_led", {"action": "off", "index": 1}),
                                ("/peripheral/fill_light", {"action": "set_bri", "idx": 0, "value": 255})):
            try:
                _post_json(ip, chemin, donnees)
            except (urllib.error.URLError, OSError):
                pass
        tete_origine(ip)
    try:
        rep = json.loads(brut)
        z = float((rep.get("data") or rep)["distance"])
    except (ValueError, KeyError, TypeError, AttributeError):
        return None, details
    # Comme xTool : en mode plan, la valeur rendue est l'épaisseur, valide de 0 à 25 mm
    return (z if 0 <= z <= 25 else None), details


# --- Caméra de la P2 ----------------------------------------------------------

def _dossier_cache():
    d = os.path.join(os.path.expanduser("~"), ".cache", "xtool-inkscape")
    os.makedirs(d, exist_ok=True)
    return d


def calibration_camera(ip):
    """Calibrage de la caméra plateau : lu sur la machine, gardé en cache."""
    cache = os.path.join(_dossier_cache(), f"global_calib_{ip}.json")
    try:
        texte = _get(ip, "/file?action=download&filename=global_calib.json", timeout=30)
        cal = json.loads(texte)
        with open(cache, "w", encoding="utf-8") as f:
            f.write(texte)
        return cal
    except (urllib.error.URLError, OSError, ValueError):
        if os.path.exists(cache):
            with open(cache, encoding="utf-8") as f:
                return json.load(f)
        raise


def photo_brute(ip, eclairage=True):
    """Photo JPEG de la caméra plateau (vue large)."""
    if eclairage:
        try:
            _post_json(ip, "/peripheral/fill_light", {"action": "set_bri", "idx": 0, "value": 255})
        except (urllib.error.URLError, OSError):
            pass
    try:
        _post_json(ip, "/camera/exposure?stream=0", {"value": 80}, port=PORT_CAMERA)
    except (urllib.error.URLError, OSError):
        pass
    return _get(ip, "/camera/snap?stream=0", timeout=60, port=PORT_CAMERA, brut=True)


def redresser(jpeg, cal):
    """Corrige la déformation de l'objectif avec la grille de calibrage.
    Résultat : image PIL de image_dst_w x image_dst_h pixels, 4 px/mm,
    pixel (0, 0) = origine de la machine. Vérifié identique à xTool Studio."""
    import numpy as np
    from PIL import Image

    pts = re.findall(r"\[([-\d.]+),([-\d.]+)\]", cal["data0"])
    gw, gh = cal["grid_num_w"], cal["grid_num_h"]
    grille = np.array(pts, dtype=float).reshape(gh, gw, 2)
    src = np.asarray(Image.open(io.BytesIO(jpeg)).convert("RGB"))
    W, H = cal["image_dst_w"], cal["image_dst_h"]
    pas = 40.0  # 10 mm entre deux nœuds de la grille
    ys, xs = np.mgrid[0:H, 0:W].astype(float)
    gx = np.clip(xs / pas, 0, gw - 1.0001)
    gy = np.clip(ys / pas, 0, gh - 1.0001)
    i0, j0 = gx.astype(int), gy.astype(int)
    fx, fy = (gx - i0)[..., None], (gy - j0)[..., None]
    p = (grille[j0, i0] * (1 - fx) * (1 - fy) + grille[j0, i0 + 1] * fx * (1 - fy)
         + grille[j0 + 1, i0] * (1 - fx) * fy + grille[j0 + 1, i0 + 1] * fx * fy)
    sx = np.clip(np.rint(p[..., 0]).astype(int), 0, src.shape[1] - 1)
    sy = np.clip(np.rint(p[..., 1]).astype(int), 0, src.shape[0] - 1)
    return Image.fromarray(src[sy, sx])


PX_PAR_MM = 4.0
