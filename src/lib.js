// Utilidades compartidas: normalización de texto y formato de cada
// distribución para los mensajes de Telegram.

export function normalize(str) {
  return (str || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

const MESES_ES = [
  "ene", "feb", "mar", "abr", "may", "jun",
  "jul", "ago", "sep", "oct", "nov", "dic",
];

export function formatDate(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MESES_ES[m - 1]} ${y}`;
}

/** Recalcula el estado de una entrada de data/distributions.json (fechas
 * concretas) respecto a hoy. */
export function computeStatus(entry, todayIso) {
  const { dateStart, dateEnd } = entry;
  if (!dateStart && !dateEnd) return "desconocido";
  if (dateStart && dateStart > todayIso) return "anunciada";
  if (dateEnd && dateEnd < todayIso) return "finalizada";
  if (dateStart && dateStart <= todayIso && (!dateEnd || dateEnd >= todayIso)) return "activa";
  return "desconocido";
}

const STATUS_LABEL = {
  activa: "🟢 Activa ahora",
  anunciada: "🔵 Anunciada (aún no empieza)",
  finalizada: "⚪ Finalizada",
  desconocido: "❔ Fecha sin confirmar",
};

export function statusLabel(status) {
  return STATUS_LABEL[status] || STATUS_LABEL.desconocido;
}

export function dateRange(entry) {
  const start = formatDate(entry.dateStart);
  const end = formatDate(entry.dateEnd);
  if (start && end) return `${start} – ${end}`;
  if (start) return `Desde ${start}`;
  if (end) return `Hasta ${end}`;
  return entry.dateRaw || "Fecha no confirmada";
}

export function escapeHtml(str) {
  return (str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Formatea una fila de data/distributions.json (estado activa/anunciada,
 * con fechas concretas del juego actual). */
export function formatStatusEntry(entry, { showSpecies = false } = {}) {
  const status = computeStatus(entry, new Date().toISOString().slice(0, 10));
  const title = showSpecies
    ? `<b>${escapeHtml(entry.species)}</b> — ${escapeHtml(entry.game || "Juego no especificado")}`
    : `<b>${escapeHtml(entry.game || "Juego no especificado")}</b>`;
  const lines = [title];
  lines.push(`📅 ${dateRange(entry)} · ${statusLabel(status)}`);
  const place = [entry.region, entry.method].filter(Boolean).map(escapeHtml).join(" · ");
  if (place) lines.push(`🌍 ${place}`);
  lines.push(`✨ Shiny: ${entry.shiny ? "Sí" : "No"}`);
  if (entry.level) lines.push(`🔢 Nivel ${entry.level}`);
  return lines.join("\n");
}

const SHINY_DISPLAY = {
  always: "✨ Shiny: <b>Sí, siempre</b>",
  never: "Shiny: <b>No, nunca</b>",
  random: "✨ Shiny: <b>Depende</b> (probabilidad normal/aumentada según tu suerte)",
  desconocido: "✨ Shiny: <b>Sin confirmar</b>",
};

const SHINY_SOURCE_TAG = {
  wondercard: "✅ verificado leyendo la wondercard real",
  "nombre-de-archivo": "ℹ️ estimado por el nombre del archivo (sin verificar el binario)",
};

// Pokémon Bank deja de poder conectar con Pokémon HOME el 26 de febrero de
// 2027 a las 03:00 GMT (confirmado por Nintendo/The Pokémon Company en
// agosto de 2026). A partir de ahí, cualquier Pokémon de Gen 1-7 que no se
// haya movido ya a HOME se queda atrapado en su juego/Banco para siempre.
const BANK_CLOSURE_UTC = Date.UTC(2027, 1, 26, 3, 0, 0); // mes 1 = febrero (0-indexado)
export const BANK_CLOSURE_LABEL = "26 de febrero de 2027";

export function daysUntilBankClosure() {
  const diff = BANK_CLOSURE_UTC - Date.now();
  return Math.ceil(diff / 86400000);
}

/** Calcula si esta distribución puede llegar hoy a Pokémon HOME, y cómo.
 * Se basa en la generación y, para los casos ambiguos (Gen 1/2 clásico vs
 * Virtual Console, Gen 7 3DS vs Switch), en la carpeta de origen dentro de
 * EventsGallery, que va incluida en representativeFile. */
export function homeStatus(entry) {
  const gen = entry.generation;
  if (gen == null) return null;
  const filePath = entry.representativeFile || "";

  if (gen >= 8) {
    return { icon: "✅", text: "Conecta directo con Pokémon HOME, sin pasar por Pokémon Bank." };
  }
  if (gen === 7 && /\/Switch\//i.test(filePath)) {
    return { icon: "✅", text: "Conecta directo con Pokémon HOME (Let's Go), sin pasar por Pokémon Bank." };
  }
  if ((gen === 1 || gen === 2) && /\/Classic\//i.test(filePath)) {
    return {
      icon: "⛔",
      text: "Sin ruta digital a HOME: es de la era del cartucho original, de antes de que existiera ninguna forma de transferencia online.",
    };
  }

  // Resto de Gen 1-7 (Virtual Console, GBA, DS, 3DS): pasa por Pokémon Bank.
  const days = daysUntilBankClosure();
  const deadline =
    days > 0
      ? `Pokémon Bank cierra el ${BANK_CLOSURE_LABEL} (quedan ${days} días)`
      : `Pokémon Bank cerró el ${BANK_CLOSURE_LABEL}: ya no hay forma de sacarlo de ahí`;
  const extra = gen === 3 ? " y de una DS con ranura GBA para el Pal Park" : "";
  return {
    icon: days > 0 ? "⚠️" : "⛔",
    text: `Necesita pasar por Pokémon Bank${extra} para llegar a HOME. ${deadline}.`,
  };
}

/** Formatea una entrada de data/eventsgallery.json (historial completo,
 * shiny verificado desde el binario cuando es posible, con id para pedir
 * la wondercard). */
export function formatGalleryEntry(entry, { showSpecies = false } = {}) {
  const gameLabel = entry.game || (entry.gameCode ? `Código de juego: ${entry.gameCode}` : "Juego no identificado");
  const title = showSpecies
    ? `<b>${escapeHtml(entry.speciesEs || entry.species)}</b> — ${escapeHtml(gameLabel)}`
    : `<b>${escapeHtml(gameLabel)}</b>`;
  const lines = [title];
  if (entry.event) lines.push(`🎁 ${escapeHtml(entry.event)}`);
  if (entry.generation) lines.push(`🕹️ Generación ${entry.generation}`);
  if (entry.region) lines.push(`🌍 Región: ${escapeHtml(entry.region)}`);
  lines.push(SHINY_DISPLAY[entry.shiny] || SHINY_DISPLAY.desconocido);
  const sourceTag = SHINY_SOURCE_TAG[entry.shinySource];
  if (sourceTag) lines.push(sourceTag);
  if (entry.variantCount > 1) lines.push(`🔁 ${entry.variantCount} variantes/códigos agrupados aquí`);
  const home = homeStatus(entry);
  if (home) lines.push(`${home.icon} <b>HOME:</b> ${home.text}`);
  lines.push(`📥 Descargar wondercard: <code>/wondercard ${escapeHtml(entry.id)}</code>`);
  return lines.join("\n");
}

/** Hash corto (8 hex) para usar como callback_data de Telegram en vez del
 * id completo de una distribución/evento, que puede superar los 64 bytes
 * que permite Telegram. No es criptográfico, solo necesita no colisionar
 * dentro de un catálogo de unos pocos miles de entradas. */
export function shortHash(str) {
  let h = 0x811c9dc5;
  const s = String(str || "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** A qué consola pertenece una entrada del historial (data/eventsgallery.json),
 * usando la generación y, para los casos ambiguos (Gen 1/2 cartucho vs
 * Virtual Console, Gen 7 3DS vs Switch), la carpeta de origen — mismo criterio
 * que homeStatus(). */
export function consoleLabel(entry) {
  const gen = entry.generation;
  const filePath = entry.representativeFile || "";
  if (gen === 1 || gen === 2) {
    return /\/Classic\//i.test(filePath)
      ? "Game Boy / Game Boy Color (cartucho original)"
      : "Nintendo 3DS (Virtual Console)";
  }
  if (gen === 3) return "Game Boy Advance";
  if (gen === 4 || gen === 5) return "Nintendo DS";
  if (gen === 6) return "Nintendo 3DS";
  if (gen === 7) {
    return /\/Switch\//i.test(filePath)
      ? "Nintendo Switch (Let's Go Pikachu/Eevee)"
      : "Nintendo 3DS";
  }
  if (gen === 8 || gen === 9) return "Nintendo Switch";
  return "Consola desconocida";
}

const CONSOLE_ORDER = [
  "Nintendo Switch",
  "Nintendo Switch (Let's Go Pikachu/Eevee)",
  "Nintendo 3DS",
  "Nintendo 3DS (Virtual Console)",
  "Nintendo DS",
  "Game Boy Advance",
  "Game Boy / Game Boy Color (cartucho original)",
  "Consola desconocida",
];

/** Agrupa entradas del historial por consola, de la más reciente a la más
 * antigua (y dentro de cada grupo, también por generación descendente). */
export function groupByConsole(entries) {
  const groups = new Map();
  for (const e of entries) {
    const label = consoleLabel(e);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(e);
  }
  const sortedLabels = [...groups.keys()].sort((a, b) => {
    const ia = CONSOLE_ORDER.indexOf(a);
    const ib = CONSOLE_ORDER.indexOf(b);
    return (ia === -1 ? CONSOLE_ORDER.length : ia) - (ib === -1 ? CONSOLE_ORDER.length : ib);
  });
  return sortedLabels.map((label) => ({
    label,
    entries: [...groups.get(label)].sort((a, b) => (b.generation ?? 0) - (a.generation ?? 0)),
  }));
}

const SHINY_ICON = { always: "✨", never: "", random: "🎲", desconocido: "❔" };

/** Una línea compacta por distribución (en vez del bloque largo de
 * formatGalleryEntry), pensada para listar muchas a la vez sin generar un
 * chorreo interminable. */
export function formatCompactGalleryLine(entry) {
  const icon = SHINY_ICON[entry.shiny] ?? "";
  const game = entry.game || entry.gameCode || "juego no identificado";
  const event = entry.event ? ` (${entry.event})` : "";
  return `• ${escapeHtml(game)}${escapeHtml(event)}${icon ? ` ${icon}` : ""} — <code>/wondercard ${escapeHtml(entry.id)}</code>`;
}

/** Vista compacta del histórico completo de un Pokémon, agrupada por
 * consola (más reciente primero), con el estado de HOME resumido una sola
 * vez por grupo en vez de repetido en cada línea. */
export function formatHistoryByConsole(speciesLabel, entries) {
  if (entries.length === 0) {
    return `No tengo ningún registro de distribuciones de <b>${escapeHtml(speciesLabel)}</b>.`;
  }
  const groups = groupByConsole(entries);
  const lines = [`<b>${escapeHtml(speciesLabel)}</b> — histórico completo (${entries.length})`, ""];
  for (const group of groups) {
    lines.push(`🕹️ <b>${escapeHtml(group.label)}</b>`);
    const home = homeStatus(group.entries[0]);
    if (home) lines.push(`${home.icon} ${home.text}`);
    for (const e of group.entries) lines.push(formatCompactGalleryLine(e));
    lines.push("");
  }
  return lines.join("\n").trim();
}

const EVENT_SHINY_TEXT = {
  possible: "✨ Shiny posible durante el evento",
  none: "Shiny no disponible en este evento",
  desconocido: "❔ Sin confirmar si hay shiny",
};

/** Formatea una entrada de data/events.json (eventos in-game: raids, etc.,
 * NO Mystery Gift). */
export function formatEventEntry(entry, { showTitle = true } = {}) {
  const status = computeStatus(entry, new Date().toISOString().slice(0, 10));
  const lines = [];
  if (showTitle) {
    lines.push(`<b>${escapeHtml(entry.title)}</b> — ${escapeHtml(entry.game || "Juego no especificado")}`);
  }
  lines.push(`📅 ${dateRange(entry)} · ${statusLabel(status)}`);
  if (entry.pokemonLabel) lines.push(`🎯 ${escapeHtml(entry.pokemonLabel)}`);
  lines.push(EVENT_SHINY_TEXT[entry.shiny] || EVENT_SHINY_TEXT.desconocido);
  if (entry.sourceUrl) lines.push(`🔗 <a href="${escapeHtml(entry.sourceUrl)}">Más info</a>`);
  return lines.join("\n");
}

/** Distribuciones Mystery Gift activas ahora mismo (data/distributions.json)
 * para un dexNumber concreto. */
export function findActiveDistributionsForDex(distEntries, dexNumber, today = new Date().toISOString().slice(0, 10)) {
  return distEntries.filter(
    (e) => e.dexNumber === dexNumber && computeStatus(e, today) === "activa"
  );
}

/** Eventos in-game activos ahora mismo (data/events.json) para un dexNumber
 * concreto (un evento puede afectar a varios Pokémon a la vez). */
export function findActiveEventsForDex(eventEntries, dexNumber, today = new Date().toISOString().slice(0, 10)) {
  return eventEntries.filter(
    (e) => Array.isArray(e.dexNumbers) && e.dexNumbers.includes(dexNumber) && computeStatus(e, today) === "activa"
  );
}

export function searchSpeciesIn(entries, query, speciesField = "species") {
  const q = normalize(query);
  if (!q) return { matches: [], entries: [] };

  const bySpecies = new Map();
  for (const e of entries) {
    const key = normalize(e[speciesField]);
    if (!bySpecies.has(key)) bySpecies.set(key, { name: e[speciesField], entries: [] });
    bySpecies.get(key).entries.push(e);
  }

  if (bySpecies.has(q)) {
    const group = bySpecies.get(q);
    return { matches: [group.name], entries: group.entries };
  }

  const partial = [...bySpecies.values()].filter(
    (g) => normalize(g.name).includes(q) || q.includes(normalize(g.name))
  );

  if (partial.length === 1) {
    return { matches: [partial[0].name], entries: partial[0].entries };
  }
  if (partial.length > 1) {
    return { matches: partial.map((g) => g.name), entries: [] };
  }
  return { matches: [], entries: [] };
}

/** Busca por nombre en inglés o en español (data/eventsgallery.json trae
 * ambos por entrada). */
export function searchGallery(entries, query) {
  const byEn = searchSpeciesIn(entries, query, "species");
  if (byEn.matches.length > 0) return byEn;
  return searchSpeciesIn(entries, query, "speciesEs");
}
