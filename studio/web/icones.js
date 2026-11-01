// Icônes au trait (24 × 24), dessinées pour l'application, sans dépendance.
"use strict";

const ICONES = {
  selection: '<path d="M5 3l14 8-6.2 1.6L10 19z"/>',
  main: '<path d="M8 13V5.5a1.5 1.5 0 013 0V12M11 11.5V4a1.5 1.5 0 013 0v7.5M14 11.5V6a1.5 1.5 0 013 0v8a6 6 0 01-6 6h-.5a6 6 0 01-4.8-2.4L3.6 14.2a1.5 1.5 0 012.3-1.9L8 14.5"/>',
  rect: '<rect x="4" y="5" width="16" height="14" rx="1.5"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="8.5" ry="7"/>',
  ligne: '<path d="M5 19L19 5"/><circle cx="5" cy="19" r="1.6"/><circle cx="19" cy="5" r="1.6"/>',
  polygone: '<path d="M12 3.5l8 5.8-3 9.2H7l-3-9.2z"/>',
  etoile: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8 6.8 19.6l1-5.8-4.3-4.1 5.9-.8z"/>',
  texte: '<path d="M5 6V4.5h14V6M12 4.5v15M9 19.5h6"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M20.5 16l-5-5-9 8.5"/>',
  importer: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/>',
  exporter: '<path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M5 19.5h14"/>',
  annuler: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 010 11H11"/>',
  retablir: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 000 11H13"/>',
  camera: '<path d="M4 8.5A1.5 1.5 0 015.5 7h2l1.5-2h6l1.5 2h2A1.5 1.5 0 0120 8.5v9a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 17.5z"/><circle cx="12" cy="13" r="3.5"/>',
  rafraichir: '<path d="M20 12a8 8 0 11-2.3-5.6M20 4v4.5h-4.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  moins: '<path d="M5 12h14"/>',
  adapter: '<path d="M4 9V5.5A1.5 1.5 0 015.5 4H9M15 4h3.5A1.5 1.5 0 0120 5.5V9M20 15v3.5a1.5 1.5 0 01-1.5 1.5H15M9 20H5.5A1.5 1.5 0 014 18.5V15"/>',
  oeil: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  oeilBarre: '<path d="M4 4l16 16M10.6 6A9.6 9.6 0 0112 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 01-2.7 3.5M6.5 7.6C4 9.3 2.5 12 2.5 12S6 18.5 12 18.5a9 9 0 004.4-1.1"/><path d="M9.9 9.9a3 3 0 004.2 4.2"/>',
  poubelle: '<path d="M4.5 7h15M10 11v6M14 11v6M6 7l1 12a1.5 1.5 0 001.5 1.4h7A1.5 1.5 0 0017 19l1-12M9 7V4.5h6V7"/>',
  dupliquer: '<rect x="8" y="8" width="12" height="12" rx="1.5"/><path d="M16 8V5.5A1.5 1.5 0 0014.5 4h-9A1.5 1.5 0 004 5.5v9A1.5 1.5 0 005.5 16H8"/>',
  cadenas: '<rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 018 0v3"/>',
  cadenasOuvert: '<rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 017.7-1.5"/>',
  wifi: '<path d="M2.5 9a14 14 0 0119 0M5.5 12.5a9.5 9.5 0 0113 0M8.5 16a5 5 0 017 0"/><circle cx="12" cy="19.2" r="1" fill="currentColor"/>',
  machine: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18M7 6v4M17 6v4"/><circle cx="12" cy="14" r="1.4"/>',
  lecture: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none"/>',
  cadre: '<path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4"/><rect x="8" y="8" width="8" height="8" rx="1" stroke-dasharray="2 2"/>',
  mesure: '<path d="M12 3v4M12 17v4M8.5 7.5L12 4l3.5 3.5M8.5 16.5L12 20l3.5-3.5"/><path d="M4 12h16" stroke-dasharray="2 2"/>',
  dossier: '<path d="M3.5 7.5A1.5 1.5 0 015 6h4.5l2 2.5H19a1.5 1.5 0 011.5 1.5v7.5A1.5 1.5 0 0119 19H5a1.5 1.5 0 01-1.5-1.5z"/>',
  disque: '<path d="M5 4h11l3 3v12a1 1 0 01-1 1H6a1 1 0 01-1-1z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
  fichier: '<path d="M6 3.5h8l4 4V20a.5.5 0 01-.5.5h-11A.5.5 0 016 20z"/><path d="M14 3.5V8h4"/>',
  chevron: '<path d="M7 10l5 5 5-5"/>',
  coche: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  croix: '<path d="M6 6l12 12M18 6L6 18"/>',
  alerte: '<path d="M12 4l9 16H3z"/><path d="M12 10v4.5M12 17.5v.2"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.2"/>',
  lune: '<path d="M19.5 14.5A8 8 0 019.5 4.5a8 8 0 1010 10z"/>',
  soleil: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  alGauche: '<path d="M4 3.5v17"/><rect x="7" y="6" width="11" height="4" rx="1"/><rect x="7" y="14" width="7" height="4" rx="1"/>',
  alCentreH: '<path d="M12 3.5v17"/><rect x="5.5" y="6" width="13" height="4" rx="1"/><rect x="8" y="14" width="8" height="4" rx="1"/>',
  alDroite: '<path d="M20 3.5v17"/><rect x="6" y="6" width="11" height="4" rx="1"/><rect x="10" y="14" width="7" height="4" rx="1"/>',
  alHaut: '<path d="M3.5 4h17"/><rect x="6" y="7" width="4" height="11" rx="1"/><rect x="14" y="7" width="4" height="7" rx="1"/>',
  alCentreV: '<path d="M3.5 12h17"/><rect x="6" y="5.5" width="4" height="13" rx="1"/><rect x="14" y="8" width="4" height="8" rx="1"/>',
  alBas: '<path d="M3.5 20h17"/><rect x="6" y="6" width="4" height="11" rx="1"/><rect x="14" y="10" width="4" height="7" rx="1"/>',
  avant: '<rect x="9" y="9" width="11" height="11" rx="1.5" fill="currentColor" fill-opacity=".25"/><path d="M15 9V5.5A1.5 1.5 0 0013.5 4h-8A1.5 1.5 0 004 5.5v8A1.5 1.5 0 005.5 15H9"/>',
  arriere: '<rect x="4" y="4" width="11" height="11" rx="1.5" fill="currentColor" fill-opacity=".25"/><path d="M9 15v3.5a1.5 1.5 0 001.5 1.5h8a1.5 1.5 0 001.5-1.5v-8A1.5 1.5 0 0018.5 9H15"/>',
  miroirH: '<path d="M12 3v18" stroke-dasharray="2 2.5"/><path d="M9 7L3.5 17H9zM15 7l5.5 10H15z"/>',
  miroirV: '<path d="M3 12h18" stroke-dasharray="2 2.5"/><path d="M7 9L17 3.5V9zM7 15l10 5.5V15z"/>',
  aligner: '<path d="M4 4v16"/><rect x="7" y="6" width="12" height="4.5" rx="1"/><rect x="7" y="13.5" width="8" height="4.5" rx="1"/>',
  centrer: '<rect x="3.5" y="5" width="17" height="14" rx="1.5"/><path d="M12 9v6M9 12h6"/>',
  rotation: '<path d="M19.5 12A7.5 7.5 0 1112 4.5c2.4 0 4.4 1 5.8 2.7M18.5 3.5v4h-4"/>',
  chemin: '<path d="M4 18C8 18 6 6 12 6s4 12 8 12"/><rect x="2.5" y="16.5" width="3" height="3"/><rect x="18.5" y="16.5" width="3" height="3"/>',
  materiau: '<path d="M3.5 8.5L12 4l8.5 4.5L12 13z"/><path d="M3.5 12.5L12 17l8.5-4.5M3.5 16.5L12 21l8.5-4.5"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  laser: '<path d="M12 3v9"/><path d="M9 3h6v4H9z"/><path d="M12 15.5v.5M8.5 19l1-1.5M15.5 19l-1-1.5M12 21v-1.5" />',
  grille: '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M4 9.3h16M4 14.7h16M9.3 4v16M14.7 4v16"/>',
};

function icone(nom, taille = 20) {
  return `<svg class="ic" width="${taille}" height="${taille}" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
    `stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[nom] || ""}</svg>`;
}

function poserIcones(racine = document) {
  for (const el of racine.querySelectorAll("[data-ic]")) {
    if (!el.dataset.icPose) {
      el.insertAdjacentHTML("afterbegin", icone(el.dataset.ic, +(el.dataset.icTaille || 20)));
      el.dataset.icPose = "1";
    }
  }
}
