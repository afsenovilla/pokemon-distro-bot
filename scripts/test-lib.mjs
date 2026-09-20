import assert from "node:assert/strict";
import {
  normalize,
  formatDate,
  computeStatus,
  formatStatusEntry,
  formatGalleryEntry,
  searchSpeciesIn,
  searchGallery,
} from "../src/lib.js";

assert.equal(normalize("Mewtwó"), "mewtwo");
assert.equal(formatDate("2024-04-20"), "20 abr 2024");
assert.equal(formatDate(null), null);

// --- data/distributions.json (estado activa/anunciada) ---
const statusEntries = [
  { species: "Mew", game: "Escarlata/Púrpura", dateStart: "2024-01-01", dateEnd: "2024-01-10", shiny: false },
  { species: "Mew", game: "Espada/Escudo", dateStart: "2020-01-01", dateEnd: "2020-01-10", shiny: true },
];
const today = "2024-01-05";
assert.equal(computeStatus(statusEntries[0], today), "activa");
assert.equal(computeStatus(statusEntries[1], today), "finalizada");

const exact = searchSpeciesIn(statusEntries, "mew");
assert.deepEqual(exact.matches, ["Mew"]);
assert.equal(exact.entries.length, 2);

const statusText = formatStatusEntry(statusEntries[1], { showSpecies: true });
assert.ok(statusText.includes("Mew"));
assert.ok(statusText.includes("Shiny: Sí"));

// --- data/eventsgallery.json (historial completo + shiny verificado) ---
const galleryEntries = [
  {
    id: "mew-gen4-hgss-always",
    species: "Mew",
    speciesEs: "Mew",
    dexNumber: 151,
    generation: 4,
    game: "Oro HeartGold/Plata SoulSilver",
    event: "Anniversary Mew",
    region: "ENG",
    shiny: "always",
    shinySource: "wondercard",
    variantCount: 3,
  },
  {
    id: "meltan-gen8-go-random",
    species: "Meltan",
    speciesEs: "Meltan",
    dexNumber: 808,
    generation: 8,
    game: "Pokémon GO",
    event: null,
    region: null,
    shiny: "random",
    shinySource: "nombre-de-archivo",
    variantCount: 1,
  },
];

const galleryExact = searchGallery(galleryEntries, "mew");
assert.deepEqual(galleryExact.matches, ["Mew"]);
assert.equal(galleryExact.entries.length, 1);

const galleryPartial = searchGallery(galleryEntries, "melt");
assert.deepEqual(galleryPartial.matches, ["Meltan"]);

const none = searchGallery(galleryEntries, "pikachu");
assert.equal(none.matches.length, 0);

const galleryText = formatGalleryEntry(galleryEntries[0], { showSpecies: true });
assert.ok(galleryText.includes("Mew"));
assert.ok(galleryText.includes("siempre"));
assert.ok(galleryText.includes("verificado leyendo la wondercard real"));
assert.ok(galleryText.includes("/wondercard mew-gen4-hgss-always"));
assert.ok(galleryText.includes("3 variantes"));

console.log("Todos los tests de lib.js han pasado correctamente.");
