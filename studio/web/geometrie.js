// Géométrie : transforme les éléments SVG (chemins, formes) en polylignes,
// en mm, prêtes pour le G-code. Remplace inkex.bezier de l'extension Inkscape.
"use strict";

const Geo = (() => {
  const RE_NOMBRE = /-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;

  // Découpe un attribut « d » en commandes [lettre, [nombres]]
  function lireChemin(d) {
    const res = [];
    const re = /([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g;
    let m;
    while ((m = re.exec(d))) {
      const lettre = m[1];
      let nums;
      if ("Aa".includes(lettre)) nums = lireArc(m[2]);
      else nums = (m[2].match(RE_NOMBRE) || []).map(Number);
      res.push([lettre, nums]);
    }
    return res;
  }

  // Les drapeaux des arcs peuvent être collés (« 0 01 1 », « 1110 »)
  function lireArc(texte) {
    const out = [];
    let i = 0;
    let k = 0;
    const s = texte;
    while (i < s.length) {
      while (i < s.length && /[\s,]/.test(s[i])) i++;
      if (i >= s.length) break;
      const pos = k % 7;
      if (pos === 3 || pos === 4) {
        out.push(s[i] === "1" ? 1 : 0);
        i++;
      } else {
        RE_NOMBRE.lastIndex = i;
        const m = RE_NOMBRE.exec(s);
        if (!m || m.index !== i) break;
        out.push(Number(m[0]));
        i += m[0].length;
      }
      k++;
    }
    return out;
  }

  function nCourbe(flechemax, tol) {
    return Math.max(2, Math.min(400, Math.ceil(Math.sqrt(flechemax / Math.max(tol, 1e-6)))));
  }

  function cubique(out, p0, p1, p2, p3, tol) {
    const ax = p0[0] - 2 * p1[0] + p2[0], ay = p0[1] - 2 * p1[1] + p2[1];
    const bx = p1[0] - 2 * p2[0] + p3[0], by = p1[1] - 2 * p2[1] + p3[1];
    const n = nCourbe(0.75 * Math.max(Math.hypot(ax, ay), Math.hypot(bx, by)), tol);
    for (let i = 1; i <= n; i++) {
      const t = i / n, u = 1 - t;
      out.push([
        u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
        u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
      ]);
    }
  }

  function quadratique(out, p0, p1, p2, tol) {
    const ax = p0[0] - 2 * p1[0] + p2[0], ay = p0[1] - 2 * p1[1] + p2[1];
    const n = nCourbe(0.25 * Math.hypot(ax, ay), tol);
    for (let i = 1; i <= n; i++) {
      const t = i / n, u = 1 - t;
      out.push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]);
    }
  }

  // Arc elliptique SVG (paramétrisation par les extrémités -> centre)
  function arc(out, p0, rx, ry, phi, grand, sens, p1, tol) {
    if (rx === 0 || ry === 0 || (p0[0] === p1[0] && p0[1] === p1[1])) { out.push(p1); return; }
    rx = Math.abs(rx); ry = Math.abs(ry);
    const f = (phi * Math.PI) / 180, cf = Math.cos(f), sf = Math.sin(f);
    const dx = (p0[0] - p1[0]) / 2, dy = (p0[1] - p1[1]) / 2;
    const x1 = cf * dx + sf * dy, y1 = -sf * dx + cf * dy;
    const l = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
    if (l > 1) { rx *= Math.sqrt(l); ry *= Math.sqrt(l); }
    const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
    const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
    let c = Math.sqrt(Math.max(0, num / den));
    if (grand === sens) c = -c;
    const cxp = (c * rx * y1) / ry, cyp = (-c * ry * x1) / rx;
    const cx = cf * cxp - sf * cyp + (p0[0] + p1[0]) / 2;
    const cy = sf * cxp + cf * cyp + (p0[1] + p1[1]) / 2;
    const ang = (ux, uy, vx, vy) => {
      const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
      return a;
    };
    const t1 = ang(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry);
    let dt = ang((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry);
    if (!sens && dt > 0) dt -= 2 * Math.PI;
    else if (sens && dt < 0) dt += 2 * Math.PI;
    const r = Math.max(rx, ry);
    const pasMax = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - tol / r)));
    const n = Math.max(2, Math.min(720, Math.ceil(Math.abs(dt) / Math.max(pasMax, 1e-3))));
    for (let i = 1; i <= n; i++) {
      const t = t1 + (dt * i) / n;
      const ex = rx * Math.cos(t), ey = ry * Math.sin(t);
      out.push([cf * ex - sf * ey + cx, sf * ex + cf * ey + cy]);
    }
  }

  // « d » -> liste de sous-chemins [[x,y],...] (coordonnées locales)
  function aplatirChemin(d, tol) {
    const cmds = lireChemin(d);
    const sous = [];
    let cour = null;
    let p = [0, 0], debut = [0, 0], ctrl = null, prec = "";
    const nouveau = (pt) => { cour = [pt]; sous.push(cour); };
    for (const [lettre, n] of cmds) {
      const rel = lettre === lettre.toLowerCase() && lettre !== "z";
      const L = lettre.toUpperCase();
      const r = (x, y) => (rel ? [p[0] + x, p[1] + y] : [x, y]);
      let i = 0;
      if (L === "Z") {
        if (cour) { cour.push([debut[0], debut[1]]); }
        p = [debut[0], debut[1]];
        cour = null;
        prec = "Z";
        ctrl = null;
        continue;
      }
      do {
        if (!cour && L !== "M") nouveau([p[0], p[1]]);
        switch (L) {
          case "M": {
            const q = r(n[i], n[i + 1]); i += 2;
            if (i === 2) { nouveau(q); debut = q; } else cour.push(q);
            p = q; ctrl = null;
            break;
          }
          case "L": { const q = r(n[i], n[i + 1]); i += 2; cour.push(q); p = q; ctrl = null; break; }
          case "H": { const q = [rel ? p[0] + n[i] : n[i], p[1]]; i += 1; cour.push(q); p = q; ctrl = null; break; }
          case "V": { const q = [p[0], rel ? p[1] + n[i] : n[i]]; i += 1; cour.push(q); p = q; ctrl = null; break; }
          case "C": {
            const c1 = r(n[i], n[i + 1]), c2 = r(n[i + 2], n[i + 3]), q = r(n[i + 4], n[i + 5]); i += 6;
            cubique(cour, p, c1, c2, q, tol); ctrl = c2; p = q; break;
          }
          case "S": {
            const c1 = ctrl && "CS".includes(prec) ? [2 * p[0] - ctrl[0], 2 * p[1] - ctrl[1]] : p;
            const c2 = r(n[i], n[i + 1]), q = r(n[i + 2], n[i + 3]); i += 4;
            cubique(cour, p, c1, c2, q, tol); ctrl = c2; p = q; break;
          }
          case "Q": {
            const c1 = r(n[i], n[i + 1]), q = r(n[i + 2], n[i + 3]); i += 4;
            quadratique(cour, p, c1, q, tol); ctrl = c1; p = q; break;
          }
          case "T": {
            const c1 = ctrl && "QT".includes(prec) ? [2 * p[0] - ctrl[0], 2 * p[1] - ctrl[1]] : p;
            const q = r(n[i], n[i + 1]); i += 2;
            quadratique(cour, p, c1, q, tol); ctrl = c1; p = q; break;
          }
          case "A": {
            const q = r(n[i + 5], n[i + 6]);
            arc(cour, p, n[i], n[i + 1], n[i + 2], n[i + 3], n[i + 4], q, tol); i += 7;
            p = q; ctrl = null; break;
          }
          default: i = n.length;
        }
        prec = L;
      } while (i < n.length && i > 0);
    }
    return sous.filter((s) => s.length >= 2);
  }

  const num = (el, a, def = 0) => {
    const v = parseFloat(el.getAttribute(a));
    return Number.isFinite(v) ? v : def;
  };

  function ellipse(cx, cy, rx, ry, tol) {
    const r = Math.max(rx, ry);
    const pas = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - tol / Math.max(r, 1e-6))));
    const n = Math.max(12, Math.min(720, Math.ceil((2 * Math.PI) / Math.max(pas, 1e-3))));
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = (2 * Math.PI * i) / n;
      pts.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]);
    }
    return [pts];
  }

  // Élément SVG -> sous-chemins locaux
  function localPolylignes(el, tol) {
    switch (el.tagName.toLowerCase()) {
      case "path": return aplatirChemin(el.getAttribute("d") || "", tol);
      case "rect": {
        const x = num(el, "x"), y = num(el, "y"), w = num(el, "width"), h = num(el, "height");
        if (w <= 0 || h <= 0) return [];
        let rx = el.hasAttribute("rx") ? num(el, "rx") : num(el, "ry");
        let ry = el.hasAttribute("ry") ? num(el, "ry") : rx;
        rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2);
        if (rx > 0 && ry > 0) {
          const d = `M${x + rx},${y}H${x + w - rx}A${rx},${ry} 0 0 1 ${x + w},${y + ry}V${y + h - ry}` +
            `A${rx},${ry} 0 0 1 ${x + w - rx},${y + h}H${x + rx}A${rx},${ry} 0 0 1 ${x},${y + h - ry}` +
            `V${y + ry}A${rx},${ry} 0 0 1 ${x + rx},${y}Z`;
          return aplatirChemin(d, tol);
        }
        return [[[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]];
      }
      case "circle": { const r = num(el, "r"); return r > 0 ? ellipse(num(el, "cx"), num(el, "cy"), r, r, tol) : []; }
      case "ellipse": {
        const rx = num(el, "rx"), ry = num(el, "ry");
        return rx > 0 && ry > 0 ? ellipse(num(el, "cx"), num(el, "cy"), rx, ry, tol) : [];
      }
      case "line": return [[[num(el, "x1"), num(el, "y1")], [num(el, "x2"), num(el, "y2")]]];
      case "polyline":
      case "polygon": {
        const v = (el.getAttribute("points") || "").match(RE_NOMBRE) || [];
        const pts = [];
        for (let i = 0; i + 1 < v.length; i += 2) pts.push([+v[i], +v[i + 1]]);
        if (el.tagName.toLowerCase() === "polygon" && pts.length > 2) pts.push(pts[0]);
        return pts.length >= 2 ? [pts] : [];
      }
      default: return [];
    }
  }

  const FORMES = "path,rect,circle,ellipse,line,polyline,polygon";

  function appliquer(m, p) { return [m.a * p[0] + m.c * p[1] + m.e, m.b * p[0] + m.d * p[1] + m.f]; }
  function echelle(m) { return Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1; }

  // Matrice élément -> repère de la scène (mm)
  function versScene(el, scene) {
    return scene.getScreenCTM().inverse().multiply(el.getScreenCTM());
  }

  // Polylignes en mm de tous les tracés d'un groupe d'objet
  function polylignesObjet(groupe, scene, tolMm) {
    const out = [];
    for (const el of groupe.querySelectorAll(FORMES)) {
      if (el.closest(".hit,defs,clipPath,mask,pattern,marker,symbol")) continue;
      const m = versScene(el, scene);
      const tol = tolMm / echelle(m);
      for (const s of localPolylignes(el, tol)) out.push(s.map((p) => appliquer(m, p)));
    }
    return out;
  }

  // Ordre « plus proche voisin » pour limiter les déplacements à vide
  function ordonner(chemins) {
    const restants = chemins.slice();
    const ordre = [];
    let pos = [0, 0];
    while (restants.length) {
      let iMin = 0, dMin = Infinity, inverse = false;
      for (let i = 0; i < restants.length; i++) {
        const c = restants[i];
        const d0 = Math.hypot(pos[0] - c[0][0], pos[1] - c[0][1]);
        if (d0 < dMin) { dMin = d0; iMin = i; inverse = false; }
        const fin = c[c.length - 1];
        const ferme = Math.hypot(fin[0] - c[0][0], fin[1] - c[0][1]) < 1e-6;
        if (!ferme) {
          const d1 = Math.hypot(pos[0] - fin[0], pos[1] - fin[1]);
          if (d1 < dMin) { dMin = d1; iMin = i; inverse = true; }
        }
      }
      let c = restants.splice(iMin, 1)[0];
      if (inverse) c = c.slice().reverse();
      ordre.push(c);
      pos = c[c.length - 1];
    }
    return ordre;
  }

  function boite(chemins) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const c of chemins) for (const [x, y] of c) {
      if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
    }
    return [x0, y0, x1, y1];
  }

  function longueur(chemins) {
    let l = 0;
    for (const c of chemins) for (let i = 1; i < c.length; i++) l += Math.hypot(c[i][0] - c[i - 1][0], c[i][1] - c[i - 1][1]);
    return l;
  }

  return { aplatirChemin, localPolylignes, polylignesObjet, versScene, appliquer, echelle, ordonner, boite, longueur, FORMES };
})();
