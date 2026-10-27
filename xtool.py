#!/usr/bin/env python3
"""Outil en ligne de commande pour les lasers xTool.

  xtool.py sonder IP                     interroge la machine (lecture seule)
  xtool.py envoyer IP fichier.gcode      envoie un G-code (démarrage au bouton)
  xtool.py cadrer IP xmin ymin xmax ymax P2 : tête aux 4 coins, laser éteint
  xtool.py photo IP image.jpg            P2 : photo du plateau redressée
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import xtool_common as xc  # noqa: E402


def main(args):
    try:
        if len(args) >= 2 and args[0] == "sonder":
            for chemin, rep in xc.sonder(args[1]).items():
                print(f"== {chemin}\n{rep[:2000]}\n")
            return 0
        if len(args) >= 3 and args[0] == "envoyer":
            ip, fichier = args[1], args[2]
            xc.verifier_libre(ip)
            with open(fichier, encoding="utf-8") as f:
                ok, rep = xc.envoyer(ip, f.read())
            print(("Envoyé. Appuyez sur le bouton de la machine." if ok else "Réponse inattendue :"), rep[:500])
            return 0 if ok else 1
        if len(args) >= 6 and args[0] == "cadrer":
            xc.cadrer(args[1], *map(float, args[2:6]))
            print("Cadrage terminé.")
            return 0
        if len(args) >= 3 and args[0] == "photo":
            ip = args[1]
            xc.verifier_libre(ip)
            image = xc.redresser(xc.photo_brute(ip), xc.calibration_camera(ip))
            image.save(args[2], quality=90)
            print(f"Photo enregistrée : {args[2]} ({image.width}x{image.height} px, 4 px/mm)")
            return 0
    except (OSError, RuntimeError, ValueError) as e:
        print(f"Erreur : {e}")
        return 1
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
