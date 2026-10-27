"""Gravure par balayage (images et remplissages) pour la P2.

Format relevé dans xTool Studio : en-tête « P2 BITMAP HEAD », commande M2519
S2 (image) ou S4 (remplissage), lignes balayées dans les deux sens, puissance
S modale (0..1000), dépassement (overscan) laser éteint en bout de ligne pour
que la tête soit à vitesse constante quand elle grave.
"""
import numpy as np
from PIL import Image

from xtool_common import TYPES_P2, _fmt

ACCEL_BITMAP = 3600.0  # mm/s², valeur xTool pour la P2
NIVEAUX_GRIS = 64


def depassement(vitesse):
    """Distance de dépassement (mm), même formule qu'xTool : 1,125 x v²/2a."""
    return 1.125 * vitesse * vitesse / (2 * ACCEL_BITMAP)


def puissances(image, mode, p_max, p_min=0.0):
    """Image PIL -> tableau d'entiers S (0..1000) ligne par ligne.
    mode : 'gris', 'tramage' (Floyd-Steinberg) ou 'seuil'."""
    gris = image.convert("L")
    s_max, s_min = p_max * 10, p_min * 10
    if mode == "gris":
        l = np.asarray(gris, dtype=float) / 255.0
        noir = 1.0 - l
        noir = np.round(noir * (NIVEAUX_GRIS - 1)) / (NIVEAUX_GRIS - 1)
        s = np.where(noir > 0, s_min + noir * (s_max - s_min), 0)
        return np.rint(s).astype(int)
    if mode == "tramage":
        bits = np.asarray(gris.convert("1"), dtype=bool)  # Floyd-Steinberg
    else:
        bits = np.asarray(gris, dtype=int) >= 128
    return np.where(bits, 0, int(round(s_max)))


def lignes_balayage(s, x0, y0, resolution, vitesse, x_max):
    """Génère les lignes G-code d'un balayage.
    s : tableau S (lignes x colonnes) ; (x0, y0) coin haut-gauche en mm ;
    resolution en lignes/mm ; x_max : limite de la zone de travail."""
    pas = 1.0 / resolution
    sur = depassement(vitesse)
    out = [f"G1F{int(round(vitesse * 60))}S0"]
    vers_droite = True
    for j in range(s.shape[0]):
        ligne = s[j]
        allumes = np.nonzero(ligne)[0]
        if allumes.size == 0:
            continue
        i_deb, i_fin = int(allumes[0]), int(allumes[-1]) + 1
        y = y0 + (j + 0.5) * pas
        # suites de pixels de même puissance entre i_deb et i_fin
        morceau = ligne[i_deb:i_fin]
        coupures = np.nonzero(np.diff(morceau))[0] + 1
        bornes = [0, *coupures.tolist(), len(morceau)]
        suites = [(i_deb + bornes[k], i_deb + bornes[k + 1], int(morceau[bornes[k]]))
                  for k in range(len(bornes) - 1)]
        xa, xb = x0 + i_deb * pas, x0 + i_fin * pas
        if vers_droite:
            out.append(f"G0X{_fmt(max(0.0, xa - sur))}Y{_fmt(y)}")
            out.append(f"G1X{_fmt(xa)}S0")
            for _, fin, p in suites:
                out.append(f"G1X{_fmt(x0 + fin * pas)}S{p}")
            out.append(f"G1X{_fmt(min(x_max, xb + sur))}S0")
        else:
            out.append(f"G0X{_fmt(min(x_max, xb + sur))}Y{_fmt(y)}")
            out.append(f"G1X{_fmt(xb)}S0")
            for deb, _, p in reversed(suites):
                out.append(f"G1X{_fmt(x0 + deb * pas)}S{p}")
            out.append(f"G1X{_fmt(max(0.0, xa - sur))}S0")
        vers_droite = not vers_droite
    return out


def bloc_p2(s, x0, y0, resolution, vitesse, puissance, z, air, type_="image",
            mode="gris", x_max=600.0, passes=1):
    """Bloc complet « P2 BITMAP » prêt à insérer entre l'en-tête et la fin."""
    s_air = round(max(30, air) * 2.55) if air > 0 else 0
    config = (f'{{"powerFactor":{_fmt(puissance / 100)},"density":{_fmt(resolution)},'
              f'"power":[0,{int(round(puissance * 10))}],"bitmapMode":"{mode}","isVector":false}}')
    out = [
        "# P2 BITMAP HEAD",
        "G4 P0.1",
        "# motion_start",
        f"# blockConfig={config}",
        f"M2519S{TYPES_P2[type_]}T0",
        f"M15 S{s_air}",
        f"G0Z{z:.3f}",
    ]
    corps = lignes_balayage(s, x0, y0, resolution, vitesse, x_max)
    for _ in range(passes):
        out += corps
    out += ["# P2 BITMAP TAIL", "# motion_end"]
    return out


def charger(chemin):
    return Image.open(chemin)
