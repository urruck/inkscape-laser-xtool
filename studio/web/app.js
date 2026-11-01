// Atelier Laser : interface façon xTool Studio pour les lasers xTool sous Linux.
"use strict";

const NS = "http://www.w3.org/2000/svg";
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (v, d = 1) => Number(v).toLocaleString("fr-FR", { maximumFractionDigits: d, minimumFractionDigits: 0 });
const lireNombre = (s) => parseFloat(String(s).replace(",", ".").replace(/\s/g, ""));
const borne = (v, a, b) => Math.min(b, Math.max(a, v));
const PX_MM_100 = 96 / 25.4; // zoom 100 % = taille réelle à 96 ppp

const MACHINES = {
  P2: { nom: "xTool P2", zone: [600, 305], vmax: 250, vmaxGraver: 600, camera: true, gravure: true },
  F1U: { nom: "xTool F1 Ultra", zone: [220, 220], vmax: 4000, vmaxGraver: 4000, camera: false, gravure: false },
};
const NOMS_TYPES = { contour: "Graver contour", graver: "Graver", couper: "Couper", ignorer: "Ignoré" };
const CLE_MATERIAU = { contour: "marquage", couper: "decoupe" };
const DEFAUTS = {
  contour: { puissance: 30, vitesse: 100, passes: 1, air: 100 },
  couper: { puissance: 90, vitesse: 25, passes: 1, air: 100 },
  graver: { puissance: 20, vitesse: 200, passes: 1, air: 100, lpcm: 100, mode: "seuil", puissance_min: 0 },
  image: { puissance: 10, vitesse: 300, passes: 1, air: 100, lpcm: 100, mode: "tramage", puissance_min: 0 },
};
const MODES = {
  P_IDLE: "Prêt", P_SLEEP: "En veille", P_WORK_DONE: "Travail terminé", P_WORKING: "Traitement en cours",
  P_ONLINE_READY_WORK: "Prêt : appuyez sur le bouton", P_READY: "Prêt : appuyez sur le bouton",
  P_PAUSE: "En pause", P_FINISH: "Terminé", P_ERROR: "Erreur",
};
const MODES_LIBRES = ["P_IDLE", "P_SLEEP", "P_WORK_DONE"];

const etat = {
  objets: [],
  sel: new Set(),
  outil: "selection",
  vue: { zoom: 2, px: 40, py: 40 },
  machine: "P2",
  laser: "bleu",
  frequence: 30,
  materiau: "",
  epaisseur: 3,
  support: "plan", // P2 : "plan" (plateau, épaisseur) ou "alveole" (panneau alvéolé, distance focale)
  focale: 22,
  materiaux: [],
  appareil: { ip: "", connecte: false, mode: null, nom: "", serie: "" },
  projet: { nom: "Sans titre", chemin: null },
  modifie: false,
  camera: { href: null, l: 0, h: 0, visible: true, opacite: 100 },
  grille: true,
  theme: "clair",
  polices: ["Sans", "Serif", "Monospace"],
  avecFenetre: true,
};
let compteur = 1;
const noeuds = new Map();
const histo = { passe: [], futur: [] };
let pressePapiers = [];
let glisse = null;
let espace = false;

// --- Utilitaires d'interface ----------------------------------------------

async function api(chemin, donnees) {
  const r = await fetch("/api/" + chemin, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(donnees || {}),
  });
  const j = await r.json().catch(() => ({ erreur: `Réponse invalide (${r.status})` }));
  if (!r.ok || j.erreur) throw new Error(j.erreur || `Erreur ${r.status}`);
  return j;
}

function toast(message, genre = "", duree = 3800) {
  const t = document.createElement("div");
  t.className = "toast " + genre;
  t.innerHTML = (genre === "erreur" ? icone("alerte", 18) : genre === "ok" ? icone("coche", 18) : "") + `<span>${esc(message)}</span>`;
  $("#toasts").append(t);
  setTimeout(() => t.remove(), duree);
}

function modale({ titre, corps, boutons = [], large = false, fermable = true }) {
  const fond = $("#modale-fond");
  const m = $("#modale");
  m.className = "modale" + (large ? " large" : "");
  m.innerHTML = `<header><h2>${esc(titre)}</h2>${fermable ? '<button class="ico petit" data-fermer data-ic="croix" data-ic-taille="18"></button>' : ""}</header>` +
    `<div class="corps">${corps}</div>` + (boutons.length ? '<footer></footer>' : "");
  const pied = $("footer", m);
  for (const b of boutons) {
    const el = document.createElement("button");
    el.className = "btn " + (b.genre || "secondaire");
    el.innerHTML = (b.icone ? icone(b.icone, 17) : "") + esc(b.texte);
    if (b.desactive) el.disabled = true;
    if (b.id) el.id = b.id;
    el.onclick = () => (b.action ? b.action(el) : fermerModale());
    pied.append(el);
  }
  poserIcones(m);
  $$("[data-fermer]", m).forEach((b) => (b.onclick = fermerModale));
  fond.hidden = false;
  fond.onpointerdown = (e) => { if (e.target === fond && fermable) fermerModale(); };
  const champ = $("input:not([type=hidden]),select", m);
  if (champ) setTimeout(() => champ.focus(), 30);
  return m;
}
function fermerModale() { $("#modale-fond").hidden = true; $("#modale").innerHTML = ""; }
const modaleOuverte = () => !$("#modale-fond").hidden;

function confirmer(titre, texte, oui = "Continuer") {
  return new Promise((res) => {
    modale({
      titre, corps: `<p>${texte}</p>`,
      boutons: [
        { texte: "Annuler", action: () => { fermerModale(); res(false); } },
        { texte: oui, genre: "primaire", action: () => { fermerModale(); res(true); } },
      ],
    });
  });
}

function visuelMachine(machine, actif = true) {
  const c = actif ? "var(--accent)" : "var(--texte-3)";
  if (machine === "F1U") {
    return `<svg viewBox="0 0 62 46"><rect x="13" y="6" width="36" height="34" rx="5" fill="var(--panneau-2)" stroke="var(--bord-fort)"/>` +
      `<rect x="17" y="10" width="28" height="15" rx="3" fill="#ffb347" opacity=".75"/><rect x="17" y="29" width="28" height="7" rx="2" fill="var(--bord)"/>` +
      `<circle cx="41" cy="32.5" r="2" fill="${c}"/></svg>`;
  }
  return `<svg viewBox="0 0 62 46"><rect x="3" y="12" width="56" height="28" rx="4" fill="var(--panneau-2)" stroke="var(--bord-fort)"/>` +
    `<path d="M6 12l4-7h42l4 7z" fill="#3a3f48"/><rect x="11" y="6.5" width="40" height="4" rx="1" fill="#7fb2ff" opacity=".55"/>` +
    `<rect x="8" y="17" width="46" height="17" rx="2" fill="var(--bord)"/><circle cx="52" cy="37" r="1.6" fill="${c}"/></svg>`;
}

// --- Modèle ---------------------------------------------------------------

const machineDe = (m) => m.machine || "P2";
const materiauxMachine = () => etat.materiaux.filter((m) => machineDe(m) === etat.machine);
function materiauCourant() { return materiauxMachine().find((m) => m.nom === etat.materiau) || null; }
// Réglages d'un type pour le support choisi (panneau alvéolé : réglages propres s'il y en a)
function reglageMateriau(mat, cle) {
  if (!mat || !mat[cle]) return null;
  return { ...mat[cle], ...(mat.modes?.[etat.support]?.[cle] || {}) };
}

function paramsPour(type, estImage) {
  const base = type === "graver" ? (estImage ? DEFAUTS.image : DEFAUTS.graver) : DEFAUTS[type];
  const p = { ...DEFAUTS.graver, ...base, type, ignorer: false };
  const mat = materiauCourant();
  const cle = type === "graver" ? (estImage ? "image" : "gravure") : CLE_MATERIAU[type];
  const r = reglageMateriau(mat, cle);
  if (r) {
    for (const k of ["puissance", "vitesse", "passes", "air", "mode", "puissance_min"]) if (r[k] !== undefined) p[k] = r[k];
    if (r.resolution) p.lpcm = r.resolution * 10;
  }
  return p;
}

function typeParDefaut(genre) { return genre === "image" || genre === "texte" ? "graver" : "contour"; }

function nouvelObjet(genre, nom, contenu, b, cadre, extra = {}) {
  const o = {
    id: "o" + compteur++, genre, nom, contenu, b, v: 1,
    x: cadre[0], y: cadre[1], w: cadre[2], h: cadre[3], rot: 0, fx: 1, fy: 1, visible: true, ...extra,
  };
  o.proc = paramsPour(typeParDefaut(genre), genre === "image");
  return o;
}

const objet = (id) => etat.objets.find((o) => o.id === id);
const selection = () => etat.objets.filter((o) => etat.sel.has(o.id));
const typeAffiche = (o) => (o.proc.ignorer ? "ignorer" : o.proc.type);

function echelles(o) {
  return [o.b[2] > 1e-9 ? o.w / o.b[2] : 1, o.b[3] > 1e-9 ? o.h / o.b[3] : 1];
}
function matrice(o) {
  const [sx, sy] = echelles(o);
  const cx = o.x + o.w / 2, cy = o.y + o.h / 2, bcx = o.b[0] + o.b[2] / 2, bcy = o.b[1] + o.b[3] / 2;
  return `translate(${cx} ${cy}) rotate(${o.rot || 0}) scale(${sx * (o.fx || 1)} ${sy * (o.fy || 1)}) translate(${-bcx} ${-bcy})`;
}
// point du repère de l'objet -> mm
function versMonde(o, p) {
  const [sx, sy] = echelles(o);
  const a = ((o.rot || 0) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const x = (p[0] - o.b[0] - o.b[2] / 2) * sx * (o.fx || 1), y = (p[1] - o.b[1] - o.b[3] / 2) * sy * (o.fy || 1);
  return [o.x + o.w / 2 + c * x - s * y, o.y + o.h / 2 + s * x + c * y];
}
function coins(o) {
  const a = ((o.rot || 0) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => {
    const x = (i * o.w) / 2, y = (j * o.h) / 2;
    return [cx + c * x - s * y, cy + s * x + c * y];
  });
}
function boiteObjets(liste) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const o of liste) for (const [x, y] of coins(o)) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return [x0, y0, x1, y1];
}

function mesurer(contenu) {
  const m = $("#mesure-svg");
  m.innerHTML = `<g>${contenu}</g>`;
  const bb = m.firstChild.getBBox();
  m.innerHTML = "";
  return [bb.x, bb.y, bb.width, bb.height];
}

// Remplace le contenu d'un objet sans le déplacer (même échelle, même repère)
function remplacerContenu(o, contenu, b) {
  const [sx, sy] = echelles(o);
  const centre = versMonde(o, [b[0] + b[2] / 2, b[1] + b[3] / 2]);
  o.contenu = contenu;
  o.b = b;
  o.w = b[2] * sx;
  o.h = b[3] * sy;
  o.x = centre[0] - o.w / 2;
  o.y = centre[1] - o.h / 2;
  o.v++;
}

// --- Formes ---------------------------------------------------------------

function contenuTexte(t) {
  const lignes = t.chaine.split("\n");
  const attrs = `font-family="${esc(t.police)}" font-size="${t.taille}" font-weight="${t.gras ? 700 : 400}" font-style="${t.italique ? "italic" : "normal"}" text-anchor="${t.align || "start"}"`;
  const tspans = lignes.map((l, i) => `<tspan x="0" y="${fmtSvg(i * t.taille * (t.interligne || 1.2))}">${esc(l || " ")}</tspan>`).join("");
  return `<text class="forme" ${attrs}>${tspans}</text>`;
}
const fmtSvg = (v) => String(Math.round(v * 1000) / 1000);

function contenuPolygone(n, etoile) {
  const pts = [];
  const k = etoile ? 2 * n : n;
  for (let i = 0; i < k; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / k;
    const r = etoile && i % 2 ? 0.45 : 1;
    pts.push(`${fmtSvg(50 + 50 * r * Math.cos(a))},${fmtSvg(50 + 50 * r * Math.sin(a))}`);
  }
  return `<polygon class="forme" points="${pts.join(" ")}"/>`;
}

function creerForme(genre, x0, y0, x1, y1) {
  let x = Math.min(x0, x1), y = Math.min(y0, y1), w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
  if (genre !== "ligne" && (w < 1 || h < 1)) { w = h = 40; x = x0; y = y0; }
  let o;
  const n = etat.objets.filter((q) => q.genre === genre).length + 1;
  if (genre === "rect") {
    o = nouvelObjet("rect", `Rectangle ${n}`, `<rect class="forme" x="0" y="0" width="100" height="100"/>`, [0, 0, 100, 100], [x, y, w, h]);
  } else if (genre === "ellipse") {
    o = nouvelObjet("ellipse", `Ellipse ${n}`, `<ellipse class="forme" cx="50" cy="50" rx="50" ry="50"/>`, [0, 0, 100, 100], [x, y, w, h]);
  } else if (genre === "polygone") {
    const c = contenuPolygone(5, false);
    o = nouvelObjet("polygone", `Polygone ${n}`, c, mesurer(c), [x, y, w, h], { cotes: 5, etoile: false });
  } else if (genre === "ligne") {
    if (Math.hypot(x1 - x0, y1 - y0) < 1) { x1 = x0 + 50; y1 = y0; }
    const c = `<line class="forme ouvert" x1="${fmtSvg(x0)}" y1="${fmtSvg(y0)}" x2="${fmtSvg(x1)}" y2="${fmtSvg(y1)}"/>`;
    const b = [Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)];
    o = nouvelObjet("ligne", `Ligne ${n}`, c, b, b.slice());
  }
  return o;
}

function creerTexte(p) {
  const t = { chaine: "Texte", police: etat.polices.includes("Ubuntu") ? "Ubuntu" : "Sans", taille: 10, gras: false, italique: false, align: "start" };
  const c = contenuTexte(t);
  const b = mesurer(c);
  const n = etat.objets.filter((q) => q.genre === "texte").length + 1;
  const o = nouvelObjet("texte", `Texte ${n}`, c, b, [p[0], p[1], b[2], b[3]], { texte: t });
  ajouter([o]);
  choisirOutil("selection");
  setTimeout(() => { const ch = $("#pp-texte"); if (ch) { ch.focus(); ch.select(); } }, 20);
}

