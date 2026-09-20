#!/usr/bin/env node
/**
 * Genera data/distributions.json: SOLO el estado "activa ahora / anunciada
 * pero sin empezar" de las distribuciones del juego actual (Escarlata y
 * Púrpura, Legends Z-A). No es la fuente del historial completo — para eso
 * está data/eventsgallery.json (scripts/fetch-eventsgallery.mjs), que cubre
 * TODA la historia de Mystery Gift con el shiny verificado desde el binario
 * real. Bulbapedia mantiene estas dos páginas al día casi a diario, con
 * fechas de inicio/fin más precisas que lo que se puede sacar de un archivo
 * de wondercard suelto, así que se usan solo para saber "¿está esto activo
 * ahora mismo?".
 *
 * Salida: data/distributions.json
 */

import { load } from "cheerio";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function findDexNumber(speciesName, speciesEntriesSorted) {
  const target = speciesName.toLowerCase();
  for (const [dex, name] of speciesEntriesSorted) {
    if (target.includes(name.toLowerCase())) return Number(dex);
  }
  return null;
}

const API_BASE = "https://bulbapedia.bulbagarden.net/w/api.php";
const USER_AGENT =
  "pokemon-distro-bot/1.0 (bot de Telegram de distribuciones Pokémon; uso personal, no comercial)";

const CURRENT_GEN_PAGES = [
  {
    title: "List of event Pokémon distributions in Pokémon Scarlet and Violet",
    game: "Pokémon Escarlata/Púrpura",
  },
  {
    title: "List of event Pokémon distributions in Pokémon Legends: Z-A",
    game: "Pokémon Legends: Z-A",
  },
];

async function fetchJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
  return res.json();
}

async function fetchPageHtml(title) {
  const url = `${API_BASE}?action=parse&page=${encodeURIComponent(
    title
  )}&prop=text&format=json&formatversion=2`;
  const json = await fetchJson(url);
  if (json.error) throw new Error(`${title}: ${json.error.info}`);
  return json.parse.text;
}

