import assert from "node:assert/strict";
import { buildFaltanReport, formatFaltanReport } from "../src/poketracker.js";

const data = {
  slugByDexNumber: new Map([
    [151, "mew"],
    [385, "jirachi"],
    [807, "zeraora"],
  ]),
  progreso: {
    dexes: [
      { id: "normal", title: "Living Dex", shiny: false },
      { id: "shiny", title: "Living Dex Shiny", shiny: true },
    ],
    captures: {
      normal: {
        mew: { t: 1, c: 1 }, // ya en HOME
        jirachi: { t: 1, g: "bank" }, // pendiente en un juego de 3DS -> URGENTE
        zeraora: { t: 1, g: "sv" }, // pendiente pero en un juego directo a HOME -> no urgente
      },
      shiny: {
        mew: { t: 1, c: 1 }, // ya tiene el shiny
        // jirachi: sin entrada -> le falta
        zeraora: { t: 1, x: 1 }, // excluido a propósito -> no debe salir como "le falta"
      },
    },
  },
};

const galleryEntries = [
  { dexNumber: 385, species: "Jirachi", speciesEs: "Jirachi", shiny: "always", game: "Rubí/Zafiro/Esmeralda" },
  { dexNumber: 807, species: "Zeraora", speciesEs: "Zeraora", shiny: "always", game: "Espada/Escudo" },
  { dexNumber: 151, species: "Mew", speciesEs: "Mew", shiny: "never", game: "Diamante/Perla" },
];

const report = buildFaltanReport(data, galleryEntries);

assert.equal(report.pendientesBank.length, 1);
assert.equal(report.pendientesBank[0].slug, "jirachi");

assert.equal(report.shinyFaltantes.length, 1);
assert.equal(report.shinyFaltantes[0].slug, "jirachi"); // zeraora está excluido a propósito, no debe salir

const text = formatFaltanReport(report);
assert.ok(text.includes("Jirachi"));
assert.ok(!text.includes("Zeraora")); // ni pendiente (va a HOME directo) ni shiny-faltante (excluido)

// Caso sin nada pendiente
const emptyReport = buildFaltanReport(
  {
    slugByDexNumber: new Map([[151, "mew"]]),
    progreso: {
      dexes: [{ id: "normal", title: "Living Dex", shiny: false }],
      captures: { normal: { mew: { t: 1, c: 1 } } },
    },
  },
  [{ dexNumber: 151, species: "Mew", speciesEs: "Mew", shiny: "never" }]
);
assert.ok(formatFaltanReport(emptyReport).includes("No hay nada pendiente"));

console.log("Todos los tests de poketracker.js han pasado correctamente.");