function ajouter(liste, garderSel = false) {
  memoriser();
  etat.objets.push(...liste);
  if (!garderSel) etat.sel = new Set(liste.map((o) => o.id));
  rafraichir();
}

// --- Historique -------------------------------------------------------------

function cliche() {
  return etat.objets.map((o) => ({ ...o, b: o.b.slice(), proc: { ...o.proc }, texte: o.texte && { ...o.texte } }));
}
function memoriser() {
  histo.passe.push(cliche());
  if (histo.passe.length > 100) histo.passe.shift();
  histo.futur = [];
  marquerModifie();
}
function annuler() {
  if (!histo.passe.length) return;
  histo.futur.push(cliche());
  etat.objets = histo.passe.pop();
  nettoyerSel();
  rafraichir();
}
function retablir() {
  if (!histo.futur.length) return;
  histo.passe.push(cliche());
  etat.objets = histo.futur.pop();
  nettoyerSel();
  rafraichir();
}
function nettoyerSel() { etat.sel = new Set([...etat.sel].filter((id) => objet(id))); }
function marquerModifie(v = true) { etat.modifie = v; $("#modifie").hidden = !v; }

// --- Affichage du canevas -------------------------------------------------------

function majScene() {
  const scene = $("#scene");
  const vus = new Set();
  let prec = null;
  for (const o of etat.objets) {
    let g = noeuds.get(o.id);
    if (!g) { g = document.createElementNS(NS, "g"); g.dataset.id = o.id; noeuds.set(o.id, g); }
    if (g.dataset.v !== String(o.v)) {
      g.innerHTML = o.contenu + '<rect class="hit"/>';
      g.dataset.v = String(o.v);
    }
    const [sx, sy] = echelles(o);
    const hit = g.lastChild;
    const mw = 4 / sx, mh = 4 / sy;
    const hw = Math.max(o.b[2], mw), hh = Math.max(o.b[3], mh);
    hit.setAttribute("x", o.b[0] - (hw - o.b[2]) / 2);
    hit.setAttribute("y", o.b[1] - (hh - o.b[3]) / 2);
    hit.setAttribute("width", hw);
    hit.setAttribute("height", hh);
    g.setAttribute("transform", matrice(o));
    g.setAttribute("class", `obj t-${typeAffiche(o)} g-${o.genre}`);
    g.style.display = o.visible === false ? "none" : "";
    const attendu = prec ? prec.nextSibling : scene.firstChild;
    if (attendu !== g) scene.insertBefore(g, attendu);
    prec = g;
    vus.add(o.id);
  }
  for (const [id, g] of noeuds) if (!vus.has(id)) { g.remove(); noeuds.delete(id); }
}

function el(nom, attrs, parent) {
  const e = document.createElementNS(NS, nom);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.append(e);
  return e;
}

function majSurcouche() {
  const s = $("#surcouche");
  s.innerHTML = "";
  const z = etat.vue.zoom;
  const sel = selection().filter((o) => o.visible !== false);
  if (sel.length === 1 && etat.outil === "selection") {
    const o = sel[0];
    const g = el("g", { transform: `translate(${o.x + o.w / 2} ${o.y + o.h / 2}) rotate(${o.rot || 0})` }, s);
    el("rect", { class: "sel-cadre", x: -o.w / 2, y: -o.h / 2, width: o.w, height: o.h }, g);
    const t = 8 / z;
    const yRot = -o.h / 2 - 26 / z;
    el("line", { class: "tige", x1: 0, y1: -o.h / 2, x2: 0, y2: yRot }, g);
    el("circle", { class: "poignee rot", cx: 0, cy: yRot, r: 5 / z, "data-poignee": "rot", style: "cursor:grab" }, g);
    const curseurs = { "-1,-1": "nwse", "1,1": "nwse", "1,-1": "nesw", "-1,1": "nesw", "0,-1": "ns", "0,1": "ns", "-1,0": "ew", "1,0": "ew" };
    for (const hx of [-1, 0, 1]) for (const hy of [-1, 0, 1]) {
      if (!hx && !hy) continue;
      if ((!hx && o.w * z < 30) || (!hy && o.h * z < 30)) continue;
      if (o.genre === "ligne" && (!hx || !hy)) continue;
      el("rect", {
        class: "poignee", x: (hx * o.w) / 2 - t / 2, y: (hy * o.h) / 2 - t / 2, width: t, height: t, rx: 1.5 / z,
        "data-poignee": `${hx},${hy}`, style: `cursor:${curseurs[hx + "," + hy]}-resize`,
      }, g);
    }
  } else if (sel.length > 1) {
    const [x0, y0, x1, y1] = boiteObjets(sel);
    el("rect", { class: "sel-cadre multi", x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, s);
  }
  if (glisse && glisse.type === "lasso") {
    const [a, b] = [glisse.debut, glisse.fin];
    el("rect", { class: "lasso", x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), width: Math.abs(b[0] - a[0]), height: Math.abs(b[1] - a[1]) }, s);
  }
  if (glisse && glisse.type === "creer") {
    const [a, b] = [glisse.debut, glisse.fin];
    if (glisse.genre === "ligne") el("line", { class: "trace-provisoire", x1: a[0], y1: a[1], x2: b[0], y2: b[1] }, s);
    else if (glisse.genre === "ellipse") el("ellipse", { class: "trace-provisoire", cx: (a[0] + b[0]) / 2, cy: (a[1] + b[1]) / 2, rx: Math.abs(b[0] - a[0]) / 2, ry: Math.abs(b[1] - a[1]) / 2 }, s);
    else el("rect", { class: "trace-provisoire", x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), width: Math.abs(b[0] - a[0]), height: Math.abs(b[1] - a[1]) }, s);
  }
}

function majVue() {
  const { zoom, px, py } = etat.vue;
  $("#vue").setAttribute("transform", `translate(${px} ${py}) scale(${zoom})`);
  $("#zoom-val").textContent = `${Math.round((zoom / PX_MM_100) * 100)} %`;
  majRegles();
  majSurcouche();
}

function majPlateau() {
  const [l, h] = MACHINES[etat.machine].zone;
  for (const id of ["plateau", "grille", "bord-plateau"]) {
    $("#" + id).setAttribute("width", l);
    $("#" + id).setAttribute("height", h);
  }
  const cam = $("#fond-camera");
  const voir = etat.camera.href && etat.camera.visible && MACHINES[etat.machine].camera;
  cam.setAttribute("href", voir ? etat.camera.href : "");
  cam.setAttribute("width", voir ? etat.camera.l : 0);
  cam.setAttribute("height", voir ? etat.camera.h : 0);
  cam.style.opacity = etat.camera.opacite / 100;
  $("#grille").style.display = etat.grille ? "" : "none";
  $("#outils-camera").hidden = !MACHINES[etat.machine].camera;
  $("#reglage-fond").hidden = !etat.camera.href;
  $("#bouton-fond").innerHTML = icone(etat.camera.visible ? "oeil" : "oeilBarre", 18);
  $("#coche-grille").classList.toggle("on", etat.grille);
}

function majRegles() {
  const dpr = window.devicePixelRatio || 1;
  const styles = getComputedStyle(document.documentElement);
  const coul = styles.getPropertyValue("--texte-3").trim();
  const fond = styles.getPropertyValue("--panneau").trim();
  const { zoom, px, py } = etat.vue;
  const pas = [1, 2, 5, 10, 20, 50, 100, 200, 500].find((p) => p * zoom >= 60) || 1000;
  const fin = pas / (pas % 5 === 0 && pas >= 5 ? (pas >= 50 ? 10 : 5) : 2);
  for (const [id, horizontal] of [["regle-h", true], ["regle-v", false]]) {
    const c = $("#" + id);
    const W = c.clientWidth, H = c.clientHeight;
    if (!W || !H) continue;
    c.width = W * dpr; c.height = H * dpr;
    const ctx = c.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.fillStyle = fond; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = coul; ctx.fillStyle = coul; ctx.lineWidth = 1;
    ctx.font = "10px " + styles.getPropertyValue("--police");
    const longueur = horizontal ? W : H, decal = horizontal ? px : py;
    const debut = Math.floor(-decal / zoom / fin) * fin, finMm = (longueur - decal) / zoom;
    ctx.beginPath();
    for (let mm = debut; mm <= finMm; mm += fin) {
      const pos = Math.round(decal + mm * zoom) + 0.5;
      const grand = Math.abs(mm / pas - Math.round(mm / pas)) < 1e-6;
      const t = grand ? 10 : 5;
      if (horizontal) { ctx.moveTo(pos, H); ctx.lineTo(pos, H - t); } else { ctx.moveTo(W, pos); ctx.lineTo(W - t, pos); }
      if (grand) {
        const txt = String(Math.round(mm));
        if (horizontal) ctx.fillText(txt, pos + 3, 10);
        else { ctx.save(); ctx.translate(10, pos - 3); ctx.rotate(-Math.PI / 2); ctx.fillText(txt, 0, 0); ctx.restore(); }
      }
    }
    ctx.stroke();
  }
}

function adapterVue() {
  const c = $("#canevas").getBoundingClientRect();
  const [l, h] = MACHINES[etat.machine].zone;
  const zoom = Math.min((c.width - 60) / l, (c.height - 80) / h);
  etat.vue = { zoom, px: (c.width - l * zoom) / 2, py: (c.height - h * zoom) / 2 - 10 };
  majVue();
}
function zoomer(f, cx, cy) {
  const c = $("#canevas").getBoundingClientRect();
  if (cx === undefined) { cx = c.width / 2; cy = c.height / 2; }
  const v = etat.vue;
  const z = borne(v.zoom * f, 0.15, 80);
  v.px = cx - ((cx - v.px) * z) / v.zoom;
  v.py = cy - ((cy - v.py) * z) / v.zoom;
  v.zoom = z;
  majVue();
}
function versMm(e) {
  const c = $("#canevas").getBoundingClientRect();
  return [(e.clientX - c.left - etat.vue.px) / etat.vue.zoom, (e.clientY - c.top - etat.vue.py) / etat.vue.zoom];
}

// --- Rafraîchissement général ----------------------------------------------------

function rafraichir() {
  majScene();
  majSurcouche();
  majBarreProps();
  majParams();
  majListe();
  $$('[data-action="annuler"]').forEach((b) => (b.disabled = !histo.passe.length));
  $$('[data-action="retablir"]').forEach((b) => (b.disabled = !histo.futur.length));
}
function rafraichirLeger() {
  majScene();
  majSurcouche();
  majValeursProps();
}

// --- Barre des propriétés ---------------------------------------------------------

let clePropsCourante = "";

function champMini(id, lettre, titre, large = false) {
  return `<label class="champ-mini" title="${titre}"><b>${lettre}</b><input id="${id}" type="text" inputmode="decimal"${large ? ' class="large"' : ""}></label>`;
}
function boutonIco(action, ic, titre, extra = "") {
  return `<button class="bascule" data-action="${action}" title="${titre}" ${extra}>${icone(ic, 18)}</button>`;
}

function majBarreProps() {
  const sel = selection();
  const cle = sel.map((o) => o.id + o.genre + (o.genre === "svg" ? o.v : "")).join("|") + "/" + sel.length;
  if (cle !== clePropsCourante) {
    clePropsCourante = cle;
    const b = $("#barre-props");
    if (!sel.length) {
      const [l, h] = MACHINES[etat.machine].zone;
      b.innerHTML = `<span class="indice">${icone("info", 16)}</span><span class="indice">Zone de travail ${l} × ${h} mm · origine en haut à gauche · ` +
        `molette : zoom · clic milieu ou Espace : déplacer la vue</span>`;
    } else {
      let h = `<div class="groupe">${champMini("pp-x", "X", "Position X (mm)")}${champMini("pp-y", "Y", "Position Y (mm)")}</div>` +
        `<div class="groupe">${champMini("pp-w", "L", "Largeur (mm)")}${boutonIco("ratio", etat.ratio !== false ? "cadenas" : "cadenasOuvert", "Garder les proportions", `id="pp-ratio" class="bascule ${etat.ratio !== false ? "on" : ""}"`)}${champMini("pp-h", "H", "Hauteur (mm)")}</div>`;
      if (sel.length === 1) {
        const o = sel[0];
        h += `<div class="groupe">${champMini("pp-rot", "↻", "Rotation (degrés)")}${boutonIco("miroir-h", "miroirH", "Miroir horizontal")}${boutonIco("miroir-v", "miroirV", "Miroir vertical")}</div>`;
        if (o.genre === "texte") {
          h += `<div class="groupe"><label class="champ-mini" title="Texte (Maj+Entrée : nouvelle ligne)"><b>${icone("texte", 14)}</b><input id="pp-texte" type="text" class="large"></label>` +
            `<label class="champ-mini" title="Police"><select id="pp-police">${etat.polices.map((p) => `<option>${esc(p)}</option>`).join("")}</select></label>` +
            `${champMini("pp-taille", "Taille", "Taille du texte (mm)")}` +
            `<button class="bascule" data-action="gras" id="pp-gras" title="Gras"><b>G</b></button><button class="bascule" data-action="italique" id="pp-italique" title="Italique"><i>I</i></button>` +
            `<button class="btn petit secondaire" data-action="en-chemin" title="Transformer le texte en tracés (nécessite Inkscape)">${icone("chemin", 16)}Convertir en chemin</button></div>`;
        }
        if (o.genre === "svg" && contientTexte(o)) {
          h += `<div class="groupe"><button class="btn petit secondaire" data-action="en-chemin" title="Transformer les textes en tracés (nécessite Inkscape)">${icone("chemin", 16)}Convertir les textes en chemins</button></div>`;
        }
        if (o.genre === "polygone") {
          h += `<div class="groupe">${champMini("pp-cotes", "Côtés", "Nombre de côtés")}<button class="bascule" data-action="etoile" id="pp-etoile" title="Étoile">${icone("etoile", 18)}</button></div>`;
        }
      }
      h += `<div class="groupe"><div class="menu-pop" id="pop-aligner"><button class="bascule" data-action="pop-aligner" title="${sel.length === 1 ? "Aligner sur le plateau" : "Aligner la sélection"}">${icone("aligner", 18)}</button>` +
        `<div class="menu-liste">${boutonIco("al-gauche", "alGauche", "Aligner à gauche")}${boutonIco("al-centre-h", "alCentreH", "Centrer horizontalement")}${boutonIco("al-droite", "alDroite", "Aligner à droite")}` +
        `${boutonIco("al-haut", "alHaut", "Aligner en haut")}${boutonIco("al-centre-v", "alCentreV", "Centrer verticalement")}${boutonIco("al-bas", "alBas", "Aligner en bas")}</div></div></div>` +
        `<div class="groupe">${boutonIco("avant", "avant", "Premier plan")}${boutonIco("arriere", "arriere", "Arrière-plan")}${boutonIco("dupliquer", "dupliquer", "Dupliquer (Ctrl D)")}${boutonIco("supprimer", "poubelle", "Supprimer (Suppr)")}</div>`;
      b.innerHTML = h;
      brancherProps();
    }
  }
  majValeursProps();
}

