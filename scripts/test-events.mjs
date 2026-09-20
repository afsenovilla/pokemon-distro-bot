import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseEventsFromHtml } from "./fetch-events.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const speciesNames = JSON.parse(
  await readFile(path.join(__dirname, "resources", "species-names.json"), "utf8")
);

// HTML calcado (recortado) del HTML real de Serebii, confirmado en producción
// vía logging de diagnóstico: el título vive en un <h2> dentro de
// td.fooleft, en una fila de tabla separada de la fila con
// td.foocontent (fechas + descripción). Todo dentro de <table class="tab">.
const SAMPLE_HTML = `
<table class="tab" align="center">
<tr>
  <td class="fooleft" colspan="2"><h2>Finale</h2></td>
</tr>
<tr>
  <td class="foocontent" valign="top">
    <b>Release Dates</b>:<br /><br />
    <b>Global:</b> November 1st 2022 - End of Service<br />
    <p>The final event and the now standard Wild Area News had the majority
    of the Gigantamax Pokémon as opponents to face, including Shiny
    Snorlax.</p>
    <p><a href="/swordshield/maxraidbattles/eventden-finale.shtml"><u>Click here for full details</u></a></p>
  </td>
  <td class="picturetd" width="300" valign="top"><img src="raidfinale.jpg" alt="Crown Tundra Event" /></td>
</tr>
<tr>
  <td class="fooleft" colspan="2"><h2>Challenge Glastrier &amp; Spectrier Event</h2></td>
</tr>
<tr>
  <td class="foocontent" valign="top">
    <b>Release Dates</b>:<br /><br />
    <b>Global:</b> October 21st - October 23rd 2022<br />
    <p>The October special Max Raid Battle event celebrated the second
    anniversary of The Crown Tundra and featured uncatchable battles
    against Glastrier and Spectrier.</p>
  </td>
  <td class="picturetd" width="300" valign="top"><img src="glastrier.jpg" /></td>
</tr>
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
assert.equal(finale.titleEs, null); // "Finale" no sigue ningún patrón oficial conocido -> se deja en inglés

const glastrier = events.find((e) => e.title.includes("Glastrier"));
assert.ok(glastrier, "debería encontrar el evento de Glastrier/Spectrier");
assert.equal(glastrier.dateStart, "2022-10-21");
assert.equal(glastrier.dateEnd, "2022-10-23"); // año heredado del segundo match
assert.ok(glastrier.dexNumbers.includes(896)); // Glastrier
assert.ok(glastrier.dexNumbers.includes(897)); // Spectrier
assert.equal(glastrier.shiny, "desconocido"); // no menciona "shiny"

// Otra página real (Tera Raid Battles de Escarlata/Púrpura): mismo patrón,
// dos eventos consecutivos, para confirmar que "currentTitle" se actualiza
// correctamente evento a evento y no se arrastra el título del anterior.
const SV_SAMPLE_HTML = `
<table class="tab" align="center">
<tr>
  <td class="fooleft" colspan="2"><h2>Mighty Kingambit</h2></td>
</tr>
<tr>
  <td class="foocontent" valign="top">
    <b>Release Dates</b>:<br /><br />
    <b>Global:</b> August 28th 2026 - September 3rd 2026<br /><br />
    <p>The ninety-second Tera Raid Battle event offers a challenge against a
    7 Star Raid Boss. This Raid Boss is Shiny Kingambit.</p>
  </td>
  <td class="picturetd" width="300" valign="top"><img src="toughraids.jpg" /></td>
</tr>
<tr>
  <td class="fooleft" colspan="2"><h2>Mighty Farigiraf</h2></td>
</tr>
<tr>
  <td class="foocontent" valign="top">
    <b>Release Dates</b>:<br /><br />
    <b>Global:</b> August 21st 2026 - August 27th 2026<br /><br />
    <p>The ninety-first Tera Raid Battle event offers a challenge against a
    7 Star Raid Boss.</p>
  </td>
  <td class="picturetd" width="300" valign="top"><img src="toughraids.jpg" /></td>
