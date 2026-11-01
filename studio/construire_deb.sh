#!/usr/bin/env bash
# Construit le paquet Debian/Ubuntu d'Atelier Laser : dist/atelier-laser_VERSION_all.deb
# Installation ensuite : sudo apt install ./dist/atelier-laser_VERSION_all.deb
set -euo pipefail
VERSION="${1:-0.1.0}"
ICI="$(cd "$(dirname "$0")" && pwd)"
RACINE="$(dirname "$ICI")"
SORTIE="$RACINE/dist"
TRAVAIL="$(mktemp -d)"
trap 'rm -rf "$TRAVAIL"' EXIT
P="$TRAVAIL/atelier-laser"

# Programme : /usr/share/atelier-laser (le code commun de l'extension à la racine)
install -d "$P/usr/share/atelier-laser/studio/web"
install -m 644 "$RACINE"/{xtool_common.py,xtool_raster.py,materiaux.json} "$P/usr/share/atelier-laser/"
install -m 755 "$ICI/atelier_laser.py" "$P/usr/share/atelier-laser/studio/"
install -m 644 "$ICI"/web/* "$P/usr/share/atelier-laser/studio/web/"

install -d "$P/usr/bin"
cat > "$P/usr/bin/atelier-laser" <<'EOF'
#!/bin/sh
exec python3 /usr/share/atelier-laser/studio/atelier_laser.py "$@"
EOF
chmod 755 "$P/usr/bin/atelier-laser"

install -d "$P/usr/share/applications" "$P/usr/share/icons/hicolor/scalable/apps"
install -m 644 "$ICI/web/icone.svg" "$P/usr/share/icons/hicolor/scalable/apps/atelier-laser.svg"
cat > "$P/usr/share/applications/fr.fablab.AtelierLaser.desktop" <<'EOF'
[Desktop Entry]
Type=Application
Name=Atelier Laser
GenericName=Découpe et gravure laser
Comment=Piloter les lasers xTool P2 et F1 Ultra
Exec=atelier-laser
Icon=atelier-laser
Terminal=false
Categories=Graphics;Engineering;
Keywords=laser;xtool;gravure;découpe;P2;F1;
StartupWMClass=fr.fablab.AtelierLaser
EOF

chmod 644 "$P/usr/share/applications/fr.fablab.AtelierLaser.desktop"

D="$P/usr/share/doc/atelier-laser"
install -d "$D"
install -m 644 "$ICI/README.md" "$D/"
cat > "$D/copyright" <<'EOF'
Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/
Upstream-Name: atelier-laser
Source: https://github.com/urruck/inkscape-laser-xtool

Files: *
Copyright: Yvan Godreau
License: GPL-3+
 Voir /usr/share/common-licenses/GPL-3.
EOF
printf 'atelier-laser (%s) unstable; urgency=low\n\n  * Version %s.\n\n -- Yvan Godreau <yvan.godreau@centresocial-chemille.asso.fr>  %s\n' \
  "$VERSION" "$VERSION" "$(date -R)" | gzip -9n > "$D/changelog.gz"
chmod 644 "$D"/*

install -d "$P/DEBIAN"
cat > "$P/DEBIAN/control" <<EOF
Package: atelier-laser
Version: $VERSION
Section: graphics
Priority: optional
Architecture: all
Depends: python3 (>= 3.10), python3-numpy, python3-pil, python3-gi, gir1.2-gtk-4.0, gir1.2-webkit-6.0
Suggests: inkscape
Installed-Size: $(du -sk "$P/usr" | cut -f1)
Maintainer: Yvan Godreau <yvan.godreau@centresocial-chemille.asso.fr>
Homepage: https://github.com/urruck/inkscape-laser-xtool
Description: découpe et gravure avec les lasers xTool P2 et F1 Ultra
 Logiciel autonome, en français, dont l'interface reprend celle de
 xTool Studio : dessin, import SVG et images, réglages par objet,
 caméra et encadrement de la P2, aperçu et envoi du travail par le réseau.
EOF

install -d "$SORTIE"
dpkg-deb --root-owner-group --build "$P" "$SORTIE/atelier-laser_${VERSION}_all.deb"
