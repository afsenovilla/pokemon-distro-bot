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

function dateRange(entry) {
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
