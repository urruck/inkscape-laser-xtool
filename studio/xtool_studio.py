"""Matériaux de xTool Studio : lecture de son cache local, sans connexion.

xTool Studio garde les fiches de matériaux consultées (réglages officiels de
xTool) dans sa base IndexedDB : ~/.config/xTool Studio/IndexedDB/. C'est une
base LevelDB (blocs compressés en Snappy) dont les valeurs sont sérialisées
par V8. Ce module lit cette base en lecture seule et convertit les fiches de
la P2 (MP2) et de la F1 Ultra (GS002) au format de materiaux.json.
"""
import os
import struct

DOSSIER_IDB = os.path.join(os.path.expanduser("~"), ".config", "xTool Studio", "IndexedDB",
                           "atomm_renderer_0.indexeddb.leveldb")

# Code xTool de l'appareil -> machine d'Atelier Laser
APPAREILS = {"MP2": "P2", "GS002": "F1U"}
# Type de traitement xTool -> clé de materiaux.json
TYPES = {"VECTOR_ENGRAVING": "marquage", "VECTOR_CUTTING": "decoupe",
         "FILL_VECTOR_ENGRAVING": "gravure", "BITMAP_ENGRAVING": "image"}
# Mode de traitement xTool -> support (None = réglages de base)
SUPPORTS = {"LASER_PLANE": None, "HONEYCOMB_PANEL": "alveole"}
SOURCES_F1U = {"blue": "bleu", "red": "rouge"}


# --- LevelDB ------------------------------------------------------------------

def _varint(b, i):
    r = s = 0
    while True:
        c = b[i]
        i += 1
        r |= (c & 0x7F) << s
        s += 7
        if c < 0x80:
            return r, i


def _snappy(b):
    _, i = _varint(b, 0)
    out = bytearray()
    while i < len(b):
        t = b[i]
        i += 1
        k = t & 3
        if k == 0:  # littéral
            n = t >> 2
            if n >= 60:
                nb = n - 59
                n = int.from_bytes(b[i:i + nb], "little")
                i += nb
            n += 1
            out += b[i:i + n]
            i += n
            continue
        if k == 1:
            n, dist = ((t >> 2) & 7) + 4, ((t >> 5) << 8) | b[i]
            i += 1
        elif k == 2:
            n, dist = (t >> 2) + 1, int.from_bytes(b[i:i + 2], "little")
            i += 2
        else:
            n, dist = (t >> 2) + 1, int.from_bytes(b[i:i + 4], "little")
            i += 4
        for _ in range(n):
            out.append(out[-dist])
    return bytes(out)


def _bloc(f, position, taille):
    f.seek(position)
    d = f.read(taille + 5)
    return _snappy(d[:taille]) if d[taille] == 1 else d[:taille]


def _entrees(d):
    nb_reprises = struct.unpack("<I", d[-4:])[0]
    fin = len(d) - 4 - 4 * nb_reprises
    i, cle = 0, b""
    while i < fin:
        partage, i = _varint(d, i)
        propre, i = _varint(d, i)
        lv, i = _varint(d, i)
        cle = cle[:partage] + d[i:i + propre]
        i += propre
        yield cle, d[i:i + lv]
        i += lv


def _table(chemin):
    """Paires (clé, valeur) d'un fichier .ldb."""
    with open(chemin, "rb") as f:
        f.seek(-48, 2)
        pied = f.read(48)
        _, i = _varint(pied, 0)
        _, i = _varint(pied, i)
        pos_index, i = _varint(pied, i)
        taille_index, _ = _varint(pied, i)
        for _, h in _entrees(_bloc(f, pos_index, taille_index)):
            pos, j = _varint(h, 0)
            taille, _ = _varint(h, j)
            for cle, val in _entrees(_bloc(f, pos, taille)):
                yield cle[:-8], val


