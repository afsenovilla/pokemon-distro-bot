#!/usr/bin/env node
/**
 * Genera data/eventsgallery.json: el catálogo COMPLETO de Pokémon
 * distribuidos oficialmente por Mystery Gift / regalos de evento a lo
 * largo de toda la historia de la saga, a partir del archivo comunitario
 * projectpokemon/EventsGallery (https://github.com/projectpokemon/EventsGallery),
 * el mismo que usa PKHeX para comprobar la legalidad de estos Pokémon.
 *
 * Para cada distribución, el shiny se determina LEYENDO EL BINARIO real
 * de la wondercard/archivo (no por intuición ni por el nombre del
 * archivo): ver wc-parsers.mjs, cuyos offsets están sacados directamente
 * del código fuente de PKHeX. Cuando el formato no se puede verificar de
 * forma fiable, se marca explícitamente como "no verificado" en vez de
 * inventar una respuesta.
 *
 * Uso:
 *   node scripts/fetch-eventsgallery.mjs             # clona el repo (necesita red)
 *   EG_LOCAL_PATH=/ruta/a/EventsGallery node scripts/fetch-eventsgallery.mjs   # usa una copia ya clonada
 */

import { readFile, readdir, writeFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { detectShiny, SUPPORTED_BINARY_EXTENSIONS } from "./wc-parsers.mjs";

const run = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const REPO_URL = "https://github.com/projectpokemon/EventsGallery.git";
const CLONE_DIR = path.join(ROOT, ".eventsgallery-tmp");

// Carpetas que no son distribuciones de Pokémon (objetos/cosméticos) o que
// no son historial confirmado (filtraciones sin anunciar oficialmente).
const EXCLUDED_DIR_NAMES = new Set([
  "extras",
  "pkhex legality",
  "unreleased",
  "dream world",
  "musicals",
  "pokedex skins",
  "c-gear backgrounds",
  "world tournaments",
  "secret base qr codes",
  "e-card berries",
  "pokemon link",
]);

// Carpetas "genéricas" (región/categoría) bajo las que varios archivos
// sueltos representan eventos DISTINTOS entre sí -> la clave de
// agrupación se saca del propio nombre de archivo. Cualquier otra carpeta
// se entiende como "un evento, varios códigos/variantes" y se usa su
// nombre como clave de agrupación.
const GENERIC_FOLDER_NAMES = new Set([
  "eng", "jpn", "ger", "fre", "ita", "spa", "kor", "usa", "eur", "aus", "na", "uk",
  "wondercards", "wondercard fulls", "files", "json", "trade distribution",
  "hex extracted cards", "classic", "vc", "switch", "3ds", "swsh", "bdsp", "pla",
  "sv", "za",
]);

const REGION_TAGS = new Set([
  "ENG", "JPN", "GER", "FRE", "ITA", "SPA", "KOR", "USA", "EUR", "AUS", "NA", "UK", "CHT", "CHS",
]);

async function loadResources() {
  const speciesNames = JSON.parse(
    await readFile(path.join(__dirname, "resources", "species-names.json"), "utf8")
  );
  const gameCodes = JSON.parse(
    await readFile(path.join(__dirname, "resources", "game-codes.json"), "utf8")
  );
  // Índice EN -> [dexNumber, nombre] ordenado por longitud de nombre
  // descendente, para hacer coincidencia por la subcadena más larga
  // posible (evita que "Porygon" cace dentro de "Porygon2" antes que el
  // nombre completo, por ejemplo).
  const entries = Object.entries(speciesNames.en).map(([id, name]) => ({
    dexNumber: Number(id),
    en: name,
    es: speciesNames.es[id] || name,
  }));
  entries.sort((a, b) => b.en.length - a.en.length);
  return { entries, gameCodes };
}

function matchSpecies(filename, speciesEntries) {
  for (const sp of speciesEntries) {
    const re = new RegExp(`(^|[^A-Za-z])${escapeRegExp(sp.en)}([^A-Za-z]|$)`, "i");
    if (re.test(filename)) return sp;
  }
  return null;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeGameCode(raw, gameCodes, generation) {
  if (!raw) return { name: null, code: raw };
  if (gameCodes.composites[raw]) return { name: gameCodes.composites[raw], code: raw };

  // Letras sueltas como "S" o "V" significan juegos distintos según la
  // generación (Zafiro en Gen 3, Sol en Gen 7, Escarlata en Gen 9...), así
  // que se resuelven primero con la tabla de esa generación, y solo se
  // completa con tokens "compartidos" (sin ambigüedad entre generaciones).
  const perGen = (generation && gameCodes.byGeneration[String(generation)]) || {};
  const dict = { ...gameCodes.sharedAtomic, ...perGen }; // perGen gana si hay choque
  const tokens = Object.keys(dict).sort((a, b) => b.length - a.length);

  let rest = raw;
  const parts = [];
  let guard = 0;
  while (rest.length > 0 && guard++ < 20) {
    const tok = tokens.find((t) => rest.startsWith(t));
    if (!tok) break;
    parts.push(dict[tok]);
    rest = rest.slice(tok.length);
  }
  if (rest.length > 0 || parts.length === 0) {
    return { name: null, code: raw }; // no se pudo descomponer con confianza
  }
  return { name: [...new Set(parts)].join("/"), code: raw };
}

function detectGeneration(relPath) {
  const m = relPath.match(/Gen (\d+)/);
  return m ? Number(m[1]) : null;
}

function detectRegion(filename, folderChain) {
  const parenMatches = [...filename.matchAll(/\(([^)]+)\)/g)].map((m) => m[1]);
  for (const p of parenMatches) {
    if (REGION_TAGS.has(p.toUpperCase())) return p.toUpperCase();
  }
  for (const folder of folderChain) {
    if (REGION_TAGS.has(folder.toUpperCase())) return folder.toUpperCase();
  }
  return null;
}

function stripExt(filename) {
  return filename.replace(/\.[a-zA-Z0-9]+$/, "");
}

/** Extrae { gameCodeRaw, eventDesc } de un nombre de archivo típico:
 * "1013 Y - WCS14K Houndoom (KOR) (F).wc6" -> gameCodeRaw "Y", eventDesc
 * "WCS14K Houndoom (KOR) (F)". Si no encaja el patrón, gameCodeRaw=null. */
function parseFilenamePattern(base) {
  const noExt = stripExt(base);
  const m = noExt.match(/^\d*\s*([A-Za-z0-9]+)\s*-\s*(.+)$/);
  if (!m) return { gameCodeRaw: null, eventDesc: noExt };
  return { gameCodeRaw: m[1], eventDesc: m[2].trim() };
}

function isGenericFolder(name) {
  return GENERIC_FOLDER_NAMES.has(name.toLowerCase());
}

async function* walk(dir, relBase = "") {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.isDirectory() && EXCLUDED_DIR_NAMES.has(e.name.toLowerCase())) continue;
    const abs = path.join(dir, e.name);
    const rel = relBase ? `${relBase}/${e.name}` : e.name;
    if (e.isDirectory()) {
      yield* walk(abs, rel);
    } else {
      yield { abs, rel };
    }
  }
}

