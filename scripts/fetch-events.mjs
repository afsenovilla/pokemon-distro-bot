#!/usr/bin/env node
/**
 * Genera data/events.json: eventos IN-GAME (Max Raid Battles de Espada/
 * Escudo, Tera Raid Battles de Escarlata/Púrpura, etc.) — NO son Mystery
 * Gift (eso ya está en data/eventsgallery.json) y NO es Pokémon GO (fuera
 * de alcance a propósito). Fuente: Serebii.net, que mantiene una página por
 * juego con el histórico completo de estos eventos con fechas concretas.
 *
 * A diferencia de wc-parsers.mjs (validado byte a byte contra >8000
 * archivos reales), este scraper es heurístico: analiza texto libre en vez
 * de un formato binario fijo, así que puede fallar o perderse algún evento
 * si Serebii cambia su maquetación. Por eso hay una red de seguridad
 * (MIN_ENTRIES) que aborta sin sobrescribir si el resultado parece
 * sospechosamente bajo, igual que en fetch-distributions.mjs.
 *
 * Salida: data/events.json
 */

import { load } from "cheerio";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const USER_AGENT =
  "Mozilla/5.0 (compatible; pokemon-distro-bot/1.0; +https://github.com/afsenovilla/pokemon-distro-bot)";

export const SOURCE_PAGES = [
  {
    url: "https://www.serebii.net/swordshield/wildareaevents.shtml",
    game: "Espada/Escudo",
    generation: 8,
  },
  {
    url: "https://www.serebii.net/scarletviolet/teraraidbattleevents.shtml",
    game: "Escarlata/Púrpura",
    generation: 9,
  },
];

const MONTHS_EN = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

// "August 28th 2026", "September 1st, 2025", "March 12 2023"...
const DATE_RE =
  /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})?/gi;

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
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function extractDateMatches(text) {
  const matches = [];
  let m;
  DATE_RE.lastIndex = 0;
  while ((m = DATE_RE.exec(text)) !== null) {
    matches.push({ month: MONTHS_EN[m[1].toLowerCase()], day: Number(m[2]), year: m[3] ? Number(m[3]) : null });
  }
  return matches;
}

function toIso(month, day, year) {
  if (!month || !day || !year) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** A partir del texto de un bloque, saca fecha de inicio/fin. Si el primer
 * match no tiene año (rango tipo "February 27th - March 12th 2023"), coge
 * el año del siguiente match que sí lo tenga. Un final tipo "End of
 * Service"/"End-of-life" se trata como "sigue abierto" (dateEnd null). */
function extractDateRange(text) {
  const matches = extractDateMatches(text);
  if (matches.length === 0) return { dateStart: null, dateEnd: null, dateRaw: null };

  const fallbackYear = matches.find((m) => m.year)?.year || null;
  const start = matches[0];
  const startIso = toIso(start.month, start.day, start.year || fallbackYear);

  const ongoing = /end[\s-]of[\s-](service|life)/i.test(text);
  let endIso = null;
  if (!ongoing && matches.length > 1) {
    const end = matches[1];
    endIso = toIso(end.month, end.day, end.year || fallbackYear);
  }

  // dateRaw: el fragmento de texto alrededor de la primera fecha, para que
  // el usuario pueda verificarlo aunque el parseo de arriba se equivoque.
  const rawMatch = text.match(/(Global|Release Dates?)\s*:?[\s\S]{0,80}/i);
  const dateRaw = (rawMatch ? rawMatch[0] : text.slice(0, 80)).replace(/\s+/g, " ").trim();

  return { dateStart: startIso, dateEnd: endIso, dateRaw };
}

/** Busca menciones de especies conocidas en el texto (nombre en inglés,
 * como aparece en Serebii), más largas primero para no confundir "Iron
 * Leaves" con "Leaves" de otra cosa. Devuelve los dexNumbers encontrados. */
function findDexNumbers(text, speciesEntries) {
  const found = new Set();
  for (const [dex, name] of speciesEntries) {
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(text)) found.add(Number(dex));
  }
  return [...found];
}