function valeur(id, v) {
  const e = $("#" + id);
  if (e && document.activeElement !== e) e.value = v;
}

function majValeursProps() {
  const sel = selection();
  if (!sel.length) return;
  const [x0, y0, x1, y1] = sel.length === 1 && !sel[0].rot ? [sel[0].x, sel[0].y, sel[0].x + sel[0].w, sel[0].y + sel[0].h] : boiteObjets(sel);
  if (sel.length === 1) {
    const o = sel[0];
    valeur("pp-x", fmt(o.x, 2)); valeur("pp-y", fmt(o.y, 2)); valeur("pp-w", fmt(o.w, 2)); valeur("pp-h", fmt(o.h, 2));
    valeur("pp-rot", fmt(o.rot || 0, 1));
    if (o.genre === "texte") {
      valeur("pp-texte", o.texte.chaine.replace(/\n/g, "⏎"));
      valeur("pp-police", o.texte.police);
      valeur("pp-taille", fmt(o.texte.taille, 2));
      $("#pp-gras")?.classList.toggle("on", !!o.texte.gras);
      $("#pp-italique")?.classList.toggle("on", !!o.texte.italique);
    }
    if (o.genre === "polygone") { valeur("pp-cotes", o.cotes); $("#pp-etoile")?.classList.toggle("on", !!o.etoile); }
  } else {
    valeur("pp-x", fmt(x0, 2)); valeur("pp-y", fmt(y0, 2)); valeur("pp-w", fmt(x1 - x0, 2)); valeur("pp-h", fmt(y1 - y0, 2));
  }
}

function brancherProps() {
  const surValider = (id, fn) => {
    const e = $("#" + id);
    if (!e) return;
    e.addEventListener("change", () => { fn(e.value); });
    e.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { e.blur(); } if (ev.key === "Escape") { e.blur(); majValeursProps(); } });
  };
  const num = (fn) => (v) => { const n = lireNombre(v); if (Number.isFinite(n)) { memoriser(); fn(n); rafraichir(); } else majValeursProps(); };
  const sel = () => selection();
  const deplacerVers = (axe, n) => {
    const s = sel();
    if (s.length === 1 && !s[0].rot) { s[0][axe] = n; return; }
    const bb = boiteObjets(s);
    const d = n - (axe === "x" ? bb[0] : bb[1]);
    for (const o of s) o[axe] += d;
  };
  surValider("pp-x", num((n) => deplacerVers("x", n)));
  surValider("pp-y", num((n) => deplacerVers("y", n)));
  const redim = (dim) => num((n) => {
    if (n <= 0) return;
    const s = sel();
    const bb = boiteObjets(s);
    const actuel = dim === "w" ? bb[2] - bb[0] : bb[3] - bb[1];
    const one = s.length === 1 ? s[0] : null;
    const base = one ? (dim === "w" ? one.w : one.h) : actuel;
    if (base <= 1e-9) return;
    const f = n / base;
    const garder = etat.ratio !== false;
    for (const o of s) {
      const cx = one ? o.x : bb[0] + (o.x - bb[0]) * (dim === "w" || garder ? f : 1);
      const cy = one ? o.y : bb[1] + (o.y - bb[1]) * (dim === "h" || garder ? f : 1);
      if (dim === "w" || garder) o.w *= f;
      if (dim === "h" || garder) o.h *= f;
      if (o.genre === "ligne" && o.b[3] < 1e-9) o.h = 0;
      if (o.genre === "ligne" && o.b[2] < 1e-9) o.w = 0;
      o.x = cx; o.y = cy;
    }
  });
  surValider("pp-w", redim("w"));
  surValider("pp-h", redim("h"));
  surValider("pp-rot", num((n) => { const o = sel()[0]; o.rot = ((n % 360) + 360) % 360; }));
  surValider("pp-taille", num((n) => { if (n > 0) modifierTexte({ taille: n }); }));
  surValider("pp-cotes", num((n) => { const o = sel()[0]; o.cotes = borne(Math.round(n), 3, 40); const c = contenuPolygone(o.cotes, o.etoile); remplacerContenu(o, c, mesurer(c)); }));
  const texte = $("#pp-texte");
  if (texte) {
    texte.addEventListener("input", () => { modifierTexte({ chaine: texte.value.replace(/⏎/g, "\n") }, true); });
    texte.addEventListener("focus", () => memoriser());
    texte.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && ev.shiftKey) {
        ev.preventDefault();
        const p = texte.selectionStart;
        texte.value = texte.value.slice(0, p) + "⏎" + texte.value.slice(texte.selectionEnd);
        texte.setSelectionRange(p + 1, p + 1);
        modifierTexte({ chaine: texte.value.replace(/⏎/g, "\n") }, true);
      } else if (ev.key === "Enter" || ev.key === "Escape") texte.blur();
    });
  }
  const police = $("#pp-police");
  if (police) police.addEventListener("change", () => { memoriser(); modifierTexte({ police: police.value }); rafraichir(); });
}

function modifierTexte(changes, leger = false) {
  const o = selection()[0];
  if (!o || o.genre !== "texte") return;
  Object.assign(o.texte, changes);
  const c = contenuTexte(o.texte);
  const ancienne = o.texte.taille;
  // garder l'échelle courante : la taille saisie est la taille réelle
  remplacerContenu(o, c, mesurer(c));
  void ancienne;
  if (leger) { rafraichirLeger(); majListe(); } else rafraichir();
}

// --- Panneau des paramètres ------------------------------------------------------

function majParams() {
  const sel = selection();
  const m = MACHINES[etat.machine];
  $("#params-vide").hidden = !!sel.length;
  $("#params").hidden = !sel.length;
  $("#params-cible").textContent = sel.length === 1 ? sel[0].nom : sel.length > 1 ? `${sel.length} objets` : "";
  if (!sel.length) return;
  const o = sel[0];
  const p = o.proc;
  const memeType = sel.every((q) => q.proc.type === p.type);
  for (const b of $$("#seg-type button")) {
    b.classList.toggle("actif", memeType && b.dataset.val === p.type);
    b.disabled = b.dataset.val === "graver" && !m.gravure;
  }
  const graver = p.type === "graver";
  const vmax = graver ? m.vmaxGraver : m.vmax;
  $("#p-vitesse").max = vmax;
  $("#n-vitesse").max = vmax;
  valeur("p-puissance", p.puissance); valeur("n-puissance", fmt(p.puissance, 1));
  valeur("p-vitesse", p.vitesse); valeur("n-vitesse", fmt(p.vitesse, 1));
  valeur("n-passes", p.passes);
  valeur("p-air", p.air); valeur("n-air", p.air);
  $("#champ-air").hidden = etat.machine !== "P2";
  $("#params-graver").hidden = !graver;
  const images = sel.some((q) => q.genre === "image");
  $("#champ-bitmap").hidden = !images;
  $("#champ-pmin").hidden = !(images && p.mode === "gris");
  valeur("p-mode", p.mode || "tramage");
  valeur("n-lpcm", p.lpcm);
  valeur("n-pmin", p.puissance_min || 0);
  $("#p-ignorer").checked = sel.every((q) => q.proc.ignorer);
}

let memoParams = false;
function modifierParams(changes, final = true) {
  if (!memoParams) { memoriser(); memoParams = true; }
  for (const o of selection()) Object.assign(o.proc, changes);
  if (final) memoParams = false;
  majScene();
  majParams();
  majListe();
}

function brancherParams() {
  for (const b of $$("#seg-type button")) {
    b.onclick = () => {
      memoriser();
      for (const o of selection()) {
        if (o.proc.type === b.dataset.val && !o.proc.ignorer) continue;
        o.proc = paramsPour(b.dataset.val, o.genre === "image");
      }
      if (b.dataset.val !== "graver" && selection().some((o) => o.genre === "image")) {
        toast("Une image ne peut être que gravée : choisissez « Graver » pour les images.", "erreur");
        for (const o of selection()) if (o.genre === "image") o.proc = paramsPour("graver", true);
      }
      rafraichir();
    };
  }
  const paire = (curseur, nombre, cle, entier = false) => {
    const c = $("#" + curseur), n = $("#" + nombre);
    c.addEventListener("input", () => { n.value = c.value; modifierParams({ [cle]: +c.value }, false); });
    c.addEventListener("change", () => { memoParams = false; });
    n.addEventListener("change", () => {
      let v = lireNombre(n.value);
      if (!Number.isFinite(v)) return majParams();
      v = borne(entier ? Math.round(v) : v, +n.min, +n.max);
      modifierParams({ [cle]: v });
    });
  };
  paire("p-puissance", "n-puissance", "puissance");
  paire("p-vitesse", "n-vitesse", "vitesse");
  paire("p-air", "n-air", "air", true);
  const passes = $("#n-passes");
  passes.addEventListener("change", () => modifierParams({ passes: borne(Math.round(lireNombre(passes.value)) || 1, 1, 50) }));
  for (const b of $$(".compteur button")) b.onclick = () => modifierParams({ passes: borne((selection()[0]?.proc.passes || 1) + +b.dataset.pas, 1, 50) });
  $("#p-mode").addEventListener("change", (e) => modifierParams({ mode: e.target.value }));
  $("#n-lpcm").addEventListener("change", (e) => modifierParams({ lpcm: borne(Math.round(lireNombre(e.target.value)) || 100, 20, 250) }));
  $("#n-pmin").addEventListener("change", (e) => modifierParams({ puissance_min: borne(lireNombre(e.target.value) || 0, 0, 100) }));
  $("#p-ignorer").addEventListener("change", (e) => { modifierParams({ ignorer: e.target.checked }); majSurcouche(); });
}

// --- Liste d'objets ----------------------------------------------------------------

const ICONE_GENRE = { rect: "rect", ellipse: "ellipse", polygone: "polygone", ligne: "ligne", texte: "texte", image: "image", svg: "chemin", chemin: "chemin" };

function majListe() {
  const ul = $("#liste-objets");
  $("#nb-objets").textContent = etat.objets.length;
  $("#liste-vide").hidden = etat.objets.length > 0;
  ul.innerHTML = etat.objets.slice().reverse().map((o) => {
    const t = typeAffiche(o);
    return `<li data-id="${o.id}" class="${etat.sel.has(o.id) ? "sel" : ""} ${o.visible === false ? "cache" : ""}">` +
      `<span class="miniature">${icone(ICONE_GENRE[o.genre] || "chemin", 16)}</span>` +
      `<span class="nom">${esc(o.nom)}</span><span class="type"><i class="pastille ${t}"></i> ${NOMS_TYPES[t]}</span>` +
      `<button class="ico" data-oeil title="Afficher ou masquer">${icone(o.visible === false ? "oeilBarre" : "oeil", 16)}</button></li>`;
  }).join("");
}

function brancherListe() {
  const ul = $("#liste-objets");
  ul.addEventListener("click", (e) => {
    const li = e.target.closest("li");
    if (!li) return;
    const o = objet(li.dataset.id);
    if (e.target.closest("[data-oeil]")) {
      memoriser();
      o.visible = o.visible === false;
      rafraichir();
      return;
    }
    if (e.shiftKey || e.ctrlKey) { etat.sel.has(o.id) ? etat.sel.delete(o.id) : etat.sel.add(o.id); }
    else etat.sel = new Set([o.id]);
    rafraichir();
  });
  ul.addEventListener("dblclick", (e) => {
    const li = e.target.closest("li");
    if (!li || e.target.closest("[data-oeil]")) return;
    const o = objet(li.dataset.id);
    const nom = $(".nom", li);
    const champ = document.createElement("input");
    champ.type = "text"; champ.value = o.nom; champ.style.height = "26px";
    nom.replaceWith(champ);
    champ.focus(); champ.select();
    const fin = (ok) => { if (ok && champ.value.trim()) { memoriser(); o.nom = champ.value.trim(); } majListe(); majParams(); };
    champ.onkeydown = (ev) => { if (ev.key === "Enter") fin(true); if (ev.key === "Escape") fin(false); };
    champ.onblur = () => fin(true);
  });
}

// --- Interactions avec le canevas ---------------------------------------------------

function choisirOutil(outil) {
  etat.outil = outil;
  for (const b of $$(".outil[data-outil]")) b.classList.toggle("actif", b.dataset.outil === outil);
  const z = $("#zone");
  z.classList.toggle("outil-main", outil === "main");
  z.classList.toggle("outil-dessin", ["rect", "ellipse", "polygone", "ligne"].includes(outil));
  z.classList.toggle("outil-texte", outil === "texte");
  majSurcouche();
}

