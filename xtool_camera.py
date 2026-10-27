#!/usr/bin/env python3
"""Extension Inkscape : photo du plateau de la P2, redressée et placée à
l'échelle en fond (calque verrouillé « Caméra P2 »)."""
import base64
import io
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import inkex  # noqa: E402

import xtool_common as xc  # noqa: E402

ID_CALQUE = "xtool-camera-p2"


class XToolCamera(inkex.EffectExtension):
    def add_arguments(self, pars):
        pars.add_argument("--ip", default="192.168.1.240")
        pars.add_argument("--opacite", type=int, default=100)
        pars.add_argument("--page", type=inkex.Boolean, default=True)
        pars.add_argument("--eclairage", type=inkex.Boolean, default=True)

    def effect(self):
        ip = self.options.ip.strip()
        if not ip:
            raise inkex.AbortExtension("Indiquez l'adresse IP de la P2.")
        try:
            xc.verifier_libre(ip)
            cal = xc.calibration_camera(ip)
            image = xc.redresser(xc.photo_brute(ip, self.options.eclairage), cal)
        except (OSError, RuntimeError, ValueError, KeyError) as e:
            raise inkex.AbortExtension(f"Photo impossible : {e}")

        tampon = io.BytesIO()
        image.save(tampon, "JPEG", quality=85)
        donnees = "data:image/jpeg;base64," + base64.b64encode(tampon.getvalue()).decode("ascii")

        svg = self.svg
        if self.options.page:
            larg, haut = xc.MACHINES["P2"]["zone"]
            svg.set("width", f"{larg:g}mm")
            svg.set("height", f"{haut:g}mm")
            svg.set("viewBox", f"0 0 {larg:g} {haut:g}")
        mm = svg.unittouu("1mm")

        calque = svg.getElementById(ID_CALQUE)
        if calque is None:
            calque = inkex.Layer.new("Caméra P2", id=ID_CALQUE)
            svg.insert(0, calque)  # tout en dessous
        else:
            for enfant in list(calque):
                calque.remove(enfant)
        calque.set("sodipodi:insensitive", "true")

        img = inkex.Image()
        img.set("xlink:href", donnees)
        img.set("x", "0")
        img.set("y", "0")
        img.set("width", str(image.width / xc.PX_PAR_MM * mm))
        img.set("height", str(image.height / xc.PX_PAR_MM * mm))
        img.set("preserveAspectRatio", "none")
        img.style["opacity"] = str(max(5, min(100, self.options.opacite)) / 100)
        calque.append(img)

        inkex.errormsg(
            f"Photo placée dans le calque verrouillé « Caméra P2 » "
            f"({image.width / xc.PX_PAR_MM:g} x {image.height / xc.PX_PAR_MM:g} mm). "
            f"Calibrage prévu pour {cal.get('thick0', '?')} mm d'épaisseur.")


if __name__ == "__main__":
    XToolCamera().run()