function slugify(str) {
  return str
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function ensureRepo() {
  const localPath = process.env.EG_LOCAL_PATH;
  if (localPath) {
    if (!existsSync(localPath)) throw new Error(`EG_LOCAL_PATH no existe: ${localPath}`);
    return localPath;
  }
  if (existsSync(CLONE_DIR)) await rm(CLONE_DIR, { recursive: true, force: true });
  console.log("Clonando EventsGallery (puede tardar un par de minutos)...");
  await run("git", ["clone", "--depth", "1", REPO_URL, CLONE_DIR], { maxBuffer: 1024 * 1024 * 64 });
  return CLONE_DIR;
}

async function main() {
  const repoPath = await ensureRepo();
  const releasedDir = path.join(repoPath, "Released");
  const { entries: speciesEntries, gameCodes } = await loadResources();

  const SHINY_LABEL = { always: "siempre", never: "nunca", random: "aleatorio" };

  const groups = new Map(); // key -> { ...meta, files: [{path, shiny, shinySource}] }

  let scanned = 0;
  let skippedNonPokemon = 0;
  let skippedNoSpecies = 0;

  for await (const { abs, rel } of walk(releasedDir)) {
    const ext = path.extname(rel).slice(1).toLowerCase();
    if (!SUPPORTED_BINARY_EXTENSIONS.includes(ext)) continue;
    scanned++;

    const parts = rel.split("/");
    const filename = parts[parts.length - 1];
    const folderChain = parts.slice(0, -1);
    const generation = detectGeneration(rel);

    const species = matchSpecies(filename, speciesEntries);
    if (!species) {
      skippedNoSpecies++;
      continue;
    }

    const buf = await readFile(abs);
    const parsed = detectShiny(buf, ext);

    let shiny, shinySource;
    if (parsed.ok) {
      shiny = parsed.shiny;
      shinySource = "wondercard";
    } else if (parsed.reason.startsWith("no es un regalo de Pokémon")) {
      skippedNonPokemon++;
      continue;
    } else {
      const nameHasShiny = /shiny/i.test(filename);
      shiny = nameHasShiny ? "always" : "desconocido";
      shinySource = "nombre-de-archivo";
    }

    const immediateParent = folderChain[folderChain.length - 1] || "";
    const useFilenameKey = isGenericFolder(immediateParent);
    const { gameCodeRaw, eventDesc } = parseFilenamePattern(filename);
    const region = detectRegion(filename, folderChain);

    const groupKey = useFilenameKey
      ? `${species.dexNumber}|${gameCodeRaw || "?"}|${eventDesc.replace(/\s*\([^)]*\)\s*/g, " ").trim()}|${shiny}`
      : `${species.dexNumber}|${immediateParent}|${shiny}`;

    if (!groups.has(groupKey)) {
      const game = decodeGameCode(gameCodeRaw, gameCodes, generation);
      groups.set(groupKey, {
        species: species.en,
        speciesEs: species.es,
        dexNumber: species.dexNumber,
        generation,
        game: game.name,
        gameCode: game.code,
        event: useFilenameKey ? eventDesc : immediateParent,
        region,
        shiny,
        shinyLabel: SHINY_LABEL[shiny] || "desconocido",
        shinySource,
        variantCount: 0,
        representativeFile: rel,
        ext,
      });
    }
    const g = groups.get(groupKey);
    g.variantCount++;
  }

  const list = [...groups.values()].map((g) => ({
    id: slugify(`${g.species}-gen${g.generation}-${g.game || g.gameCode || "na"}-${g.shiny}-${g.event}`).slice(0, 80),
    ...g,
  }));

  // Evitar colisiones de id tras el slice/truncado.
  const seenIds = new Map();
  for (const e of list) {
    const base = e.id;
    const n = (seenIds.get(base) || 0) + 1;
    seenIds.set(base, n);
    if (n > 1) e.id = `${base}-${n}`;
  }

  list.sort((a, b) => a.species.localeCompare(b.species) || (a.generation ?? 0) - (b.generation ?? 0));

  const MIN_ENTRIES = 200;
  if (list.length < MIN_ENTRIES) {
    console.error(
      `Solo se agruparon ${list.length} distribuciones (mínimo esperado ${MIN_ENTRIES}). No se sobrescribe data/eventsgallery.json.`
    );
    process.exit(1);
  }

  const output = {
    generatedAt: new Date().toISOString(),
    source: "https://github.com/projectpokemon/EventsGallery",
    filesScanned: scanned,
    skippedNonPokemon,
    skippedNoSpeciesMatch: skippedNoSpecies,
    totalDistributions: list.length,
    entries: list,
  };

  await mkdir(path.join(ROOT, "data"), { recursive: true });
  await writeFile(
    path.join(ROOT, "data", "eventsgallery.json"),
    JSON.stringify(output, null, 2) + "\n",
    "utf8"
  );

  console.log(`\nArchivos escaneados: ${scanned}`);
  console.log(`Excluidos por ser objeto/no-Pokémon: ${skippedNonPokemon}`);
  console.log(`Excluidos por no reconocer la especie en el nombre: ${skippedNoSpecies}`);
  console.log(`Distribuciones agrupadas: ${list.length}`);
  console.log(`Guardado en data/eventsgallery.json`);

  if (!process.env.EG_LOCAL_PATH && existsSync(CLONE_DIR)) {
    await rm(CLONE_DIR, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