function brancherCanevas() {
  const c = $("#canevas");
  c.addEventListener("pointerdown", (e) => {
    fermerMenus();
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    const p = versMm(e);
    if (e.button === 1 || (e.button === 0 && (etat.outil === "main" || espace))) {
      e.preventDefault();
      glisse = { type: "pan", x: e.clientX, y: e.clientY, px: etat.vue.px, py: etat.vue.py };
      $("#zone").classList.add("glisse");
      c.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    if (["rect", "ellipse", "polygone", "ligne"].includes(etat.outil)) {
      glisse = { type: "creer", genre: etat.outil, debut: p, fin: p };
      c.setPointerCapture(e.pointerId);
      return;
    }
    if (etat.outil === "texte") { creerTexte(p); return; }
    const poignee = e.target.closest("[data-poignee]");
    const o = selection()[0];
    if (poignee && o) {
      const d = poignee.dataset.poignee;
      if (d === "rot") {
        const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
        glisse = { type: "rot", o, cx, cy, a0: Math.atan2(p[1] - cy, p[0] - cx), rot0: o.rot || 0, memo: false };
      } else {
        const [hx, hy] = d.split(",").map(Number);
        glisse = { type: "redim", o, hx, hy, depart: { x: o.x, y: o.y, w: o.w, h: o.h }, memo: false };
      }
      c.setPointerCapture(e.pointerId);
      return;
    }
    const g = e.target.closest(".obj");
    if (g) {
      const id = g.dataset.id;
      if (e.shiftKey) {
        if (etat.sel.has(id)) etat.sel.delete(id); else etat.sel.add(id);
      } else if (!etat.sel.has(id)) etat.sel = new Set([id]);
      rafraichir();
      glisse = { type: "deplacer", debut: p, origines: selection().map((q) => [q, q.x, q.y]), memo: false, bouge: false };
    } else {
      if (!e.shiftKey) etat.sel.clear();
      rafraichir();
      glisse = { type: "lasso", debut: p, fin: p, ajout: e.shiftKey, avant: new Set(etat.sel) };
    }
    c.setPointerCapture(e.pointerId);
  });

  c.addEventListener("pointermove", (e) => {
    const p = versMm(e);
    $("#coords").textContent = `X ${fmt(p[0], 1)}  Y ${fmt(p[1], 1)} mm`;
    for (const g of $$(".obj.survol")) g.classList.remove("survol");
    if (!glisse) {
      const g = e.target.closest?.(".obj");
      if (g && etat.outil === "selection" && !etat.sel.has(g.dataset.id)) g.classList.add("survol");
      return;
    }
    if (glisse.type === "pan") {
      etat.vue.px = glisse.px + e.clientX - glisse.x;
      etat.vue.py = glisse.py + e.clientY - glisse.y;
      majVue();
    } else if (glisse.type === "creer") {
      let f = p;
      if (e.shiftKey) {
        const dx = p[0] - glisse.debut[0], dy = p[1] - glisse.debut[1];
        if (glisse.genre === "ligne") {
          const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4), l = Math.hypot(dx, dy);
          f = [glisse.debut[0] + l * Math.cos(a), glisse.debut[1] + l * Math.sin(a)];
        } else {
          const t = Math.max(Math.abs(dx), Math.abs(dy));
          f = [glisse.debut[0] + Math.sign(dx || 1) * t, glisse.debut[1] + Math.sign(dy || 1) * t];
        }
      }
      glisse.fin = f;
      majSurcouche();
    } else if (glisse.type === "deplacer") {
      let dx = p[0] - glisse.debut[0], dy = p[1] - glisse.debut[1];
      if (!glisse.bouge && Math.hypot(dx, dy) * etat.vue.zoom < 3) return;
      if (!glisse.memo) { memoriser(); glisse.memo = true; }
      glisse.bouge = true;
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      for (const [o, x, y] of glisse.origines) { o.x = x + dx; o.y = y + dy; }
      rafraichirLeger();
    } else if (glisse.type === "redim") {
      if (!glisse.memo) { memoriser(); glisse.memo = true; }
      redimensionner(glisse, p, e.shiftKey);
      rafraichirLeger();
    } else if (glisse.type === "rot") {
      if (!glisse.memo) { memoriser(); glisse.memo = true; }
      let a = glisse.rot0 + ((Math.atan2(p[1] - glisse.cy, p[0] - glisse.cx) - glisse.a0) * 180) / Math.PI;
      if (e.shiftKey) a = Math.round(a / 15) * 15;
      glisse.o.rot = ((a % 360) + 360) % 360;
      rafraichirLeger();
    } else if (glisse.type === "lasso") {
      glisse.fin = p;
      const x0 = Math.min(glisse.debut[0], p[0]), x1 = Math.max(glisse.debut[0], p[0]);
      const y0 = Math.min(glisse.debut[1], p[1]), y1 = Math.max(glisse.debut[1], p[1]);
      const sel = new Set(glisse.ajout ? glisse.avant : []);
      for (const o of etat.objets) {
        if (o.visible === false) continue;
        const [a, b, cc, d] = boiteObjets([o]);
        if (a < x1 && cc > x0 && b < y1 && d > y0) sel.add(o.id);
      }
      etat.sel = sel;
      majScene(); majSurcouche();
    }
  });

  const fin = (e) => {
    if (!glisse) return;
    const g = glisse;
    glisse = null;
    $("#zone").classList.remove("glisse");
    try { c.releasePointerCapture(e.pointerId); } catch (_) { /* déjà relâché */ }
    if (g.type === "creer") {
      const o = creerForme(g.genre, g.debut[0], g.debut[1], g.fin[0], g.fin[1]);
      if (o) ajouter([o]);
      choisirOutil("selection");
    }
    rafraichir();
  };
  c.addEventListener("pointerup", fin);
  c.addEventListener("pointercancel", fin);
  c.addEventListener("dblclick", (e) => {
    const g = e.target.closest(".obj");
    if (g && objet(g.dataset.id)?.genre === "texte") { const ch = $("#pp-texte"); if (ch) { ch.focus(); ch.select(); } }
  });
  c.addEventListener("wheel", (e) => {
    e.preventDefault();
    const r = c.getBoundingClientRect();
    if (e.shiftKey && !e.ctrlKey) { etat.vue.px -= e.deltaY; majVue(); return; }
    const f = Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0018));
    zoomer(f, e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  c.addEventListener("contextmenu", (e) => e.preventDefault());
}

function redimensionner(g, p, libre) {
  const o = g.o, d = g.depart;
  const a = ((o.rot || 0) * Math.PI) / 180, cs = Math.cos(a), sn = Math.sin(a);
  const cx = d.x + d.w / 2, cy = d.y + d.h / 2;
  // pointeur dans le repère non tourné de l'objet
  const qx = cs * (p[0] - cx) + sn * (p[1] - cy), qy = -sn * (p[0] - cx) + cs * (p[1] - cy);
  const ax = (-g.hx * d.w) / 2, ay = (-g.hy * d.h) / 2;
  let w = g.hx ? Math.max(0.5, (qx - ax) * g.hx) : d.w;
  let h = g.hy ? Math.max(0.5, (qy - ay) * g.hy) : d.h;
  const garder = (etat.ratio !== false) !== libre;
  if (garder && g.hx && g.hy && d.w > 0 && d.h > 0) {
    const f = Math.max(w / d.w, h / d.h);
    w = d.w * f; h = d.h * f;
  }
  if (o.genre === "ligne") { if (o.b[2] < 1e-9) w = 0; if (o.b[3] < 1e-9) h = 0; }
  const ncx = ax + (g.hx * w) / 2 + (g.hx ? 0 : 0), ncy = ay + (g.hy * h) / 2;
  const lx = g.hx ? ncx : 0, ly = g.hy ? ncy : 0;
  const wx = cx + cs * lx - sn * ly, wy = cy + sn * lx + cs * ly;
  o.w = w; o.h = h; o.x = wx - w / 2; o.y = wy - h / 2;
}

// --- Actions d'édition ---------------------------------------------------------------

function supprimer() {
  if (!etat.sel.size) return;
  memoriser();
  etat.objets = etat.objets.filter((o) => !etat.sel.has(o.id));
  etat.sel.clear();
  rafraichir();
}
function copieObjet(o, d = 5) {
  return { ...o, id: "o" + compteur++, b: o.b.slice(), proc: { ...o.proc }, texte: o.texte && { ...o.texte }, x: o.x + d, y: o.y + d, nom: o.nom };
}
function dupliquer() {
  const s = selection();
  if (s.length) ajouter(s.map((o) => copieObjet(o)));
}
function copier() { pressePapiers = selection().map((o) => copieObjet(o, 0)); if (pressePapiers.length) toast(`${pressePapiers.length} objet(s) copié(s)`); }
function coller() { if (pressePapiers.length) { const l = pressePapiers.map((o) => copieObjet(o, 5)); pressePapiers = l.map((o) => copieObjet(o, 0)); ajouter(l); } }
function toutSelectionner() { etat.sel = new Set(etat.objets.filter((o) => o.visible !== false).map((o) => o.id)); rafraichir(); }
function deplacerSel(dx, dy) {
  if (!etat.sel.size) return;
  memoriser();
  for (const o of selection()) { o.x += dx; o.y += dy; }
  rafraichir();
}
function ordre(avant) {
  const s = selection();
  if (!s.length) return;
  memoriser();
  const autres = etat.objets.filter((o) => !etat.sel.has(o.id));
  etat.objets = avant ? [...autres, ...s] : [...s, ...autres];
  rafraichir();
}
function aligner(sens) {
  const s = selection();
  if (!s.length) return;
  memoriser();
  const [l, h] = MACHINES[etat.machine].zone;
  const ref = s.length === 1 ? [0, 0, l, h] : boiteObjets(s);
  for (const o of s) {
    const [x0, y0, x1, y1] = boiteObjets([o]);
    if (sens === "gauche") o.x += ref[0] - x0;
    if (sens === "droite") o.x += ref[2] - x1;
    if (sens === "centre-h") o.x += (ref[0] + ref[2]) / 2 - (x0 + x1) / 2;
    if (sens === "haut") o.y += ref[1] - y0;
    if (sens === "bas") o.y += ref[3] - y1;
    if (sens === "centre-v") o.y += (ref[1] + ref[3]) / 2 - (y0 + y1) / 2;
  }
  rafraichir();
}
function miroir(axe) {
  memoriser();
  for (const o of selection()) o[axe] = -(o[axe] || 1);
  rafraichir();
}

const contientTexte = (o) => o.genre === "texte" || (o.genre === "svg" && /<text[\s>]/.test(o.contenu));

async function enChemin() {
  const o = selection()[0];
  if (!o || !contientTexte(o)) return;
  const [bx, by, bw, bh] = o.b;
  const svg = `<svg xmlns="${NS}" width="${bw}mm" height="${bh}mm" viewBox="${bx} ${by} ${bw} ${bh}">${o.contenu}</svg>`;
  toast("Conversion du texte en chemin par Inkscape…", "", 2500);
  try {
    const r = await api("texte_en_chemin", { svg });
    const doc = new DOMParser().parseFromString(r.svg, "image/svg+xml");
    if (o.genre === "svg") {
      nettoyerSvg(doc);
      const ser = new XMLSerializer();
      const contenu = `<g>${Array.from(doc.documentElement.childNodes).map((n) => ser.serializeToString(n)).join("")}</g>`;
      memoriser();
      remplacerContenu(o, contenu, mesurer(contenu));
      rafraichir();
      toast("Textes convertis en chemins", "ok");
      return;
    }
    const chemins = Array.from(doc.querySelectorAll("path")).map((p) => {
      let m = new DOMMatrix();
      for (let n = p; n && n.nodeType === 1 && n.localName !== "svg"; n = n.parentNode) {
        const t = n.getAttribute("transform");
        if (t) m = matriceDepuisTexte(t).multiply(m);
      }
      const tr = m.isIdentity ? "" : ` transform="matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})"`;
      return `<path class="forme" d="${esc(p.getAttribute("d") || "")}"${tr}/>`;
    });
    if (!chemins.length) throw new Error("Inkscape n'a rendu aucun tracé.");
    memoriser();
    const contenu = `<g fill-rule="nonzero">${chemins.join("")}</g>`;
    o.genre = "chemin";
    delete o.texte;
    remplacerContenu(o, contenu, mesurer(contenu));
    clePropsCourante = "";
    rafraichir();
    toast("Texte converti en chemin", "ok");
  } catch (e) {
    toast(e.message, "erreur", 6000);
  }
}

function matriceDepuisTexte(t) {
  const g = document.createElementNS(NS, "g");
  g.setAttribute("transform", t);
  const m = $("#mesure-svg");
  m.append(g);
  const base = g.transform.baseVal.consolidate();
  g.remove();
  if (!base) return new DOMMatrix();
  const x = base.matrix;
  return new DOMMatrix([x.a, x.b, x.c, x.d, x.e, x.f]);
}

// --- Import de fichiers -----------------------------------------------------------------

function centreVisible() {
  const c = $("#canevas").getBoundingClientRect();
  const [l, h] = MACHINES[etat.machine].zone;
  const x = (c.width / 2 - etat.vue.px) / etat.vue.zoom, y = (c.height / 2 - etat.vue.py) / etat.vue.zoom;
  return [borne(x, 0, l), borne(y, 0, h)];
}

function versMmUnite(valeur) {
  const m = /^\s*([-\d.eE+]+)\s*(mm|cm|in|pt|pc|px|)?\s*$/.exec(valeur || "");
  if (!m) return null;
  const f = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, px: 25.4 / 96, "": 25.4 / 96 }[m[2] || ""];
  return { mm: parseFloat(m[1]) * f, unite: m[2] || "" };
}

