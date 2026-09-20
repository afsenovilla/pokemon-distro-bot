import assert from "node:assert/strict";
import {
  normalize,
  formatDate,
  computeStatus,
  formatStatusEntry,
  formatGalleryEntry,
  searchSpeciesIn,
  searchGallery,
  shortHash,
  consoleLabel,
  groupByConsole,
  formatCompactGalleryLine,
  formatHistoryByConsole,
  formatEventEntry,
  findActiveDistributionsForDex,
  findActiveEventsForDex,
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

// --- histórico agrupado por consola ---
const historyEntries = [
  { id: "mew-gen9-sv-random", species: "Mew", generation: 9, game: "Escarlata/Púrpura", shiny: "random" },
  { id: "mew-gen4-hgss-always", species: "Mew", generation: 4, game: "Oro HeartGold/Plata SoulSilver", shiny: "always", event: "Anniversary Mew" },
  { id: "mew-gen7-switch-lgpe-never", species: "Mew", generation: 7, game: "Let's Go Pikachu/Eevee", shiny: "never", representativeFile: "Released/Gen 7/Switch/foo.wc7full" },
  { id: "mew-gen7-3ds-sm-random", species: "Mew", generation: 7, game: "Sol/Luna", shiny: "random", representativeFile: "Released/Gen 7/JPN/foo.wc7full" },
];

assert.equal(consoleLabel(historyEntries[0]), "Nintendo Switch");
assert.equal(consoleLabel(historyEntries[1]), "Nintendo DS");
assert.equal(consoleLabel(historyEntries[2]), "Nintendo Switch (Let's Go Pikachu/Eevee)");
assert.equal(consoleLabel(historyEntries[3]), "Nintendo 3DS");

const grouped = groupByConsole(historyEntries);
// Switch (gen9) debe ir antes que Switch Let's Go, que va antes que 3DS, que
// va antes que DS: de más reciente/relevante a más antiguo.
assert.deepEqual(
  grouped.map((g) => g.label),
  ["Nintendo Switch", "Nintendo Switch (Let's Go Pikachu/Eevee)", "Nintendo 3DS", "Nintendo DS"]
);

const compactLine = formatCompactGalleryLine(historyEntries[1]);
assert.ok(compactLine.includes("Anniversary Mew"));
assert.ok(compactLine.includes("/wondercard mew-gen4-hgss-always"));
assert.ok(compactLine.includes("✨"));

const historyText = formatHistoryByConsole("Mew", historyEntries);
assert.ok(historyText.includes("Mew"));
assert.ok(historyText.includes("Nintendo Switch"));
assert.ok(historyText.includes("Nintendo DS"));
assert.equal(formatHistoryByConsole("Ditto", []), "No tengo ningún registro de distribuciones de <b>Ditto</b>.");

// --- eventos in-game (data/events.json) ---
const eventEntry = {
  id: "swsh-finale",
  game: "Espada/Escudo",
  generation: 8,
  title: "Finale",
  dateStart: "2024-01-01",
  dateEnd: "2024-01-10",
  pokemonLabel: "Snorlax",
  shiny: "possible",
  sourceUrl: "https://www.serebii.net/swordshield/wildareaevents.shtml",
};
assert.equal(computeStatus(eventEntry, "2024-01-05"), "activa");
const eventText = formatEventEntry(eventEntry);
assert.ok(eventText.includes("Finale"));
assert.ok(eventText.includes("Snorlax"));
assert.ok(eventText.includes("Shiny posible"));

const distEntries = [
  { species: "Mew", dexNumber: 151, dateStart: "2024-01-01", dateEnd: "2024-01-10" },
  { species: "Pikachu", dexNumber: 25, dateStart: "2020-01-01", dateEnd: "2020-01-10" },
];
assert.equal(findActiveDistributionsForDex(distEntries, 151, "2024-01-05").length, 1);
assert.equal(findActiveDistributionsForDex(distEntries, 25, "2024-01-05").length, 0); // finalizada

const eventEntries = [
  { ...eventEntry, dexNumbers: [143] },
  { ...eventEntry, id: "old", dateStart: "2019-01-01", dateEnd: "2019-01-10", dexNumbers: [143] },
];
assert.equal(findActiveEventsForDex(eventEntries, 143, "2024-01-05").length, 1);
assert.equal(findActiveEventsForDex(eventEntries, 999, "2024-01-05").length, 0);

// --- shortHash ---
assert.equal(shortHash("mew-gen4-hgss-always").length, 8);
assert.equal(shortHash("a"), shortHash("a"));
assert.notEqual(shortHash("a"), shortHash("b"));

console.log("Todos los tests de lib.js han pasado correctamente.");