def _journal(chemin):
    """Paires (clé, valeur) écrites dans le journal .log (non compressé)."""
    with open(chemin, "rb") as f:
        d = f.read()
    lots, courant = [], b""
    for debut in range(0, len(d), 32768):
        blk, i = d[debut:debut + 32768], 0
        while i + 7 <= len(blk):
            n, typ = struct.unpack("<H", blk[i + 4:i + 6])[0], blk[i + 6]
            if typ == 0:
                break
            morceau = blk[i + 7:i + 7 + n]
            i += 7 + n
            courant = morceau if typ in (1, 2) else courant + morceau
            if typ in (1, 4):
                lots.append(courant)
    for lot in lots:
        i = 12
        for _ in range(struct.unpack("<I", lot[8:12])[0]):
            tag = lot[i]
            n, i = _varint(lot, i + 1)
            cle = lot[i:i + n]
            i += n
            if tag == 1:
                n, i = _varint(lot, i)
                yield cle, lot[i:i + n]
                i += n


# --- Sérialisation V8 -----------------------------------------------------------

class _V8:
    def __init__(self, b, i):
        self.b, self.i, self.refs = b, i, []

    def _vi(self):
        r, self.i = _varint(self.b, self.i)
        return r

    def _texte(self, codage):
        n = self._vi()
        s = self.b[self.i:self.i + n].decode(codage, "replace")
        self.i += n
        return s

    def lire(self):
        b = self.b
        while b[self.i] in (0, 0xFF):  # remplissage, en-tête de version
            self.i += 1
            if b[self.i - 1] == 0xFF:
                self._vi()
        t = chr(b[self.i])
        self.i += 1
        if t == '"':
            return self._texte("latin-1")
        if t == "S":
            return self._texte("utf-8")
        if t == "c":
            return self._texte("utf-16-le")
        if t == "I":
            z = self._vi()
            return (z >> 1) ^ -(z & 1)
        if t == "U":
            return self._vi()
        if t in "ND":
            v = struct.unpack("<d", b[self.i:self.i + 8])[0]
            self.i += 8
            return v
        if t in "TF":
            return t == "T"
        if t in "_0":
            return None
        if t == "o":
            o = {}
            self.refs.append(o)
            while chr(b[self.i]) != "{":
                k = self.lire()
                o[str(k)] = self.lire()
            self.i += 1
            self._vi()
            return o
        if t == "A":
            a = []
            self.refs.append(a)
            for _ in range(self._vi()):
                a.append(self.lire())
            while chr(b[self.i]) != "$":
                self.lire()
                self.lire()
            self.i += 1
            self._vi()
            self._vi()
            return a
        if t == "a":
            self._vi()
            a = {}
            self.refs.append(a)
            while chr(b[self.i]) != "@":
                k = self.lire()
                a[str(k)] = self.lire()
            self.i += 1
            self._vi()
            self._vi()
            return list(a.values())
        if t == "^":
            return self.refs[self._vi()]
        raise ValueError(f"étiquette V8 inconnue {t!r}")


def _decoder(v):
    p = v.find(b"\xff\x0f")  # en-tête Blink, puis sérialisation V8 version 15
    if p < 0 or p > 40:
        return None
    try:
        return _V8(v, p).lire()
    except (ValueError, IndexError, struct.error):
        return None


def objets(dossier=DOSSIER_IDB):
    """Valeurs (dict) de la base, de la plus récente à la plus ancienne écriture."""
    # le journal (.log) est le plus récent, puis les tables par numéro décroissant
    fichiers = sorted((n for n in os.listdir(dossier) if n.endswith((".log", ".ldb"))),
                      key=lambda n: (n.endswith(".log"), n), reverse=True)
    vues = set()
    for nom in fichiers:
        chemin = os.path.join(dossier, nom)
        try:
            paires = list(_journal(chemin) if nom.endswith(".log") else _table(chemin))
        except (OSError, IndexError, struct.error):
            continue  # fichier en cours d'écriture par xTool Studio
        if nom.endswith(".log"):
            paires.reverse()  # dans une table, la version la plus récente vient déjà en premier
        for cle, val in paires:
            if cle in vues:
                continue
            vues.add(cle)
            o = _decoder(val)
            if isinstance(o, dict):
                yield o