// Retire scripts, éléments propres à Inkscape et liens externes
function nettoyerSvg(doc) {
  for (const e of Array.from(doc.querySelectorAll("script,foreignObject,metadata,title,desc"))) e.remove();
  for (const e of Array.from(doc.documentElement.getElementsByTagName("*"))) {
    if (e.namespaceURI !== NS) { e.remove(); continue; }
    for (const a of Array.from(e.attributes)) {
      if (/^on/i.test(a.name)) e.removeAttribute(a.name);
      if ((a.localName === "href") && !/^(#|data:)/.test(a.value)) e.removeAttributeNode(a);
    }
  }
}

function importerSvg(texte, nom) {
  const doc = new DOMParser().parseFromString(texte, "image/svg+xml");
  if (doc.querySelector("parsererror") || doc.documentElement.localName !== "svg") throw new Error(`${nom} : fichier SVG illisible.`);
  const svg = doc.documentElement;
  nettoyerSvg(doc);
  // <use> remplacé par une copie de l'élément visé (pour pouvoir le tracer)
  for (let tour = 0; tour < 5; tour++) {
    const uses = Array.from(svg.getElementsByTagName("use"));
    if (!uses.length) break;
    for (const u of uses) {
      const ref = (u.getAttribute("href") || u.getAttributeNS("http://www.w3.org/1999/xlink", "href") || "").slice(1);
      const cible = ref && doc.getElementById(ref);
      const g = doc.createElementNS(NS, "g");
      const t = `${u.getAttribute("transform") || ""} translate(${u.getAttribute("x") || 0} ${u.getAttribute("y") || 0})`;
      g.setAttribute("transform", t.trim());
      for (const a of ["style", "fill", "stroke", "class"]) if (u.hasAttribute(a)) g.setAttribute(a, u.getAttribute(a));
      if (cible && !cible.contains(u)) {
        const copie = cible.cloneNode(true);
        copie.removeAttribute("id");
        if (copie.localName === "symbol") { const gg = doc.createElementNS(NS, "g"); gg.append(...copie.childNodes); g.append(gg); } else g.append(copie);
      }
      u.replaceWith(g);
    }
  }
  const vbTexte = (svg.getAttribute("viewBox") || "").trim().split(/[\s,]+/).map(Number);
  const vb = vbTexte.length === 4 && vbTexte.every(Number.isFinite) ? vbTexte : null;
  const lw = versMmUnite(svg.getAttribute("width")), lh = versMmUnite(svg.getAttribute("height"));
  let kx = 25.4 / 96, ky = 25.4 / 96, ox = 0, oy = 0;
  if (vb) {
    ox = vb[0]; oy = vb[1];
    if (lw && vb[2]) kx = lw.mm / vb[2]; else if (lw === null && vb[2]) kx = 25.4 / 96;
    if (lh && vb[3]) ky = lh.mm / vb[3]; else ky = kx;
    if (!lh && lw) ky = kx;
  } else {
    if (lw && lw.unite && lw.unite !== "px") kx = ky = 1 * (lw.mm / parseFloat(svg.getAttribute("width")));
  }
  const ser = new XMLSerializer();
  const attrs = ["style", "fill", "stroke", "stroke-width", "font-family", "font-size", "color", "fill-rule"]
    .filter((a) => svg.hasAttribute(a)).map((a) => ` ${a}="${esc(svg.getAttribute(a))}"`).join("");
  const contenu = `<g${attrs}>${Array.from(svg.childNodes).map((n) => ser.serializeToString(n)).join("")}</g>`;
  const b = mesurer(contenu);
  if (!(b[2] > 0 || b[3] > 0)) throw new Error(`${nom} : aucun dessin trouvé dans le fichier.`);
  const w = b[2] * kx, h = b[3] * ky;
  const [l, hz] = MACHINES[etat.machine].zone;
  let x = (b[0] - ox) * kx, y = (b[1] - oy) * ky;
  const enMm = lw && ["mm", "cm"].includes(lw.unite);
  if (!enMm || x < 0 || y < 0 || x + w > l || y + h > hz) {
    const c = centreVisible();
    x = borne(c[0] - w / 2, 0, Math.max(0, l - w)); y = borne(c[1] - h / 2, 0, Math.max(0, hz - h));
  }
  return nouvelObjet("svg", nom.replace(/\.svg$/i, ""), contenu, b, [x, y, w, h]);
}

function lireFichier(f, comme) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(new Error(`Lecture impossible : ${f.name}`));
    if (comme === "texte") r.readAsText(f); else r.readAsDataURL(f);
  });
}
function chargerImage(src) {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error("Image illisible"));
    i.src = src;
  });
}

async function importerImage(f) {
  let url = await lireFichier(f, "url");
  let img = await chargerImage(url);
  let nw = img.naturalWidth, nh = img.naturalHeight;
  const MAX = 3000;
  if (Math.max(nw, nh) > MAX) {
    const k = MAX / Math.max(nw, nh);
    const cv = document.createElement("canvas");
    cv.width = Math.round(nw * k); cv.height = Math.round(nh * k);
    const ctx = cv.getContext("2d");
    ctx.drawImage(img, 0, 0, cv.width, cv.height);
    url = /jpe?g/i.test(f.type) ? cv.toDataURL("image/jpeg", 0.92) : cv.toDataURL("image/png");
    nw = cv.width; nh = cv.height;
  }
  let w = (nw * 25.4) / 96, h = (nh * 25.4) / 96;
  const k = Math.min(1, 120 / Math.max(w, h));
  w *= k; h *= k;
  const c = centreVisible();
  const [l, hz] = MACHINES[etat.machine].zone;
  const contenu = `<image href="${url}" x="0" y="0" width="${nw}" height="${nh}" preserveAspectRatio="none"/>`;
  return nouvelObjet("image", f.name.replace(/\.[^.]+$/, ""), contenu, [0, 0, nw, nh],
    [borne(c[0] - w / 2, 0, Math.max(0, l - w)), borne(c[1] - h / 2, 0, Math.max(0, hz - h)), w, h]);
}

async function importerFichiers(fichiers) {
  const nouveaux = [];
  for (const f of fichiers) {
    try {
      if (/\.alaser$/i.test(f.name)) { await ouvrirProjetTexte(await lireFichier(f, "texte"), f.name); return; }
      if (/\.svg$/i.test(f.name) || f.type === "image/svg+xml") nouveaux.push(importerSvg(await lireFichier(f, "texte"), f.name));
      else if (/^image\//.test(f.type) || /\.(png|jpe?g|bmp|webp|gif)$/i.test(f.name)) nouveaux.push(await importerImage(f));
      else toast(`${f.name} : format non pris en charge (SVG, PNG, JPG…)`, "erreur");
    } catch (e) { toast(e.message, "erreur", 6000); }
  }
  if (nouveaux.length) {
    ajouter(nouveaux);
    toast(`${nouveaux.length} objet(s) importé(s)`, "ok");
  }
}

// --- Projet ---------------------------------------------------------------------------

function projetJson() {
  return {
    format: "atelier-laser", version: 1, machine: etat.machine, materiau: etat.materiau, epaisseur: etat.epaisseur,
    support: etat.support, focale: etat.focale, laser: etat.laser, frequence: etat.frequence, objets: etat.objets,
  };
}

function chargerProjet(p, nom, chemin = null) {
  if (p.format !== "atelier-laser" || !Array.isArray(p.objets)) throw new Error("Ce fichier n'est pas un projet Atelier Laser.");
  etat.objets = p.objets;
  for (const o of etat.objets) { o.v = (o.v || 1) + 1000; const n = parseInt(String(o.id).slice(1), 10); if (n >= compteur) compteur = n + 1; }
  etat.sel.clear();
  histo.passe = []; histo.futur = [];
  if (p.machine && MACHINES[p.machine]) etat.machine = p.machine;
  etat.materiau = p.materiau || "";
  etat.epaisseur = p.epaisseur ?? 3;
  if (p.support) etat.support = p.support;
  if (p.focale !== undefined) etat.focale = p.focale;
  etat.laser = p.laser || "bleu";
  etat.projet = { nom: nom.replace(/\.alaser$/i, ""), chemin };
  $("#nom-projet").textContent = etat.projet.nom;
  marquerModifie(false);
  majMachine();
  majMateriaux();
  rafraichir();
  adapterVue();
}

async function ouvrirProjetTexte(texte, nom) {
  try { chargerProjet(JSON.parse(texte), nom); toast(`Projet « ${nom} » ouvert`, "ok"); } catch (e) { toast(e.message, "erreur"); }
}

async function ouvrirProjet() {
  if (etat.modifie && etat.objets.length && !(await confirmer("Ouvrir un projet", "Les modifications non enregistrées seront perdues.", "Ouvrir"))) return;
  if (etat.avecFenetre) {
    try {
      const r = await api("ouvrir_projet");
      if (r.annule) return;
      chargerProjet(r.projet, r.chemin.split("/").pop(), r.chemin);
      toast("Projet ouvert", "ok");
      return;
    } catch (e) { toast(e.message, "erreur"); return; }
  }
  $("#fichier-projet").click();
}

async function enregistrer(sous = false) {
  try {
    const r = await api("sauver_projet", { projet: projetJson(), nom: etat.projet.nom, chemin: sous ? null : etat.projet.chemin });
    if (r.annule) return;
    etat.projet.chemin = r.chemin;
    etat.projet.nom = r.chemin.split("/").pop().replace(/\.alaser$/i, "");
    $("#nom-projet").textContent = etat.projet.nom;
    marquerModifie(false);
    toast(`Enregistré : ${r.chemin}`, "ok");
  } catch (e) { toast(e.message, "erreur"); }
}

async function nouveauProjet() {
  if (etat.modifie && etat.objets.length && !(await confirmer("Nouveau projet", "Les modifications non enregistrées seront perdues.", "Nouveau projet"))) return;
  etat.objets = []; etat.sel.clear(); histo.passe = []; histo.futur = [];
  etat.projet = { nom: "Sans titre", chemin: null };
  $("#nom-projet").textContent = etat.projet.nom;
  marquerModifie(false);
  rafraichir();
}

// --- Préparation du travail -------------------------------------------------------------

const cacheImages = new Map();
function imagePour(href) {
  if (!cacheImages.has(href)) cacheImages.set(href, chargerImage(href));
  return cacheImages.get(href);
}

function caracteresTexte(t) {
  let s = "";
  const parcourir = (n) => {
    for (const c of n.childNodes) {
      if (c.nodeType === 3) s += c.data;
      else if (c.nodeType === 1 && /^(tspan|textPath|a)$/.test(c.localName)) parcourir(c);
    }
  };
  parcourir(t);
  const n = t.getNumberOfChars();
  const candidats = [s, s.replace(/[\n\r]/g, "").replace(/\t/g, " ").replace(/ +/g, " "),
    s.replace(/[\n\r]/g, "").replace(/\t/g, " ").replace(/ +/g, " ").trim(), s.replace(/\s+/g, " ").trim()];
  for (const c of candidats) if (c.length === n) return c.split("");
  return null;
}

const DESSINABLES = Geo.FORMES + ",text,image";

// Rend des objets en image (fond blanc) : renvoie {png, x0, y0, res}
async function rasteriser(objs, res) {
  const scene = $("#scene");
  let [x0, y0, x1, y1] = boiteObjets(objs);
  x0 = Math.max(0, x0 - 1); y0 = Math.max(0, y0 - 1); x1 += 1; y1 += 1;
  const W = Math.ceil((x1 - x0) * res), H = Math.ceil((y1 - y0) * res);
  if (W * H > 140e6) throw new Error(`Zone de gravure trop grande à cette résolution (${W} × ${H} px) : baissez les lignes par cm.`);
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);
  const base = new DOMMatrix([res, 0, 0, res, -x0 * res, -y0 * res]);
  for (const o of objs) {
    const g = noeuds.get(o.id);
    if (!g) continue;
    for (const e of g.querySelectorAll(DESSINABLES)) {
      if (e.closest(".hit,defs,clipPath,mask,pattern,marker,symbol")) continue;
      const sm = Geo.versScene(e, scene);
      const m = new DOMMatrix([sm.a, sm.b, sm.c, sm.d, sm.e, sm.f]);
      ctx.setTransform(base.multiply(m));
      const st = getComputedStyle(e);
      const notreForme = e.classList.contains("forme");
      const nom = e.localName;
      if (nom === "image") {
        const href = e.getAttribute("href") || e.getAttributeNS("http://www.w3.org/1999/xlink", "href");
        if (!href) continue;
        try {
          const img = await imagePour(href);
          ctx.drawImage(img, +e.getAttribute("x") || 0, +e.getAttribute("y") || 0, +e.getAttribute("width") || img.naturalWidth, +e.getAttribute("height") || img.naturalHeight);
        } catch (_) { throw new Error(`${o.nom} : image impossible à lire.`); }
      } else if (nom === "text") {
        ctx.fillStyle = notreForme ? "#000" : (st.fill && st.fill !== "none" ? st.fill : "#000");
        ctx.font = `${st.fontStyle} ${st.fontWeight} ${st.fontSize} ${st.fontFamily}`;
        ctx.textBaseline = "alphabetic";
        ctx.textAlign = "left";
        const chars = caracteresTexte(e);
        if (!chars) {
          const p0 = e.getNumberOfChars() ? e.getStartPositionOfChar(0) : { x: 0, y: 0 };
          ctx.fillText(e.textContent.replace(/\s+/g, " ").trim(), p0.x, p0.y);
          continue;
        }
        for (let i = 0; i < chars.length; i++) {
          if (!chars[i].trim()) continue;
          const pos = e.getStartPositionOfChar(i), r = e.getRotationOfChar(i);
          ctx.save();
          ctx.translate(pos.x, pos.y);
          if (r) ctx.rotate((r * Math.PI) / 180);
          ctx.fillText(chars[i], 0, 0);
          ctx.restore();
        }
      } else {
        const echelle = Geo.echelle(m);
        const tol = 0.02 / echelle;
        const chemin = new Path2D();
        for (const s of Geo.localPolylignes(e, tol)) {
          chemin.moveTo(s[0][0], s[0][1]);
          for (let i = 1; i < s.length; i++) chemin.lineTo(s[i][0], s[i][1]);
        }
        const ouvert = ["line", "polyline"].includes(nom) || e.classList.contains("ouvert");
        if (notreForme) {
          if (ouvert) { ctx.strokeStyle = "#000"; ctx.lineWidth = 0.2 / echelle; ctx.stroke(chemin); }
          else { ctx.fillStyle = "#000"; ctx.fill(chemin, "evenodd"); }
          continue;
        }
        if (st.fill && st.fill !== "none" && !ouvert) {
          ctx.fillStyle = st.fill.startsWith("url(") ? "#000" : st.fill;
          ctx.globalAlpha = parseFloat(st.fillOpacity || 1) * parseFloat(st.opacity || 1);
          ctx.fill(chemin, st.fillRule === "evenodd" ? "evenodd" : "nonzero");
          ctx.globalAlpha = 1;
        }
        if (st.stroke && st.stroke !== "none") {
          const lw = parseFloat(st.strokeWidth) || 1;
          ctx.strokeStyle = st.stroke.startsWith("url(") ? "#000" : st.stroke;
          ctx.lineWidth = Math.max(lw, 0.1 / echelle);
          ctx.lineJoin = st.strokeLinejoin || "miter";
          ctx.lineCap = st.strokeLinecap || "butt";
          ctx.stroke(chemin);
        }
      }
    }
  }
  return { png: cv.toDataURL("image/png"), x0, y0, res, l: W / res, h: H / res };
}