function normalize(str) {
  return (str || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

function slugifyId(str) {
  return normalize(str)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

function extractDates(text) {
  if (!text) return { dateStart: null, dateEnd: null };
  const re = /([A-Z][a-z]+)\s+(\d{1,2}),?\s+(\d{4})/g;
  const found = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const month = MONTHS[m[1].toLowerCase()];
    if (!month) continue;
    const day = String(m[2]).padStart(2, "0");
    const monthStr = String(month).padStart(2, "0");
    found.push(`${m[3]}-${monthStr}-${day}`);
  }
  return { dateStart: found[0] || null, dateEnd: found[1] || null };
}

function looksShiny($, row) {
  const text = $(row).text();
  if (/\bshiny\b/i.test(text)) return true;
  return $(row)
    .find("img")
    .toArray()
    .some((img) => /shiny/i.test($(img).attr("alt") || ""));
}

function findColumnIndex(headers, keywords) {
  return headers.findIndex((h) => keywords.some((k) => h.toLowerCase().includes(k)));
}

function parseCurrentGenPage(html, gameName, sourceUrl) {
  const $ = load(html);
  const entries = [];

  $("table").each((_, table) => {
    const $table = $(table);
    const headerCells = $table
      .find("tr")
      .first()
      .find("th")
      .toArray()
      .map((th) => $(th).text().trim());
    if (headerCells.length === 0) return;

    const pokemonIdx = findColumnIndex(headerCells, ["pokemon", "pokémon"]);
    if (pokemonIdx < 0) return;
    const dateIdx = findColumnIndex(headerCells, ["date", "period", "distribution"]);
    const regionIdx = findColumnIndex(headerCells, ["region", "country"]);
    const methodIdx = findColumnIndex(headerCells, ["method", "how"]);
    const levelIdx = findColumnIndex(headerCells, ["level"]);

    $table
      .find("tr")
      .slice(1)
      .each((_, tr) => {
        const cells = $(tr).find("td");
        if (cells.length === 0) return;
        const cellText = (i) =>
          i >= 0 && cells.eq(i).length ? cells.eq(i).text().replace(/\s+/g, " ").trim() : "";

        const speciesCell = cellText(pokemonIdx);
        if (!speciesCell) return;
        const species = speciesCell.split("\n")[0].trim();

        const dateText = dateIdx >= 0 ? cellText(dateIdx) : "";
        const { dateStart, dateEnd } = extractDates(dateText);

        entries.push({
          species,
          game: gameName,
          event: null,
          region: regionIdx >= 0 ? cellText(regionIdx) : null,
          method: methodIdx >= 0 ? cellText(methodIdx) : null,
          dateStart,
          dateEnd,
          dateRaw: dateText || null,
          level: (() => {
            const t = levelIdx >= 0 ? cellText(levelIdx) : "";
            const m = t.match(/\d+/);
            return m ? Number(m[0]) : null;
          })(),
          shiny: looksShiny($, tr),
          sourceUrl,
        });
      });
  });

  return entries;
}

function computeStatus(entry, today) {
  if (!entry.dateStart && !entry.dateEnd) return "desconocido";
  if (entry.dateStart && entry.dateStart > today) return "anunciada";
  if (entry.dateEnd && entry.dateEnd < today) return "finalizada";
  if (entry.dateStart && entry.dateStart <= today && (!entry.dateEnd || entry.dateEnd >= today))
    return "activa";
  return "desconocido";
}

function dedupe(entries) {
  const seen = new Map();
  for (const e of entries) {
    const key = [normalize(e.species), normalize(e.game || ""), e.dateStart || "", e.dateEnd || ""].join("|");
    if (!seen.has(key)) seen.set(key, e);
  }
  return [...seen.values()];
}

async function main() {
  const speciesNames = JSON.parse(
    await readFile(path.join(__dirname, "resources", "species-names.json"), "utf8")
  );
  const speciesEntriesSorted = Object.entries(speciesNames.en).sort((a, b) => b[1].length - a[1].length);

  let all = [];
  const errors = [];

  for (const page of CURRENT_GEN_PAGES) {
    const sourceUrl = `https://bulbapedia.bulbagarden.net/wiki/${encodeURIComponent(
      page.title.replace(/ /g, "_")
    )}`;
    try {
      const html = await fetchPageHtml(page.title);
      const entries = parseCurrentGenPage(html, page.game, sourceUrl);
      all.push(...entries);
      console.log(`OK  ${page.game}: ${entries.length} filas`);
    } catch (err) {
      console.error(`ERROR ${page.game}: ${err.message}`);
      errors.push({ page: page.title, error: err.message });
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  all = dedupe(all);

  const MIN_ENTRIES = 3;
  if (all.length < MIN_ENTRIES) {
    console.error(
      `Solo se han extraído ${all.length} entradas (mínimo esperado ${MIN_ENTRIES}). ` +
        `Es probable que Bulbapedia haya cambiado su formato. No se sobrescribe data/distributions.json.`
    );
    console.error(JSON.stringify(errors, null, 2));
    process.exit(1);
  }

  const today = new Date().toISOString().slice(0, 10);
  const withIds = all.map((e) => ({
    id: slugifyId(`${e.species}-${e.game || ""}-${e.dateStart || Math.random()}`),
    ...e,
    dexNumber: findDexNumber(e.species, speciesEntriesSorted),
    status: computeStatus(e, today),
  }));

  withIds.sort((a, b) => (b.dateStart || "").localeCompare(a.dateStart || ""));

  const output = {
    generatedAt: new Date().toISOString(),
    totalEntries: withIds.length,
    errors,
    entries: withIds,
  };

  await mkdir(path.join(ROOT, "data"), { recursive: true });
  await writeFile(
    path.join(ROOT, "data", "distributions.json"),
    JSON.stringify(output, null, 2) + "\n",
    "utf8"
  );
  console.log(`\nGuardado data/distributions.json con ${withIds.length} entradas.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
