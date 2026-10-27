# Notes sur le protocole xTool

Notes relevées en étudiant xTool Studio 1.9.14 (paquet `.deb` pour Linux,
fichiers `resources/exts.zip` → `P2/index.js`, `F1Ultra/index.js`) et de
vrais travaux envoyés par ce logiciel. Elles peuvent servir à d'autres
projets.

Sauf mention contraire, ces informations ont été vérifiées sur une P2,
firmware 40.21.025.2020.01, `sub_version` V1.

## xTool P2 : HTTP, port 8080

| Requête | Rôle |
|---|---|
| `GET /processing/print_type` | état : `P_IDLE`, `P_SLEEP`, `P_WORK_DONE`… |
| `GET /device/machineInfo` | informations sur la machine |
| `POST /processing/upload?gcodeType=processing&fileType=txt` | envoi du G-code, en texte brut ; la machine attend ensuite l'appui sur son bouton |
| `POST /peripheral/laser_head` `{"action":"go_to","waitTime":30000,"x":..,"y":..,"s":0,"f":9600}` | déplacement immédiat de la tête |
| `POST /peripheral/fill_light` `{"action":"set_bri","idx":0,"value":255}` | éclairage intérieur |
| `GET /file?action=download&filename=global_calib.json` | calibrage de la caméra |

La P2 n'a pas de « walk border » laser. Le cadrage est donc envoyé comme un
travail G-code ordinaire à puissance nulle (S0), qui fait deux fois le tour du
dessin. Comme tout travail, il attend le bouton : on peut ainsi le regarder
de près.

### Caméra : port 8329

- `GET /camera/snap?stream=0` : vue large, JPEG 4656 × 3496 ;
  `stream=1` : vue rapprochée.
- `POST /camera/exposure?stream=0` `{"value":80}` : exposition.
- Redressement : `global_calib.json` contient `data0` = une grille de
  62 × 32 points `[x, y]`, ligne par ligne, dans la photo brute. Chaque point
  correspond à un nœud placé tous les 40 px dans l'image redressée, en
  partant de (0, 0). L'image redressée fait 2440 × 1220 px, soit 4 px/mm,
  et couvre 610 × 305 mm depuis l'origine. Le résultat a été vérifié
  identique à l'image `global_correct.png` produite par xTool Studio (écart
  moyen de 0,05 niveau).

### G-code P2

- `S` = puissance % × 10 (0–1000) ; `F` = vitesse en mm/min.
- Hauteur de tête : `G0Z{25 − épaisseur}`. Un vrai travail à 3 mm donne `Z22`.
- Chaque bloc commence par :
  - `M2519S{type}T0`, avec 1 = marquage, 3 = découpe, 2 = image,
    4 = remplissage ;
  - `M15 S{air}`, l'air assisté de 0 à 255. xTool applique un minimum de
    30 % quand l'air est activé.
- Comme xTool, la puissance et la vitesse sont redonnées au premier `G1`
  après chaque `G0`.
- Gravure par balayage (`# P2 BITMAP HEAD`) :
  - lignes dans les deux sens ;
  - `S` modal ;
  - dépassement en bout de ligne = 1,125 · v² / (2 · 3600) mm, avec v en
    mm/s. On obtient 14,06 mm à 300 mm/s, comme xTool.

## xTool F1 Ultra

- Protocole V1 : même envoi qu'avec la P2, sur le port 8080
  (`fileType=txt` ou `xf`).
- Protocole V2 : `/v1/filetransfer` et `/v1/processing/upload/config` par
  socket. **Pas encore décodé.**
- G-code :
  - `G21` = laser bleu (diode) ;
  - `G22` = laser rouge (infrarouge) ;
  - `G0Q30` = fréquence en kHz ;
  - `M523P40`.
- Fichier `.xf` : une archive tar contenant `preview.jpg`,
  `description.json`, `motion.gcode` et `border.gcode`.