const ORDRE_TYPES = { graver: 0, contour: 1, couper: 2 };

async function construireTravail() {
  const m = MACHINES[etat.machine];
  const actifs = etat.objets.filter((o) => o.visible !== false && !o.proc.ignorer);
  if (!actifs.length) throw new Error("Aucun objet à traiter : ajoutez un dessin, ou réactivez les objets masqués ou ignorés.");
  const groupes = new Map();
  for (const o of actifs) {
    const p = o.proc;
    if (p.type === "graver" && !m.gravure) throw new Error(`« ${o.nom} » : la gravure n'est disponible que pour la P2 pour l'instant.`);
    const img = o.genre === "image";
    const cle = JSON.stringify([p.type, img, p.puissance, p.vitesse, p.passes, p.air,
      ...(p.type === "graver" ? [p.lpcm, img ? p.mode : "seuil", img ? p.puissance_min : 0] : [])]);
    if (!groupes.has(cle)) groupes.set(cle, { p: { ...p }, image: img, objets: [] });
    groupes.get(cle).objets.push(o);
  }
  const liste = Array.from(groupes.values()).sort((a, b) =>
    ORDRE_TYPES[a.p.type] - ORDRE_TYPES[b.p.type] || (b.image - a.image));
  const blocs = [], apercu = [], avertissements = [];
  const scene = $("#scene");
  for (const o of actifs) {
    if (o.proc.type === "graver") continue;
    const g = noeuds.get(o.id);
    if (g.querySelector("text")) avertissements.push(`« ${o.nom} » : les textes ne sont pas suivis en ${NOMS_TYPES[o.proc.type].toLowerCase()}. Choisissez « Graver », ou « Convertir en chemin » d'abord.`);
    if (g.querySelector("image")) avertissements.push(`« ${o.nom} » : les images ne peuvent être que gravées, elles sont ignorées.`);
  }
  for (const gr of liste) {
    const p = gr.p;
    const nom = `${NOMS_TYPES[p.type]} · ${gr.objets.length === 1 ? gr.objets[0].nom : gr.objets.length + " objets"}`;
    const commun = { nom, type: p.type, puissance: p.puissance, vitesse: p.vitesse, passes: p.passes, air: etat.machine === "P2" ? p.air : 0 };
    if (p.type === "graver") {
      const r = await rasteriser(gr.objets, p.lpcm / 10);
      blocs.push({ ...commun, png: r.png, x0: r.x0, y0: r.y0, res: r.res, image: gr.image, mode: gr.image ? p.mode : "seuil", puissance_min: p.puissance_min || 0 });
      apercu.push({ ...commun, raster: r, lpcm: p.lpcm, mode: gr.image ? p.mode : "seuil" });
    } else {
      let chemins = [];
      for (const o of gr.objets) chemins.push(...Geo.polylignesObjet(noeuds.get(o.id), scene, 0.02));
      chemins = Geo.ordonner(chemins).map((c) => c.map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]));
      if (!chemins.length) continue;
      blocs.push({ ...commun, chemins });
      apercu.push({ ...commun, chemins, longueur: Geo.longueur(chemins) });
    }
  }
  return {
    travail: {
      machine: etat.machine, epaisseur: etat.epaisseur, support: etat.support, focale: etat.focale,
      laser: etat.laser, frequence: etat.frequence, blocs, ip: etat.appareil.ip,
    },
    apercu,
    avertissements,
  };
}

function dureeTexte(s) {
  if (s < 60) return `${Math.max(1, Math.round(s))} s`;
  const h = Math.floor(s / 3600), mn = Math.round((s % 3600) / 60);
  return h ? `${h} h ${String(mn).padStart(2, "0")}` : `${mn} min`;
}

function svgApercu(apercu, zone) {
  const [l, h] = MACHINES[etat.machine].zone;
  const styles = getComputedStyle(document.documentElement);
  const couleurs = { contour: styles.getPropertyValue("--c-contour"), couper: styles.getPropertyValue("--c-couper") };
  let s = `<svg viewBox="-5 -5 ${l + 10} ${h + 10}" xmlns="${NS}"><rect width="${l}" height="${h}" fill="var(--plateau)" stroke="var(--bord-fort)" stroke-width="0.6"/>`;
  if (etat.camera.href && etat.camera.visible && etat.machine === "P2") s += `<image href="${etat.camera.href}" width="${etat.camera.l}" height="${etat.camera.h}" opacity=".35" preserveAspectRatio="none"/>`;
  for (const a of apercu) {
    if (a.raster) {
      const r = a.raster;
      s += `<image href="${r.png}" x="${r.x0}" y="${r.y0}" width="${r.l}" height="${r.h}" preserveAspectRatio="none" style="mix-blend-mode:multiply"/>`;
    } else {
      const d = a.chemins.map((c) => "M" + c.map((p) => p.join(",")).join("L")).join("");
      s += `<path d="${d}" fill="none" stroke="${couleurs[a.type]}" stroke-width="0.5" stroke-linejoin="round"/>`;
    }
  }
  if (zone) s += `<rect class="cadre-travail" x="${zone[0]}" y="${zone[1]}" width="${zone[2] - zone[0]}" height="${zone[3] - zone[1]}" style="fill:none;stroke:var(--attention);stroke-width:.6;stroke-dasharray:3 2"/>`;
  return s + "</svg>";
}

async function demarrer(exporterSeulement = false) {
  const btn = $("#btn-demarrer");
  btn.disabled = true;
  let prepa, resume;
  try {
    prepa = await construireTravail();
    resume = await api("apercu", prepa.travail);
  } catch (e) {
    btn.disabled = false;
    toast(e.message, "erreur", 7000);
    return;
  }
  btn.disabled = false;
  if (exporterSeulement) return exporterGcode(prepa);
  const m = MACHINES[etat.machine];
  const z = resume.zone;
  const connecte = etat.appareil.connecte;
  const blocs = prepa.apercu.map((a) => {
    const det = a.type === "graver"
      ? `${a.lpcm} l/cm · ${{ gris: "nuances de gris", tramage: "tramage", seuil: "noir et blanc" }[a.mode]}`
      : `${fmt(a.longueur / 10, 0)} cm de tracé`;
    return `<div class="bloc"><i class="pastille ${a.type}"></i><div><b>${esc(a.nom)}</b><small>${fmt(a.puissance)} % · ${fmt(a.vitesse)} mm/s · ${a.passes} passe(s)` +
      `${etat.machine === "P2" ? ` · air ${a.air} %` : ""} · ${det}</small></div></div>`;
  }).join("");
  const mat = materiauCourant();
  modale({
    titre: "Aperçu du traitement", large: true,
    corps: `<div class="apercu-grille"><div class="apercu-vue">${svgApercu(prepa.apercu, z)}</div><div class="stats">` +
      `<div class="stat"><span>Appareil</span><b>${esc(m.nom)}</b></div>` +
      `<div class="stat"><span>Durée estimée</span><b>≈ ${dureeTexte(resume.duree)}</b></div>` +
      `<div class="stat"><span>Zone</span><b>${fmt(z[2] - z[0])} × ${fmt(z[3] - z[1])} mm</b></div>` +
      `<div class="stat"><span>Position</span><b>X ${fmt(z[0])} · Y ${fmt(z[1])}</b></div>` +
      (etat.machine === "P2" ? (etat.support === "alveole"
        ? `<div class="stat"><span>Panneau alvéolé</span><b>distance focale ${fmt(etat.focale)} mm (Z ${fmt(resume.z)})</b></div>`
        : `<div class="stat"><span>Épaisseur</span><b>${fmt(etat.epaisseur)} mm (Z ${fmt(resume.z)})</b></div>`) : "") +
      (mat ? `<div class="stat"><span>Matériel</span><b>${esc(mat.nom)}</b></div>` : "") +
      `<div class="blocs">${blocs}</div></div></div>` +
      prepa.avertissements.map((a) => `<div class="note attention">${icone("alerte", 18)}<span>${esc(a)}</span></div>`).join("") +
      (connecte ? `<div class="note info">${icone("info", 18)}<span>Après l'envoi, la machine attend : <b>appuyez sur son bouton</b> pour lancer le traitement. Restez près de la machine.</span></div>`
        : `<div class="note attention">${icone("alerte", 18)}<span>Aucun appareil connecté : vous pouvez exporter le G-code, ou connecter l'appareil pour l'envoyer.</span></div>`),
    boutons: [
      { texte: "Annuler" },
      { texte: "Exporter le G-code", icone: "exporter", action: () => exporterGcode(prepa) },
      connecte ? { texte: "Envoyer à la machine", genre: "primaire", icone: "lecture", action: (b) => envoyer(prepa, b) }
        : { texte: "Connecter l'appareil", genre: "primaire", icone: "wifi", action: () => ouvrirConnexion() },
    ],
  });
}

async function envoyer(prepa, bouton) {
  bouton.disabled = true;
  bouton.innerHTML = '<span class="rond-charge"></span>Envoi du fichier…';
  try {
    await api("envoyer", { ...prepa.travail, ip: etat.appareil.ip });
    modale({
      titre: "Fichier envoyé",
      corps: `<div class="grand-etat"><div class="bouton-machine"></div><h3>Appuyez sur le bouton de la machine</h3>` +
        `<p>Le travail est prêt sur la ${esc(MACHINES[etat.machine].nom)}. Il démarre quand vous appuyez sur le bouton de la machine.<br>Ne laissez jamais le laser travailler sans surveillance.</p></div>`,
      boutons: [{ texte: "Compris", genre: "primaire" }],
    });
    sonderEtat();
  } catch (e) {
    bouton.disabled = false;
    bouton.innerHTML = icone("lecture", 17) + "Envoyer à la machine";
    toast(`Envoi impossible : ${e.message}`, "erreur", 7000);
  }
}

async function exporterGcode(prepa) {
  try {
    if (!prepa) prepa = await construireTravail();
    const r = await api("exporter", { ...prepa.travail, nom: etat.projet.nom });
    if (r.annule) return;
    fermerModale();
    toast(`G-code enregistré : ${r.chemin}`, "ok", 6000);
  } catch (e) { toast(e.message, "erreur", 7000); }
}

function cadrer() {
  if (!MACHINES[etat.machine].camera) { toast("L'encadrement n'est disponible que pour la P2 pour l'instant.", "erreur"); return; }
  const actifs = etat.objets.filter((o) => o.visible !== false && !o.proc.ignorer);
  const cible = selection().length ? selection().filter((o) => o.visible !== false) : actifs;
  if (!cible.length) { toast("Rien à encadrer : le canevas est vide.", "erreur"); return; }
  const [l, h] = MACHINES[etat.machine].zone;
  let [x0, y0, x1, y1] = boiteObjets(cible);
  x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(l, x1); y1 = Math.min(h, y1);
  const reg = etat.cadrage || { vitesse: 50, tours: 2 };
  modale({
    titre: "Encadrement",
    corps: `<p>La tête va faire le tour du dessin${selection().length ? " sélectionné" : ""}, <b>laser à puissance nulle</b>, pour vérifier sa place sur le matériau.</p>` +
      `<div class="stat"><span>Zone</span><b>${fmt(x1 - x0)} × ${fmt(y1 - y0)} mm à X ${fmt(x0)} · Y ${fmt(y0)}</b></div>` +
      `<div class="ligne-champ"><label>Vitesse</label><div class="avec-unite"><input type="number" id="cad-vitesse" min="5" max="250" value="${reg.vitesse}"><span>mm/s</span></div></div>` +
      `<div class="ligne-champ"><label>Nombre de tours</label><div class="avec-unite"><input type="number" id="cad-tours" min="1" max="10" value="${reg.tours}"><span>tours</span></div></div>` +
      `<div class="note info">${icone("info", 18)}<span>Comme un travail, l'encadrement attend l'appui sur le bouton de la machine.</span></div>`,
    boutons: [
      { texte: "Annuler" },
      {
        texte: etat.appareil.connecte ? "Lancer l'encadrement" : "Connecter l'appareil", genre: "primaire", icone: "cadre",
        action: async (b) => {
          if (!etat.appareil.connecte) return ouvrirConnexion();
          etat.cadrage = { vitesse: borne(lireNombre($("#cad-vitesse").value) || 50, 5, 250), tours: borne(Math.round(lireNombre($("#cad-tours").value)) || 2, 1, 10) };
          b.disabled = true;
          try {
            await api("cadrer", { ip: etat.appareil.ip, machine: etat.machine, zone: [x0, y0, x1, y1], epaisseur: etat.epaisseur, support: etat.support, focale: etat.focale, ...etat.cadrage });
            sauverReglages();
            modale({
              titre: "Encadrement envoyé",
              corps: `<div class="grand-etat"><div class="bouton-machine"></div><h3>Appuyez sur le bouton de la machine</h3><p>La tête va faire ${etat.cadrage.tours} tour(s) de la zone, laser éteint.</p></div>`,
              boutons: [{ texte: "Compris", genre: "primaire" }],
            });
          } catch (e) { b.disabled = false; toast(e.message, "erreur", 7000); }
        },
      },
    ],
  });
}

// --- Appareil -------------------------------------------------------------------------------