</tr>
</table>
`;
const svEvents = parseEventsFromHtml(SV_SAMPLE_HTML, {
  game: "Escarlata/Púrpura",
  generation: 9,
  sourceUrl: "https://www.serebii.net/scarletviolet/teraraidbattleevents.shtml",
  speciesNames,
});
assert.equal(svEvents.length, 2);
const kingambit = svEvents.find((e) => e.title === "Mighty Kingambit");
assert.ok(kingambit, "debería encontrar 'Mighty Kingambit'");
assert.equal(kingambit.dateStart, "2026-08-28");
assert.equal(kingambit.dateEnd, "2026-09-03");
assert.equal(kingambit.shiny, "possible");
assert.ok(kingambit.dexNumbers.includes(983)); // Kingambit
assert.equal(kingambit.titleEs, "Kingambit el Imbatible");

const farigiraf = svEvents.find((e) => e.title === "Mighty Farigiraf");
assert.ok(farigiraf, "debería encontrar 'Mighty Farigiraf' con su propio título, no el de Kingambit");
assert.equal(farigiraf.dateStart, "2026-08-21");
assert.equal(farigiraf.dateEnd, "2026-08-27");
assert.equal(farigiraf.titleEs, "Farigiraf el Imbatible");

// "Mighty X & Mighty Y" (dos jefes a la vez, nombres que SÍ cambian del
// inglés al español: Torterra/Infernape se quedan igual pero sirven para
// probar la "e" en vez de "y" delante de "Infernape") y "Shiny X".
const doubleAndShinyHtml = `
<table class="tab" align="center">
<tr>
  <td class="fooleft" colspan="2"><h2>Mighty Torterra &amp; Mighty Infernape</h2></td>
</tr>
<tr>
  <td class="foocontent" valign="top">
    <b>Global:</b> October 3rd 2025 - October 12th 2025<br />
    <p>The eighty-fourth Tera Raid Battle event.</p>
  </td>
</tr>
<tr>
  <td class="fooleft" colspan="2"><h2>Shiny Chi-Yu</h2></td>
</tr>
<tr>
  <td class="foocontent" valign="top">
    <b>Global:</b> September 1st 2025 - September 13th 2025<br />
    <p>The eighty-third Tera Raid Battle event.</p>
  </td>
</tr>
</table>
`;
const doubleAndShinyEvents = parseEventsFromHtml(doubleAndShinyHtml, {
  game: "Escarlata/Púrpura",
  generation: 9,
  sourceUrl: "https://www.serebii.net/scarletviolet/teraraidbattleevents.shtml",
  speciesNames,
});
const torterra = doubleAndShinyEvents.find((e) => e.title.includes("Torterra"));
assert.ok(torterra);
assert.equal(torterra.titleEs, "Torterra e Infernape, los Imbatibles");

const chiYu = doubleAndShinyEvents.find((e) => e.title === "Shiny Chi-Yu");
assert.ok(chiYu);
assert.equal(chiYu.titleEs, "Chi-Yu variocolor");

// Un td.foocontent sin ningún <h2> previo (título ausente) se ignora sin
// romper el parseo.
const noTitleEvents = parseEventsFromHtml(
  `<table class="tab"><tr><td class="foocontent">Global: March 1st 2024. Sin título previo.</td></tr></table>`,
  { game: "Test", generation: 8, sourceUrl: "https://example.com", speciesNames }
);
assert.equal(noTitleEvents.length, 0);

// Sin tabla "table.tab" en absoluto: no debe encontrar nada ni petar.
const emptyEvents = parseEventsFromHtml("<p>Texto sin ninguna fecha aquí.</p>", {
  game: "Test",
  generation: 8,
  sourceUrl: "https://example.com",
  speciesNames,
});
assert.equal(emptyEvents.length, 0);

console.log("Todos los tests de fetch-events.mjs han pasado correctamente.");
