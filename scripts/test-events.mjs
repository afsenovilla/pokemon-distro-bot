import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseEventsFromHtml } from "./fetch-events.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const speciesNames = JSON.parse(
  await readFile(path.join(__dirname, "resources", "species-names.json"), "utf8")
);

// HTML de muestra que imita la estructura descrita de las páginas de
// eventos de Serebii (título en negrita + "Global: <fechas>. <descripción>").
const SAMPLE_HTML = `
<table>
<tr><td>
  <b>Finale</b><br>
  Global: November 1st 2022 - End of Service. The final event and the now
  standard Wild Area News had the majority of the Gigantamax Pokémon as
  opponents to face, including Shiny Snorlax.
</td></tr>
<tr><td>
  <b>Challenge Glastrier &amp; Spectrier Event</b><br>
  Global: October 21st - October 23rd 2022. The October special Max Raid
  Battle event celebrated the second anniversary of The Crown Tundra and
  featured uncatchable battles against Glastrier and Spectrier.
</td></tr>
</table>
`;

const events = parseEventsFromHtml(SAMPLE_HTML, {
  game: "Espada/Escudo",
  generation: 8,
  sourceUrl: "https://www.serebii.net/swordshield/wildareaevents.shtml",
  speciesNames,
});

assert.equal(events.length, 2);

const finale = events.find((e) => e.title === "Finale");
assert.ok(finale, "debería encontrar el evento 'Finale'");
assert.equal(finale.dateStart, "2022-11-01");
assert.equal(finale.dateEnd, null); // "End of Service" -> sigue abierto
assert.ok(finale.dexNumbers.includes(143)); // Snorlax
assert.equal(finale.shiny, "possible");
assert.equal(finale.generation, 8);
assert.equal(finale.game, "Espada/Escudo");

const glastrier = events.find((e) => e.title.includes("Glastrier"));
assert.ok(glastrier, "debería encontrar el evento de Glastrier/Spectrier");
assert.equal(glastrier.dateStart, "2022-10-21");
assert.equal(glastrier.dateEnd, "2022-10-23"); // año heredado del segundo match
assert.ok(glastrier.dexNumbers.includes(896)); // Glastrier
assert.ok(glastrier.dexNumbers.includes(897)); // Spectrier
assert.equal(glastrier.shiny, "desconocido"); // no menciona "shiny"

// Bloques sin fecha reconocible o demasiado cortos se ignoran, no rompen el parseo.
const emptyEvents = parseEventsFromHtml("<p>Texto sin ninguna fecha aquí.</p>", {
  game: "Test",
  generation: 8,
  sourceUrl: "https://example.com",
  speciesNames,
});
assert.equal(emptyEvents.length, 0);

console.log("Todos los tests de fetch-events.mjs han pasado correctamente.");
