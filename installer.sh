#!/usr/bin/env bash
# Installe l'extension dans Inkscape (dossier utilisateur, sans sudo).
# Gère Inkscape classique et Inkscape Flatpak.
set -euo pipefail
ICI="$(cd "$(dirname "$0")" && pwd)"
python3 "$ICI/generer_inx.py"
DOSSIERS=("${XDG_CONFIG_HOME:-$HOME/.config}/inkscape/extensions")
[ -d "$HOME/.var/app/org.inkscape.Inkscape" ] && DOSSIERS+=("$HOME/.var/app/org.inkscape.Inkscape/config/inkscape/extensions")
for DEST in "${DOSSIERS[@]}"; do
  mkdir -p "$DEST"
  for f in xtool_laser.inx xtool_laser.py xtool_camera.inx xtool_camera.py xtool_common.py xtool_raster.py materiaux.json; do
    ln -sf "$ICI/$f" "$DEST/$f"
  done
  echo "Extension installée dans $DEST"
done
echo "Relancez Inkscape : menu Extensions > Laser xTool > Envoyer vers laser xTool"