function majAppareil() {
  const a = etat.appareil;
  const m = MACHINES[etat.machine];
  const voyant = $("#voyant");
  voyant.className = "voyant" + (a.connecte ? (a.mode && !MODES_LIBRES.includes(a.mode) ? " travail" : " ok") : a.ip ? " erreur" : "");
  $("#puce-nom").textContent = a.ip ? (a.nom || m.nom) : "Connecter l'appareil";
  $("#puce-etat").textContent = a.ip ? (a.connecte ? (MODES[a.mode] || a.mode || "Connecté") : "Injoignable · " + a.ip) : `${m.nom} · hors ligne`;
  $("#app-nom").textContent = a.nom || m.nom;
  $("#app-detail").textContent = a.ip ? `${a.ip} · ${a.connecte ? (MODES[a.mode] || a.mode || "connecté") : "injoignable"}` : "Non connecté : export du G-code possible";
  $("#appareil-visuel").innerHTML = visuelMachine(etat.machine, a.connecte);
  $("#btn-connecter").textContent = a.ip ? "Changer" : "Connecter";
  $("#btn-mesurer").hidden = etat.machine !== "P2";
}

function majMachine() {
  const m = MACHINES[etat.machine];
  $("#champ-laser").hidden = etat.machine !== "F1U";
  $("#champ-epaisseur").hidden = etat.machine !== "P2";
  for (const b of $$("#seg-laser button")) b.classList.toggle("actif", b.dataset.val === etat.laser);
  if (etat.machine !== "P2") etat.support = "plan";
  majMateriaux();
  $("#mode-traitement").value = etat.support;
  $("#mode-traitement").disabled = etat.machine !== "P2";
  majChampHauteur();
  if (!m.gravure) for (const o of etat.objets) if (o.proc.type === "graver" && o.genre !== "image") o.proc = paramsPour("contour", false);
  clePropsCourante = "";
  majPlateau();
  majAppareil();
  rafraichir();
}

// Champ sous « Matériel » : épaisseur sur le plateau, distance focale sur le panneau alvéolé
function majChampHauteur() {
  const alveole = etat.support === "alveole";
  $("#label-hauteur").textContent = alveole ? "Distance focale" : "Épaisseur";
  const c = $("#epaisseur");
  c.max = alveole ? 28 : 20;
  c.value = alveole ? etat.focale : etat.epaisseur;
  c.title = alveole ? "Hauteur de la tête au-dessus du panneau alvéolé (0 à 28 mm), comme dans xTool Studio" : "";
}

async function connecter(ip, machine) {
  const r = await api("connecter", { ip });
  etat.appareil = { ip: r.ip, connecte: true, mode: r.mode, nom: r.nom || "", serie: r.serie || "" };
  if (r.machine) etat.machine = r.machine;
  else if (machine) etat.machine = machine;
  sauverReglages();
  majMachine();
  toast(`Connecté à ${MACHINES[etat.machine].nom} (${r.ip})`, "ok");
}

function ouvrirConnexion() {
  let choix = etat.machine;
  const m = modale({
    titre: "Connecter l'appareil",
    corps: `<div class="choix-machine">` +
      Object.entries(MACHINES).map(([k, v]) => `<button data-machine="${k}" class="${k === choix ? "actif" : ""}"><span class="appareil-visuel">${visuelMachine(k)}</span><b>${v.nom}</b><small>${v.zone[0]} × ${v.zone[1]} mm</small></button>`).join("") +
      `</div><button class="btn secondaire" id="btn-rechercher">${icone("wifi", 17)}Rechercher sur le réseau</button>` +
      `<div id="resultats" class="liste-machines"></div>` +
      `<div class="separateur">ou saisissez l'adresse IP</div>` +
      `<div class="champ-ip"><input type="text" id="ip" placeholder="ex. 192.168.1.240" value="${esc(etat.appareil.ip || etat.derniereIp || "")}"><button class="btn" id="btn-ip">Connecter</button></div>` +
      `<p style="font-size:12px">L'adresse IP s'affiche sur l'écran de la machine ou dans votre box. L'ordinateur et la machine doivent être sur le même réseau.</p>`,
    boutons: [
      ...(etat.appareil.ip ? [{ texte: "Déconnecter", action: () => { etat.derniereIp = etat.appareil.ip; etat.appareil = { ip: "", connecte: false }; sauverReglages(); majAppareil(); fermerModale(); } }] : []),
      { texte: "Travailler sans machine", action: () => { etat.machine = choix; sauverReglages(); majMachine(); adapterVue(); fermerModale(); } },
    ],
  });
  for (const b of $$("[data-machine]", m)) b.onclick = () => { choix = b.dataset.machine; $$("[data-machine]", m).forEach((x) => x.classList.toggle("actif", x === b)); };
  const viaIp = async () => {
    const ip = $("#ip").value.trim();
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) { toast("Adresse IP invalide (ex. 192.168.1.240)", "erreur"); return; }
    const b = $("#btn-ip");
    b.disabled = true; b.innerHTML = '<span class="rond-charge"></span>';
    try { await connecter(ip, choix); fermerModale(); adapterVue(); } catch (e) { toast(e.message, "erreur", 6000); b.disabled = false; b.textContent = "Connecter"; }
  };
  $("#btn-ip").onclick = viaIp;
  $("#ip").onkeydown = (e) => { if (e.key === "Enter") viaIp(); };
  $("#btn-rechercher").onclick = async () => {
    const zone = $("#resultats");
    zone.innerHTML = '<div class="recherche"><span class="rond-charge"></span>Recherche des appareils xTool sur le réseau…</div>';
    try {
      const r = await api("rechercher");
      if (!r.machines.length) { zone.innerHTML = '<div class="note">' + icone("info", 18) + "<span>Aucun appareil trouvé. Vérifiez que la machine est allumée et sur le même réseau, ou saisissez son adresse IP.</span></div>"; return; }
      zone.innerHTML = r.machines.map((x) => `<button class="machine-trouvee" data-ip="${esc(x.ip)}" data-type="${esc(x.machine || "")}"><span class="appareil-visuel">${visuelMachine(x.machine || choix)}</span>` +
        `<div><b>${esc(x.nom || (x.machine ? MACHINES[x.machine].nom : "Appareil xTool"))}</b><small>${esc(x.ip)} · ${esc(MODES[x.mode] || x.mode)}${x.serie ? " · " + esc(x.serie) : ""}</small></div>${icone("chevron", 16)}</button>`).join("");
      for (const b of $$(".machine-trouvee", zone)) b.onclick = async () => {
        try { await connecter(b.dataset.ip, b.dataset.type || choix); fermerModale(); adapterVue(); } catch (e) { toast(e.message, "erreur"); }
      };
    } catch (e) { zone.innerHTML = ""; toast(e.message, "erreur"); }
  };
}

let sondage = null;
async function sonderEtat() {
  const a = etat.appareil;
  if (!a.ip) return;
  try {
    const r = await api("etat", { ip: a.ip });
    a.connecte = !!r.mode;
    a.mode = r.mode;
  } catch (_) { a.connecte = false; }
  majAppareil();
}

async function rafraichirCamera() {
  if (!etat.appareil.connecte) { ouvrirConnexion(); return; }
  const b = $("#bouton-camera");
  b.classList.add("charge");
  b.disabled = true;
  try {
    const r = await api("camera", { ip: etat.appareil.ip });
    etat.camera = { ...etat.camera, href: r.image, l: r.largeur, h: r.hauteur, visible: true };
    majPlateau();
    toast("Arrière-plan mis à jour", "ok");
  } catch (e) { toast(`Caméra : ${e.message}`, "erreur", 6000); }
  b.classList.remove("charge");
  b.disabled = false;
}

async function mesurerEpaisseur() {
  if (!etat.appareil.connecte) { ouvrirConnexion(); return; }
  const alveole = etat.support === "alveole";
  const s = selection();
  const [l, h] = MACHINES[etat.machine].zone;
  let x = l / 2, y = h / 2;
  if (s.length) { const bb = boiteObjets(s); x = (bb[0] + bb[2]) / 2; y = (bb[1] + bb[3]) / 2; }
  const ok = await confirmer("Mesure automatique",
    `La tête va se déplacer (laser éteint) pour mesurer ${alveole ? "la distance focale" : "l'épaisseur"} au point X ${fmt(x)} · Y ${fmt(y)} mm` +
    `${s.length ? " (centre de la sélection)" : " (centre du plateau)"}. Le matériau doit être posé sous ce point.<br><br><b>Fonction expérimentale</b> : vérifiez la valeur obtenue.`, "Mesurer");
  if (!ok) return;
  const b = $("#btn-mesurer");
  b.disabled = true;
  try {
    const r = await api("mesurer", { ip: etat.appareil.ip, x, y, support: etat.support });
    if (r.epaisseur === null || r.epaisseur === undefined) {
      const rep = document.createElement("pre");
      rep.className = "reponse-brute";
      rep.textContent = JSON.stringify(r.details, null, 2);
      modale({ titre: "Mesure impossible",
        corps: `<p>La machine n'a pas rendu de mesure valide (${alveole ? "−3" : "0"} à 25 mm). Réponse reçue, à transmettre pour la mise au point
          (elle est aussi notée dans <code>~/.config/atelier-laser/mesures.log</code>) :</p>${rep.outerHTML}`,
        boutons: [{ texte: "Fermer", genre: "primaire" }] });
      b.disabled = false;
      return;
    }
    // Comme xTool Studio : sur le panneau alvéolé, distance focale = 25 − valeur mesurée
    if (alveole) etat.focale = Math.round((25 - r.epaisseur) * 10) / 10;
    else etat.epaisseur = Math.round(r.epaisseur * 10) / 10;
    majChampHauteur();
    marquerModifie();
    toast(alveole ? `Distance focale mesurée : ${fmt(etat.focale)} mm` : `Épaisseur mesurée : ${fmt(etat.epaisseur)} mm`, "ok");
  } catch (e) { toast(`Mesure : ${e.message}`, "erreur", 7000); }
  b.disabled = false;
}

// --- Matériaux --------------------------------------------------------------------------

async function chargerMateriaux() {
  try {
    const r = await api("materiaux");
    etat.materiaux = r.materiaux || [];
  } catch (e) { toast(`Matériaux : ${e.message}`, "erreur"); }
  majMateriaux();
}

function majMateriaux() {
  const s = $("#materiau");
  const liste = materiauxMachine();
  const options = (l) => l.map((m) => `<option value="${esc(m.nom)}" title="${esc(m.source || "")}">${esc(m.nom)}</option>`).join("");
  const perso = liste.filter((m) => m.origine !== "xtool"), xtool = liste.filter((m) => m.origine === "xtool");
  s.innerHTML = `<option value="">Défini par l'utilisateur</option>` +
    (perso.length ? `<optgroup label="Mes matériaux">${options(perso)}</optgroup>` : "") +
    (xtool.length ? `<optgroup label="xTool Studio (réglages officiels)">${options(xtool)}</optgroup>` : "");
  s.value = liste.some((m) => m.nom === etat.materiau) ? etat.materiau : "";
}

function appliquerMateriau() {
  const mat = materiauCourant();
  memoriser();
  if (mat?.epaisseur !== undefined) { etat.epaisseur = +mat.epaisseur; majChampHauteur(); }
  if (mat && etat.machine === "F1U") {
    if (mat.laser) { etat.laser = mat.laser; for (const b of $$("#seg-laser button")) b.classList.toggle("actif", b.dataset.val === etat.laser); }
    const f = ["marquage", "decoupe", "gravure"].map((k) => mat[k]?.frequence).find(Boolean);
    if (f) etat.frequence = f;
  }
  let n = 0;
  if (mat) for (const o of etat.objets) {
    const cle = o.proc.type === "graver" ? (o.genre === "image" ? "image" : "gravure") : CLE_MATERIAU[o.proc.type];
    if (mat[cle]) { o.proc = { ...paramsPour(o.proc.type, o.genre === "image"), ignorer: o.proc.ignorer }; n++; }
  }
  rafraichir();
  if (mat) {
    const types = ["marquage", "decoupe", "gravure", "image"].filter((k) => mat[k]).map((k) => ({ marquage: "graver contour", decoupe: "couper", gravure: "graver", image: "graver (images)" }[k]));
    toast(`${mat.nom} : réglages ${types.join(", ")}${n ? ` appliqués à ${n} objet(s)` : ""}`, "ok", 5000);
  }
}

function sauverMateriau() {
  const sel = selection();
  if (!sel.length) return;
  const mat = materiauCourant();
  const types = [];
  for (const o of sel) {
    const cle = o.proc.type === "graver" ? (o.genre === "image" ? "image" : "gravure") : CLE_MATERIAU[o.proc.type];
    if (!types.some((t) => t.cle === cle)) types.push({ cle, p: o.proc });
  }
  const noms = { marquage: "Graver contour", decoupe: "Couper", gravure: "Graver", image: "Graver (images)" };
  const aujourdhui = new Date().toLocaleDateString("fr-FR");
  modale({
    titre: "Enregistrer comme matériau",
    corps: `<p>Les réglages de la sélection seront ajoutés à la liste des matériaux (fichier materiaux.json, partagé avec l'extension Inkscape).</p>` +
      `<div class="ligne-champ"><label>Nom</label><input type="text" id="mat-nom" value="${esc(mat?.nom || "")}" placeholder="ex. Contreplaqué peuplier 3 mm"></div>` +
      (etat.machine === "P2" ? `<div class="ligne-champ"><label>Épaisseur</label><div class="avec-unite"><input type="number" id="mat-ep" step="0.1" value="${etat.epaisseur}"><span>mm</span></div></div>` : "") +
      `<div class="ligne-champ"><label>Remarque</label><input type="text" id="mat-source" value="${esc(`essai du ${aujourdhui}`)}"></div>` +
      `<div class="blocs">${types.map((t) => `<div class="bloc"><i class="pastille ${t.cle === "decoupe" ? "couper" : t.cle === "marquage" ? "contour" : "graver"}"></i><div><b>${noms[t.cle]}</b><small>${fmt(t.p.puissance)} % · ${fmt(t.p.vitesse)} mm/s · ${t.p.passes} passe(s)${etat.machine === "P2" ? ` · air ${t.p.air} %` : ""}${t.p.type === "graver" ? ` · ${t.p.lpcm} l/cm` : ""}</small></div></div>`).join("")}</div>`,
    boutons: [
      { texte: "Annuler" },
      {
        texte: "Enregistrer", genre: "primaire", icone: "disque",
        action: async () => {
          const nom = $("#mat-nom").value.trim();
          if (!nom) { toast("Donnez un nom au matériau", "erreur"); return; }
          const m = { nom, machine: etat.machine, source: $("#mat-source").value.trim() };
          if (etat.machine === "F1U") m.laser = etat.laser;
          const ep = $("#mat-ep");
          if (ep && Number.isFinite(lireNombre(ep.value))) m.epaisseur = lireNombre(ep.value);
          for (const t of types) {
            const r = { puissance: t.p.puissance, vitesse: t.p.vitesse, passes: t.p.passes, air: t.p.air };
            if (t.p.type === "graver") r.resolution = t.p.lpcm / 10;
            if (t.cle === "image") { r.mode = t.p.mode; if (t.p.mode === "gris") r.puissance_min = t.p.puissance_min || 0; }
            m[t.cle] = r;
          }
          try {
            const r = await api("materiaux", { materiau: m });
            etat.materiaux = r.materiaux;
            etat.materiau = nom;
            majMateriaux();
            fermerModale();
            toast(`Matériau « ${nom} » enregistré`, "ok");
          } catch (e) { toast(e.message, "erreur"); }
        },
      },
    ],
  });
}

