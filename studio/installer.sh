#!/usr/bin/env bash
# Installe Atelier Laser pour l'utilisateur courant (sans sudo) :
# commande « atelier-laser » et raccourci dans le menu des applications.
set -euo pipefail
ICI="$(cd "$(dirname "$0")" && pwd)"
DONNEES="${XDG_DATA_HOME:-$HOME/.local/share}"

manque=()
python3 -c "import numpy" 2>/dev/null || manque+=(python3-numpy)
python3 -c "import PIL" 2>/dev/null || manque+=(python3-pil)
python3 -c "import gi; gi.require_version('Gtk', '4.0'); gi.require_version('WebKit', '6.0')" 2>/dev/null \
  || manque+=(python3-gi gir1.2-gtk-4.0 gir1.2-webkit-6.0)
if [ ${#manque[@]} -gt 0 ]; then
  echo "Paquets manquants. Installez-les avec :"
  echo "  sudo apt install ${manque[*]}"
  echo "(sans WebKit, Atelier Laser s'ouvre dans le navigateur)"
fi

chmod +x "$ICI/atelier_laser.py"
mkdir -p "$HOME/.local/bin" "$DONNEES/applications" "$DONNEES/icons/hicolor/scalable/apps"
ln -sf "$ICI/atelier_laser.py" "$HOME/.local/bin/atelier-laser"
cp "$ICI/web/icone.svg" "$DONNEES/icons/hicolor/scalable/apps/atelier-laser.svg"
cat > "$DONNEES/applications/fr.fablab.AtelierLaser.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Atelier Laser
GenericName=Découpe et gravure laser
Comment=Piloter les lasers xTool P2 et F1 Ultra
Exec=python3 "$ICI/atelier_laser.py"
Icon=atelier-laser
Terminal=false
Categories=Graphics;Engineering;
Keywords=laser;xtool;gravure;découpe;P2;F1;
StartupWMClass=fr.fablab.AtelierLaser
EOF
update-desktop-database "$DONNEES/applications" 2>/dev/null || true
gtk-update-icon-cache -q "$DONNEES/icons/hicolor" 2>/dev/null || true
echo "Atelier Laser installé : menu des applications, ou commande « atelier-laser »."