function looksShiny(text) {
  return /\bshiny\b/i.test(text) ? "possible" : "desconocido";
}

/** Parser puro (sin red): toma HTML ya descargado y devuelve los eventos
 * encontrados. Exportado para poder testearlo con HTML de muestra. */
export function parseEventsFromHtml(html, { game, generation, sourceUrl, speciesNames }) {
  const $ = load(html);
  const speciesEntries = Object.entries(speciesNames.en).sort((a, b) => b[1].length - a[1].length);
  const seen = new Map();

  $("td, p, li").each((_, block) => {
    const $block = $(block);
    // Nos quedamos solo con los bloques "hoja" respecto a este selector,
    // para no procesar el mismo evento dos veces por culpa de tablas
    // anidadas (un <td> que contiene otro <td> con el mismo texto).
    if ($block.find("td, p, li").length > 0) return;

    const text = $block.text().replace(/\s+/g, " ").trim();
    if (text.length < 20) return;
    if (!/\d{4}/.test(text)) return; // sin año no hay fecha fiable

    const boldText = $block.find("b, strong").first().text().replace(/\s+/g, " ").trim();
    const title = boldText || text.slice(0, 60);
    if (!title || title.length > 100) return;
    if (/^(global|release dates?)[:.]?$/i.test(title)) return;

    const { dateStart, dateEnd, dateRaw } = extractDateRange(text);
    if (!dateStart) return;

    const dexNumbers = findDexNumbers(text, speciesEntries);
    const shiny = looksShiny(text);

    const id = slugifyId(`${game}-${title}-${dateStart}`);
    if (seen.has(id)) return; // duplicado (tabla anidada, repetición en la página)

    const pokemonLabel =
      dexNumbers.length > 0
        ? dexNumbers
            .slice(0, 6)
            .map((d) => speciesNames.es[String(d)] || speciesNames.en[String(d)])
            .join(", ") + (dexNumbers.length > 6 ? ` y ${dexNumbers.length - 6} más` : "")
        : null;

    seen.set(id, {
      id,
      game,
      generation,
      title,
      dateStart,
      dateEnd,
      dateRaw,
      dexNumbers,
      pokemonLabel,
      shiny,
      sourceUrl,
    });
  });

  return [...seen.values()];
}

async function fetchHtml(url) {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
  return res.text();
}

async function main() {
  const speciesNames = JSON.parse(
    await readFile(path.join(__dirname, "resources", "species-names.json"), "utf8")
  );

  let all = [];
  const errors = [];

  for (const page of SOURCE_PAGES) {
    try {
      const html = await fetchHtml(page.url);
      const events = parseEventsFromHtml(html, { ...page, sourceUrl: page.url, speciesNames });
      all.push(...events);
      console.log(`OK  ${page.game}: ${events.length} eventos`);
    } catch (err) {
      console.error(`ERROR ${page.game}: ${err.message}`);
      errors.push({ page: page.url, error: err.message });
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  const today = new Date().toISOString().slice(0, 10);
  const MIN_ENTRIES = 10;
  if (all.length < MIN_ENTRIES) {
    console.error(
      `Solo se han extraído ${all.length} eventos (mínimo esperado ${MIN_ENTRIES}). ` +
        `Es probable que Serebii haya cambiado su formato, o que el scraping esté bloqueado. ` +
        `No se sobrescribe data/events.json.`
    );
    console.error(JSON.stringify(errors, null, 2));
    process.exit(1);
  }

  all.sort((a, b) => (b.dateStart || "").localeCompare(a.dateStart || ""));

  const output = {
    generatedAt: new Date().toISOString(),
    generatedToday: today,
    totalEntries: all.length,
    errors,
    entries: all,
  };

  await mkdir(path.join(ROOT, "data"), { recursive: true });
  await writeFile(path.join(ROOT, "data", "events.json"), JSON.stringify(output, null, 2) + "\n", "utf8");
  console.log(`\nGuardado data/events.json con ${all.length} eventos.`);
  console.log(
    "Aviso: este scraper es heurístico (texto libre, no un formato binario fijo). " +
      "Revisa a ojo unos cuantos eventos tras la primera ejecución real."
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