// --- Réglages persistants -----------------------------------------------------------

function sauverReglages() {
  api("reglages", {
    ip: etat.appareil.ip, derniereIp: etat.derniereIp || "", machine: etat.machine, theme: etat.theme, grille: etat.grille,
    ratio: etat.ratio !== false, cadrage: etat.cadrage || null, laser: etat.laser,
    support: etat.support, focale: etat.focale,
  }).catch(() => {});
}

function appliquerTheme() {
  document.documentElement.dataset.theme = etat.theme;
  $("#coche-theme").classList.toggle("on", etat.theme === "sombre");
  majRegles();
}

// --- Menus, raccourcis, actions ---------------------------------------------------------

function fermerMenus() { $$(".menu.ouvert,.menu-pop.ouvert").forEach((m) => m.classList.remove("ouvert")); }

const ACTIONS = {
  nouveau: nouveauProjet, ouvrir: ouvrirProjet, enregistrer: () => enregistrer(false), "enregistrer-sous": () => enregistrer(true),
  importer: () => $("#fichier-import").click(), exporter: () => demarrer(true),
  annuler, retablir, copier, coller, dupliquer, supprimer, tout: toutSelectionner,
  adapter: adapterVue, "zoom-plus": () => zoomer(1.25), "zoom-moins": () => zoomer(0.8),
  grille: () => { etat.grille = !etat.grille; majPlateau(); sauverReglages(); },
  theme: () => { etat.theme = etat.theme === "sombre" ? "clair" : "sombre"; appliquerTheme(); sauverReglages(); },
  connecter: ouvrirConnexion, camera: rafraichirCamera, mesurer: mesurerEpaisseur,
  "fond-visible": () => { etat.camera.visible = !etat.camera.visible; majPlateau(); },
  demarrer: () => demarrer(false), cadrer, "sauver-materiau": sauverMateriau,
  ratio: () => { etat.ratio = etat.ratio === false; clePropsCourante = ""; majBarreProps(); sauverReglages(); },
  "miroir-h": () => miroir("fx"), "miroir-v": () => miroir("fy"),
  gras: () => { memoriser(); modifierTexte({ gras: !selection()[0].texte.gras }); },
  italique: () => { memoriser(); modifierTexte({ italique: !selection()[0].texte.italique }); },
  etoile: () => { memoriser(); const o = selection()[0]; o.etoile = !o.etoile; const c = contenuPolygone(o.cotes, o.etoile); remplacerContenu(o, c, mesurer(c)); rafraichir(); },
  "en-chemin": enChemin,
  "al-gauche": () => aligner("gauche"), "al-centre-h": () => aligner("centre-h"), "al-droite": () => aligner("droite"),
  "al-haut": () => aligner("haut"), "al-centre-v": () => aligner("centre-v"), "al-bas": () => aligner("bas"),
  avant: () => ordre(true), arriere: () => ordre(false),
  "pop-aligner": () => {
    const p = $("#pop-aligner");
    const r = p.getBoundingClientRect();
    const liste = $(".menu-liste", p);
    liste.style.left = r.left + "px";
    liste.style.top = r.bottom + 6 + "px";
    p.classList.toggle("ouvert");
  },
  raccourcis: () => modale({
    titre: "Raccourcis clavier",
    corps: `<div class="raccourcis">${[
      ["Sélection / Vue", "V / H"], ["Rectangle, Ellipse, Polygone, Ligne, Texte", "R E P L T"], ["Déplacer la vue", "Espace + glisser, clic milieu"],
      ["Zoom", "Molette, + / −"], ["Adapter à l'écran", "Maj 1"], ["Annuler / Rétablir", "Ctrl Z / Ctrl Y"],
      ["Copier / Coller / Dupliquer", "Ctrl C / Ctrl V / Ctrl D"], ["Supprimer", "Suppr"], ["Déplacer de 1 mm (10 mm)", "Flèches (+ Maj)"],
      ["Proportions libres pendant le redimensionnement", "Maj"], ["Rotation par pas de 15°", "Maj"], ["Importer", "Ctrl I"], ["Enregistrer", "Ctrl S"],
    ].map(([a, b]) => `<span>${a}</span><kbd>${b}</kbd>`).join("")}</div>`,
    boutons: [{ texte: "Fermer", genre: "primaire" }],
  }),
  apropos: () => modale({
    titre: "À propos d'Atelier Laser",
    corps: `<p><b>Atelier Laser</b> pilote les lasers xTool P2 et F1 Ultra depuis Linux, avec une interface proche de xTool Studio.</p>` +
      `<p>Projet non officiel, sans lien avec xTool, développé au fablab du centre social de Chemillé. Licence GNU GPL v3.</p>` +
      `<div class="note attention">${icone("alerte", 18)}<span>Un laser est dangereux : restez près de la machine, ne la laissez jamais travailler seule et faites vos essais à faible puissance sur du carton.</span></div>`,
    boutons: [{ texte: "Fermer", genre: "primaire" }],
  }),
};

function brancherActions() {
  document.addEventListener("click", (e) => {
    const titre = e.target.closest(".menu-titre");
    if (titre) {
      const m = titre.parentElement;
      const ouvert = m.classList.contains("ouvert");
      fermerMenus();
      if (!ouvert) m.classList.add("ouvert");
      return;
    }
    const b = e.target.closest("[data-action]");
    const garderPop = b && b.dataset.action === "pop-aligner";
    if (!e.target.closest(".menu") && !garderPop) fermerMenus();
    if (b && ACTIONS[b.dataset.action] && !b.disabled) {
      if (!garderPop) fermerMenus();
      ACTIONS[b.dataset.action]();
    }
  });
  document.addEventListener("mouseover", (e) => {
    const t = e.target.closest(".menu-titre");
    if (t && $(".menu.ouvert") && !t.parentElement.classList.contains("ouvert")) { fermerMenus(); t.parentElement.classList.add("ouvert"); }
  });
  for (const b of $$(".outil[data-outil]")) b.onclick = () => choisirOutil(b.dataset.outil);
  for (const b of $$("#seg-laser button")) b.onclick = () => { etat.laser = b.dataset.val; majMachine(); marquerModifie(); sauverReglages(); };
  $("#materiau").addEventListener("change", (e) => { etat.materiau = e.target.value; appliquerMateriau(); });
  $("#epaisseur").addEventListener("change", (e) => {
    const v = lireNombre(e.target.value);
    const alveole = etat.support === "alveole", max = alveole ? 28 : 20;
    if (!Number.isFinite(v) || v < 0 || v > max) {
      toast(`${alveole ? "Distance focale" : "Épaisseur"} entre 0 et ${max} mm`, "erreur");
      majChampHauteur();
      return;
    }
    if (alveole) etat.focale = v; else etat.epaisseur = v;
    marquerModifie();
    sauverReglages();
  });
  $("#mode-traitement").addEventListener("change", (e) => {
    etat.support = e.target.value;
    majChampHauteur();
    marquerModifie();
    sauverReglages();
    if (materiauCourant()?.modes) appliquerMateriau();
    if (etat.support === "alveole") toast("Assurez-vous que le panneau alvéolé a été placé sur les supports de lamelle.", "", 6000);
  });
  $("#opacite-fond").addEventListener("input", (e) => { etat.camera.opacite = +e.target.value; majPlateau(); });
  $("#fichier-import").addEventListener("change", (e) => { importerFichiers(Array.from(e.target.files)); e.target.value = ""; });
  $("#fichier-projet").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (f) await ouvrirProjetTexte(await lireFichier(f, "texte"), f.name);
    e.target.value = "";
  });
  const zone = $("#zone");
  let profondeur = 0;
  zone.addEventListener("dragenter", (e) => { e.preventDefault(); profondeur++; $("#depot").hidden = false; });
  zone.addEventListener("dragover", (e) => e.preventDefault());
  zone.addEventListener("dragleave", () => { if (--profondeur <= 0) { profondeur = 0; $("#depot").hidden = true; } });
  zone.addEventListener("drop", (e) => { e.preventDefault(); profondeur = 0; $("#depot").hidden = true; importerFichiers(Array.from(e.dataTransfer.files)); });
}

function brancherClavier() {
  document.addEventListener("keydown", (e) => {
    const champ = e.target.closest?.("input,textarea,select");
    if (modaleOuverte()) { if (e.key === "Escape") fermerModale(); return; }
    if (champ) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (ctrl) {
      const a = { z: e.shiftKey ? "retablir" : "annuler", y: "retablir", c: "copier", v: "coller", d: "dupliquer", a: "tout", s: e.shiftKey ? "enregistrer-sous" : "enregistrer", o: "ouvrir", n: "nouveau", i: "importer", e: "exporter" }[k];
      if (a) { e.preventDefault(); ACTIONS[a](); }
      return;
    }
    if (e.key === " ") { if (!espace) { espace = true; $("#zone").classList.add("panoramique"); } e.preventDefault(); return; }
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); supprimer(); return; }
    if (e.key === "Escape") { etat.sel.clear(); choisirOutil("selection"); rafraichir(); return; }
    const pas = e.shiftKey ? 10 : 1;
    const fleches = { ArrowLeft: [-pas, 0], ArrowRight: [pas, 0], ArrowUp: [0, -pas], ArrowDown: [0, pas] };
    if (fleches[e.key]) { e.preventDefault(); deplacerSel(...fleches[e.key]); return; }
    if (e.key === "!" || (e.shiftKey && e.code === "Digit1")) { adapterVue(); return; }
    if (e.key === "+" || e.key === "=") { zoomer(1.25); return; }
    if (e.key === "-") { zoomer(0.8); return; }
    const outils = { v: "selection", h: "main", r: "rect", e: "ellipse", p: "polygone", l: "ligne", t: "texte" };
    if (outils[k] && !e.shiftKey) choisirOutil(outils[k]);
  });
  document.addEventListener("keyup", (e) => { if (e.key === " ") { espace = false; $("#zone").classList.remove("panoramique"); } });
}

// --- Sauvegarde de secours -----------------------------------------------------------

let dernierSecours = "";
function secours() {
  if (!etat.modifie) return;
  const texte = JSON.stringify(projetJson());
  if (texte === dernierSecours) return;
  dernierSecours = texte;
  api("secours", { projet: projetJson(), nom: etat.projet.nom }).catch(() => {});
}

async function proposerSecours() {
  try {
    const r = await api("secours");
    if (!r.projet || !r.projet.objets?.length) return;
    modale({
      titre: "Reprendre le travail ?",
      corps: `<p>Un travail non enregistré a été retrouvé (« ${esc(r.nom || "Sans titre")} », ${r.projet.objets.length} objet(s)). Voulez-vous le reprendre ?</p>`,
      boutons: [
        { texte: "Non, nouveau projet", action: () => { fermerModale(); api("secours", { effacer: true }).catch(() => {}); } },
        { texte: "Reprendre", genre: "primaire", action: () => { fermerModale(); chargerProjet(r.projet, r.nom || "Sans titre"); marquerModifie(true); } },
      ],
    });
  } catch (_) { /* pas de secours */ }
}

// --- Démarrage --------------------------------------------------------------------------------

async function init() {
  poserIcones();
  brancherActions();
  brancherCanevas();
  brancherParams();
  brancherListe();
  brancherClavier();
  new ResizeObserver(() => majRegles()).observe($("#zone"));
  try {
    const r = await api("reglages");
    if (r.machine && MACHINES[r.machine]) etat.machine = r.machine;
    if (r.theme) etat.theme = r.theme;
    else etat.theme = matchMedia("(prefers-color-scheme: dark)").matches ? "sombre" : "clair";
    if (r.grille === false) etat.grille = false;
    if (r.ratio === false) etat.ratio = false;
    if (r.cadrage) etat.cadrage = r.cadrage;
    if (r.laser) etat.laser = r.laser;
    if (r.support) etat.support = r.support;
    if (Number.isFinite(r.focale)) etat.focale = r.focale;
    etat.derniereIp = r.derniereIp || "";
    etat.appareil.ip = r.ip || "";
    etat.avecFenetre = r._fenetre !== false;
  } catch (_) { /* réglages par défaut */ }
  try { const p = await api("polices"); if (p.polices?.length) etat.polices = p.polices; } catch (_) { /* polices génériques */ }
  appliquerTheme();
  await chargerMateriaux();
  majMachine();
  adapterVue();
  rafraichir();
  marquerModifie(false);
  if (etat.appareil.ip) sonderEtat();
  sondage = setInterval(sonderEtat, 4000);
  setInterval(secours, 20000);
  window.addEventListener("beforeunload", secours);
  proposerSecours();
  window.addEventListener("resize", () => majRegles());
}

init();
