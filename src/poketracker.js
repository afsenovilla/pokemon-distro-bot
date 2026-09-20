// Cruce con Poketracker (https://github.com/afsenovilla/poketracker): su
// progreso de Living Dex / Living Dex Shiny es un JSON público de solo
// lectura (data/progreso.json), así que el bot lo lee directamente, sin
// login ni vincular cuentas. Es un cruce pensado para quien mantiene el
// bot, no un sistema multiusuario.
//
// Esquema real (sacado de src/lib/types.ts del propio Poketracker):
//   SlotState: { c?: 1 (capturado en HOME), x?: 1 (excluido),
//                g?: string (id de juego donde está pendiente de mover) }
// Los ids de juego "pendiente" válidos están en src/lib/games.ts; de todos
// ellos, solo 'bank' depende del cierre de Pokémon Bank (26 feb 2027) — el
// resto (go, lgpe, swsh, bdsp, pla, sv, za, frlg) conectan directo a HOME.

import { daysUntilBankClosure, BANK_CLOSURE_LABEL, escapeHtml } from "./lib.js";

const BANK_GAME_ID = "bank";

export async function fetchPoketrackerData(repo) {
  const base = `https://raw.githubusercontent.com/${repo}/main/`;
  const [pokedexRes, progresoRes] = await Promise.all([
    fetch(base + "public/data/pokedex.json", { headers: { "cache-control": "no-cache" } }),
    fetch(base + "data/progreso.json", { headers: { "cache-control": "no-cache" } }),
  ]);
  if (!pokedexRes.ok || !progresoRes.ok) {
    throw new Error(
      `No se pudo leer el progreso de Poketracker (pokedex ${pokedexRes.status}, progreso ${progresoRes.status})`
    );
  }
  const pokedex = await pokedexRes.json();
  const progreso = await progresoRes.json();

  const slugByDexNumber = new Map();
  for (const e of pokedex.entries) {
    if (e.category === "base" && !slugByDexNumber.has(e.species)) {
      slugByDexNumber.set(e.species, e.slug);
    }
  }
  return { slugByDexNumber, progreso };
}

function findDexId(progreso, { shiny }) {
  const dex = progreso.dexes.find((d) => d.shiny === shiny);
  return dex ? dex.id : null;
}

/**
 * Construye el informe de "qué te falta":
 *  - pendientesBank: especies que YA tienes pero siguen en un juego de
 *    Pokémon Bank (3DS) sin mover a HOME, con la cuenta atrás.
 *  - shinyFaltantes: especies con una distribución shiny GARANTIZADA que
 *    todavía no tienes marcada en tu Living Dex Shiny.
 */
export function buildFaltanReport({ slugByDexNumber, progreso }, galleryEntries) {
  const normalDexId = findDexId(progreso, { shiny: false });
  const shinyDexId = findDexId(progreso, { shiny: true });
  const normalCaptures = normalDexId ? progreso.captures[normalDexId] || {} : {};
  const shinyCaptures = shinyDexId ? progreso.captures[shinyDexId] || {} : {};

  const pendientesBank = [];
  for (const [dexLabel, captures] of [
    ["Living Dex", normalCaptures],
    ["Living Dex Shiny", shinyCaptures],
  ]) {
    for (const [slug, slot] of Object.entries(captures)) {
      if (slot.c === 1) continue; // ya está en HOME
      if (slot.g !== BANK_GAME_ID) continue; // pendiente en un juego que no depende de Bank
      pendientesBank.push({ slug, dexLabel });
    }
  }

  // Especies por número de dex -> nombre, para mostrar algo legible (el
  // slug ya sirve de por sí, pero usamos el nombre en español de la
  // wondercard si lo tenemos vía galleryEntries).
  const nameBySlug = new Map();
  for (const e of galleryEntries) {
    const slug = slugByDexNumber.get(e.dexNumber);
    if (slug && !nameBySlug.has(slug)) nameBySlug.set(slug, e.speciesEs || e.species);
  }
  for (const p of pendientesBank) {
    p.name = nameBySlug.get(p.slug) || p.slug;
  }

  const shinyFaltantes = [];
  if (shinyDexId) {
    const bySpecies = new Map();
    for (const e of galleryEntries) {
      if (e.shiny !== "always") continue;
      const slug = slugByDexNumber.get(e.dexNumber);
      if (!slug) continue;
      const slot = shinyCaptures[slug];
      if (slot && (slot.c === 1 || slot.x === 1)) continue; // ya lo tiene o lo excluyó a propósito
      if (!bySpecies.has(slug)) bySpecies.set(slug, []);
      bySpecies.get(slug).push(e);
    }
    for (const [slug, entries] of bySpecies) {
      shinyFaltantes.push({ slug, entries, name: entries[0].speciesEs || entries[0].species });
    }
  }

  return { pendientesBank, shinyFaltantes, hasDexes: Boolean(normalDexId || shinyDexId) };
}

export function formatFaltanReport(report) {
  if (!report.hasDexes) {
    return "No he encontrado ninguna Living Dex en ese Poketracker.";
  }
  const days = daysUntilBankClosure();
  const parts = [];

  if (report.pendientesBank.length > 0) {
    const lines = report.pendientesBank
      .map((p) => `• <b>${escapeHtml(p.name)}</b> (${escapeHtml(p.dexLabel)})`)
      .join("\n");
    const urgency =
      days > 0
        ? `⚠️ Quedan ${days} días antes de que Pokémon Bank cierre (${BANK_CLOSURE_LABEL}) y se queden atrapados para siempre.`
        : `⛔ Pokémon Bank ya ha cerrado — si no se movieron antes, se han quedado atrapados.`;
    parts.push(
      `<b>Pendientes de mover a HOME (${report.pendientesBank.length})</b>\n${urgency}\n\n${lines}`
    );
  }

  if (report.shinyFaltantes.length > 0) {
    const lines = report.shinyFaltantes
      .map((s) => {
        const juegos = [...new Set(s.entries.map((e) => e.game || e.gameCode))].filter(Boolean).join(", ");
        return `• <b>${escapeHtml(s.name)}</b> — ${escapeHtml(juegos)} (<code>/pokemon ${escapeHtml(s.name)}</code>)`;
      })
      .join("\n");
    parts.push(
      `<b>Shiny garantizados que te faltan en la Living Dex Shiny (${report.shinyFaltantes.length})</b>\nBusca cada uno para ver el id y pedir la wondercard con /wondercard.\n\n${lines}`
    );
  }

  if (parts.length === 0) {
    return "🎉 No hay nada pendiente: no te falta mover nada de Pokémon Bank y no hay ningún shiny garantizado por Mystery Gift que no tengas ya en la Living Dex Shiny.";
  }

  return parts.join("\n\n");
}