# --- Conversion -----------------------------------------------------------------

def _code(v):
    return v.get("code") if isinstance(v, dict) else v


def _reglage(mp):
    cle = TYPES.get(_code(mp.get("processingType")))
    puissance, vitesse = mp.get("power") or 0, mp.get("speed") or 0
    if not cle or puissance <= 0 or vitesse <= 0:  # F1 Ultra : images réglées en points/s, non repris
        return None, None
    r = {"puissance": round(puissance, 1), "vitesse": round(vitesse, 1)}
    if cle in ("marquage", "decoupe"):
        r["passes"] = int(mp.get("repeat") or 1)
    densite = _code(mp.get("density"))
    if cle in ("gravure", "image") and densite:
        r["resolution"] = round(float(densite) / 10, 1)  # lignes/cm -> lignes/mm
    if cle == "image":
        mode = (_code(mp.get("bitmapMode")) or "").lower()
        r["mode"] = "gris" if "gray" in mode or "grey" in mode else "seuil" if mode in ("binary", "threshold") else "tramage"
        if mp.get("minPower"):
            r["puissance_min"] = mp["minPower"]
    if mp.get("frequency"):
        r["frequence"] = mp["frequency"]
    return cle, r


def materiaux(dossier=DOSSIER_IDB):
    """Matériaux de xTool Studio pour la P2 et la F1 Ultra, au format de materiaux.json.
    Liste vide si xTool Studio n'est pas installé ou n'a encore rien consulté."""
    if not os.path.isdir(dossier):
        return []
    fiches, reglages = {}, {}
    for o in objets(dossier):
        if "categoryCode" in o and "name" in o:
            fiches.setdefault(o.get("id"), o)
        elif o.get("deviceCode") in APPAREILS and "materialId" in o:
            cle = (o["deviceCode"], o["materialId"])
            if cle not in reglages or (o.get("updatedAt") or 0) > (reglages[cle].get("updatedAt") or 0):
                reglages[cle] = o
    liste = []
    for (appareil, id_mat), o in reglages.items():
        fiche = fiches.get(id_mat)
        if not fiche:
            continue
        nom = fiche["name"]
        if isinstance(nom, dict):
            nom = nom.get("fr") or nom.get("en") or next(iter(nom.values()), "")
        machine = APPAREILS[appareil]
        variantes = {}  # source laser -> matériau
        for mp in o.get("machineParas") or []:
            mode = _code(mp.get("processingMode"))
            if mode not in SUPPORTS:
                continue
            cle, r = _reglage(mp)
            if not cle:
                continue
            source = SOURCES_F1U.get(_code(mp.get("laserSource"))) if machine == "F1U" else None
            m = variantes.setdefault(source, {"modes": {}})
            support = SUPPORTS[mode]
            if support:
                m["modes"].setdefault(support, {})[cle] = r
            else:
                m[cle] = r
        for source, m in variantes.items():
            # le panneau alvéolé ne garde que ce qui diffère du plateau
            for support, regl in list(m["modes"].items()):
                diff = {k: v for k, v in regl.items() if m.get(k) != v}
                if diff:
                    m["modes"][support] = diff
                else:
                    del m["modes"][support]
            if not m["modes"]:
                del m["modes"]
            if not any(k in m for k in TYPES.values()):
                continue
            suffixe = {"bleu": " · diode bleue", "rouge": " · infrarouge"}.get(source, "")
            mat = {"nom": f"{str(nom).strip()}{suffixe}", "machine": machine, "origine": "xtool",
                   "source": f"xTool Studio, matériau officiel {fiche.get('code') or int(id_mat)}"}
            if source:
                mat["laser"] = source
            if machine == "P2" and fiche.get("thickness"):
                mat["epaisseur"] = float(fiche["thickness"])
            liste.append({**mat, **m})
    liste.sort(key=lambda m: (m["machine"], m["nom"].lower()))
    return liste


if __name__ == "__main__":
    import json
    import sys
    print(json.dumps(materiaux(*sys.argv[1:]), ensure_ascii=False, indent=2))
