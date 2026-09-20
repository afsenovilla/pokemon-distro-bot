import {
  computeStatus,
  formatStatusEntry,
  formatGalleryEntry,
  formatEventEntry,
  formatHistoryByConsole,
  findActiveDistributionsForDex,
  findActiveEventsForDex,
  searchGallery,
  escapeHtml,
  shortHash,
  daysUntilBankClosure,
  BANK_CLOSURE_LABEL,
} from "./lib.js";
import { fetchPoketrackerData, buildFaltanReport, formatFaltanReport } from "./poketracker.js";
import {
  getUserState,
  saveUserState,
  getSubscribers,
  ensureSubscribed,
  applyItemAction,
  setAlertsEnabled,
  isSuppressed,
} from "./state.js";

const KV_KEY_STATUS = "distributions"; // data/distributions.json (Mystery Gift activa/anunciada, juego actual)
const KV_KEY_GALLERY = "eventsgallery"; // data/eventsgallery.json (historial completo + shiny verificado)
const KV_KEY_EVENTS = "events"; // data/events.json (eventos in-game: raids, etc. — no Mystery Gift, no Pokémon GO)
const KV_KEY_IDMAP = "idmap"; // hash corto -> "d:<id>" | "e:<id>", para los botones inline
const KV_KEY_SEEN = "seen"; // últimos ids de distribuciones/eventos activos o anunciados vistos

const EVENTSGALLERY_RAW_BASE = "https://raw.githubusercontent.com/projectpokemon/EventsGallery/master/";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function buildHelpText(env, chatId) {
  const owner = env.OWNER_CHAT_ID;
  const isOwner = !owner || String(chatId) === String(owner);
  const faltanLine = isOwner
    ? "\n• /faltan — cruce con la Living Dex de Poketracker: qué se queda atrapado si no se mueve a HOME a tiempo, y qué shiny garantizados faltan por conseguir" +
      "\n• /refresh — recarga ahora mismo los datos desde GitHub, sin esperar al cron semanal"
    : "";
  return `<b>Pokémon Distribuciones Bot</b>
Distribuciones (Mystery Gift) y eventos in-game (raids, etc. — no Pokémon GO) de todos los juegos principales de Pokémon.

<b>Comandos</b>
• Escribe el nombre de un Pokémon (o usa /pokemon nombre) — te digo si tiene algo activo ahora mismo (distribución o evento); si no, te dejo ver el histórico completo con un botón, agrupado por consola
• /wondercard &lt;id&gt; — descarga el archivo real de una distribución (el id sale en el histórico)
• /home — recordatorio del cierre de Pokémon Bank y qué juegos se ven afectados
• /activas — distribuciones Mystery Gift activas ahora
• /proximas — distribuciones Mystery Gift anunciadas que aún no han empezado
• /eventosactivos — eventos in-game (raids, etc.) activos ahora
• /eventosproximos — eventos in-game anunciados que aún no han empezado
• /alertas on|off — avisarte (o no) en cuanto detecte una distribución o evento nuevo, con botones para posponerlo, marcarlo hecho o silenciarlo${faltanLine}
• /ayuda — este mensaje

Fuentes: <a href="https://github.com/projectpokemon/EventsGallery">projectpokemon/EventsGallery</a> (historial de Mystery Gift) y Serebii.net (eventos in-game), actualizado cada semana.`;
}

async function telegramApi(env, method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    console.error(`Telegram ${method} fallo: ${res.status} ${await res.text()}`);
  }
  return res;
}

function sendMessage(env, chatId, text, keyboard) {
  const chunks = [];
  let rest = text;
  while (rest.length > 4000) {
    let cut = rest.lastIndexOf("\n\n", 4000);
    if (cut < 1000) cut = 4000;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  chunks.push(rest);
  return Promise.all(
    chunks.map((chunk, i) =>
      telegramApi(env, "sendMessage", {
        chat_id: chatId,
        text: chunk,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        // el teclado solo va en el último trozo, si lo hay
        ...(keyboard && i === chunks.length - 1 ? { reply_markup: keyboard } : {}),
      })
    )
  );
}

async function editMessageText(env, chatId, messageId, text, keyboard) {
  return telegramApi(env, "editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(keyboard !== undefined ? { reply_markup: keyboard || { inline_keyboard: [] } } : {}),
  });
}

async function editMessageReplyMarkup(env, chatId, messageId, keyboard) {
  return telegramApi(env, "editMessageReplyMarkup", {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: keyboard || { inline_keyboard: [] },
  });
}

async function answerCallbackQuery(env, callbackQueryId, text) {
  return telegramApi(env, "answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    ...(text ? { text, show_alert: false } : {}),
  });
}

async function sendDocument(env, chatId, blob, filename, caption) {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (caption) form.append("caption", caption);
  form.append("document", blob, filename);
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendDocument`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    console.error(`Telegram sendDocument fallo: ${res.status} ${await res.text()}`);
  }
  return res;
}

// --- Datasets en KV ---

async function getJsonDataset(env, key) {
  const raw = await env.DISTRO_KV.get(key);
  if (!raw) return { generatedAt: null, entries: [] };
  try {
    return JSON.parse(raw);
  } catch {
    return { generatedAt: null, entries: [] };
  }
}
const getStatusDataset = (env) => getJsonDataset(env, KV_KEY_STATUS);
const getGalleryDataset = (env) => getJsonDataset(env, KV_KEY_GALLERY);
const getEventsDataset = (env) => getJsonDataset(env, KV_KEY_EVENTS);

async function getIdMap(env) {
  const raw = await env.DISTRO_KV.get(KV_KEY_IDMAP);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

// --- Teclados inline ---

function actionKeyboard(hash, doneLabel) {
  return {
    inline_keyboard: [
      [{ text: `✅ ${doneLabel}`, callback_data: `dn:${hash}` }],
      [
        { text: "⏰ Posponer", callback_data: `sn:${hash}` },
        { text: "🔕 No me interesa", callback_data: `mu:${hash}` },
      ],
    ],
  };
}

function snoozeKeyboard(hash) {
  const days = [1, 2, 3, 5, 7];
  return {
    inline_keyboard: [
      days.map((d) => ({ text: `${d}d`, callback_data: `sd:${hash}:${d}` })),
      [{ text: "‹ Atrás", callback_data: `bk:${hash}` }],
    ],
  };
}

function historyKeyboard(dexNumber) {
  return {
    inline_keyboard: [
      [{ text: "📜 Ver distribuciones anteriores", callback_data: `hi:${dexNumber}` }],
      [{ text: "✖️ Cancelar", callback_data: `cn:${dexNumber}` }],
    ],
  };
}

// --- Refresco de datos + detección de novedades ---

async function refreshData(env) {
  const fetches = [
    fetch(env.GITHUB_DATA_URL, { headers: { "cache-control": "no-cache" } }),
    fetch(env.GITHUB_GALLERY_URL, { headers: { "cache-control": "no-cache" } }),
    env.GITHUB_EVENTS_URL
      ? fetch(env.GITHUB_EVENTS_URL, { headers: { "cache-control": "no-cache" } })
      : Promise.resolve(null),
  ];
  const [statusRes, galleryRes, eventsRes] = await Promise.all(fetches);
  const results = {};
  let statusJson = null;
  let eventsJson = null;

  if (statusRes.ok) {
    statusJson = await statusRes.json();
    await env.DISTRO_KV.put(KV_KEY_STATUS, JSON.stringify(statusJson));
    results.status = statusJson.entries?.length ?? 0;
  } else {
    console.error(`No se pudo descargar distributions.json: HTTP ${statusRes.status}`);
  }

  if (galleryRes.ok) {
    const json = await galleryRes.json();
    await env.DISTRO_KV.put(KV_KEY_GALLERY, JSON.stringify(json));
    results.gallery = json.entries?.length ?? 0;
  } else {
    console.error(`No se pudo descargar eventsgallery.json: HTTP ${galleryRes.status}`);
  }

  if (eventsRes) {
    if (eventsRes.ok) {
      eventsJson = await eventsRes.json();
      await env.DISTRO_KV.put(KV_KEY_EVENTS, JSON.stringify(eventsJson));
      results.events = eventsJson.entries?.length ?? 0;
    } else {
      console.error(`No se pudo descargar events.json: HTTP ${eventsRes.status}`);
    }
  }

  await rebuildIdMapAndNotify(env, statusJson, eventsJson);

  return results;
}

/** Reconstruye el mapa hash->id (para los botones) y compara contra la
 * última foto guardada para avisar a los suscriptores de lo genuinamente
 * nuevo. La primera vez que se ejecuta (no hay "seen" todavía) solo guarda
 * la foto actual sin avisar a nadie — si no, el primer despliegue de esta
 * función mandaría un aviso por cada distribución/evento activo o
 * anunciado que ya existiera. */
async function rebuildIdMapAndNotify(env, statusJson, eventsJson) {
  const today = todayIso();
  const relevantDist = (statusJson?.entries || []).filter((e) =>
    ["activa", "anunciada"].includes(computeStatus(e, today))
  );
  const relevantEvents = (eventsJson?.entries || []).filter((e) =>
    ["activa", "anunciada"].includes(computeStatus(e, today))
  );

  const idmap = {};
  for (const e of relevantDist) idmap[shortHash(`d:${e.id}`)] = `d:${e.id}`;
  for (const e of relevantEvents) idmap[shortHash(`e:${e.id}`)] = `e:${e.id}`;
  await env.DISTRO_KV.put(KV_KEY_IDMAP, JSON.stringify(idmap));

  const seenRaw = await env.DISTRO_KV.get(KV_KEY_SEEN);
  const seen = seenRaw ? JSON.parse(seenRaw) : null;

  if (seen) {
    const newDist = relevantDist.filter((e) => !seen.distributions?.includes(e.id));
    const newEvents = relevantEvents.filter((e) => !seen.events?.includes(e.id));
    if (newDist.length > 0 || newEvents.length > 0) {
      await notifySubscribers(env, newDist, newEvents);
    }
  }

  await env.DISTRO_KV.put(
    KV_KEY_SEEN,
    JSON.stringify({ distributions: relevantDist.map((e) => e.id), events: relevantEvents.map((e) => e.id) })
  );
}

async function notifySubscribers(env, newDist, newEvents) {
  const subs = await getSubscribers(env);
  for (const chatId of subs) {
    let state;
    try {
      state = await getUserState(env, chatId);
    } catch {
      continue;
    }
    if (!state.alertsEnabled) continue;

    for (const e of newDist) {
      const key = `d:${e.id}`;
      if (isSuppressed(state, key)) continue;
      const hash = shortHash(key);
      const text = `🆕 <b>Nueva distribución</b>\n\n${formatStatusEntry(e, { showSpecies: true })}`;
      await sendMessage(env, chatId, text, actionKeyboard(hash, "Ya la tengo / canjeada"));
    }
    for (const e of newEvents) {
      const key = `e:${e.id}`;
      if (isSuppressed(state, key)) continue;
      const hash = shortHash(key);
      const text = `🆕 <b>Nuevo evento</b>\n\n${formatEventEntry(e)}`;
      await sendMessage(env, chatId, text, actionKeyboard(hash, "Completado"));
    }
  }
}

// --- Rate limit ---

async function isRateLimited(env, chatId) {
  const key = `rl:${chatId}`;
  const current = await env.DISTRO_KV.get(key);
  const count = current ? Number(current) : 0;
  if (count >= 8) return true;
  // El TTL mínimo permitido por Cloudflare KV es 60s, aunque la ventana de
  // rate-limit que queremos aplicar es de 20s (8 mensajes / 20s).
  await env.DISTRO_KV.put(key, String(count + 1), { expirationTtl: 60 });
  return false;
}

// --- Handlers de comandos ---

async function handleActivas(env, chatId) {
  const { entries } = await getStatusDataset(env);
  const activas = entries
    .filter((e) => computeStatus(e, todayIso()) === "activa")
    .sort((a, b) => (a.dateEnd || "9999").localeCompare(b.dateEnd || "9999"));

  if (activas.length === 0) {
    await sendMessage(env, chatId, "No tengo ninguna distribución Mystery Gift marcada como activa ahora mismo. Prueba con /proximas.");
    return;
  }
  const LIMIT = 15;
  const shown = activas.slice(0, LIMIT);
  const body = shown.map((e) => formatStatusEntry(e, { showSpecies: true })).join("\n\n");
  const header = `<b>Distribuciones activas ahora (${activas.length})</b>\n\n`;
  const footer = activas.length > LIMIT ? `\n\n… y ${activas.length - LIMIT} más.` : "";
  await sendMessage(env, chatId, header + body + footer);
}

async function handleProximas(env, chatId) {
  const { entries } = await getStatusDataset(env);
  const proximas = entries
    .filter((e) => computeStatus(e, todayIso()) === "anunciada")
    .sort((a, b) => (a.dateStart || "9999").localeCompare(b.dateStart || "9999"));

  if (proximas.length === 0) {
    await sendMessage(env, chatId, "No tengo ninguna distribución Mystery Gift anunciada todavía sin empezar. Prueba con /activas.");
    return;
  }
  const LIMIT = 15;
  const shown = proximas.slice(0, LIMIT);
  const body = shown.map((e) => formatStatusEntry(e, { showSpecies: true })).join("\n\n");
  const header = `<b>Distribuciones anunciadas (${proximas.length})</b>\n\n`;
  const footer = proximas.length > LIMIT ? `\n\n… y ${proximas.length - LIMIT} más.` : "";
  await sendMessage(env, chatId, header + body + footer);
}

async function handleEventosActivos(env, chatId) {
  const { entries } = await getEventsDataset(env);
  const activos = entries
    .filter((e) => computeStatus(e, todayIso()) === "activa")
    .sort((a, b) => (a.dateEnd || "9999").localeCompare(b.dateEnd || "9999"));

  if (activos.length === 0) {
    await sendMessage(env, chatId, "No tengo ningún evento in-game marcado como activo ahora mismo. Prueba con /eventosproximos.");
    return;
  }
  const LIMIT = 15;
  const shown = activos.slice(0, LIMIT);
  const body = shown.map((e) => formatEventEntry(e)).join("\n\n");
  const header = `<b>Eventos in-game activos ahora (${activos.length})</b>\n\n`;
  const footer = activos.length > LIMIT ? `\n\n… y ${activos.length - LIMIT} más.` : "";
  await sendMessage(env, chatId, header + body + footer);
}

async function handleEventosProximos(env, chatId) {
  const { entries } = await getEventsDataset(env);
  const proximos = entries
    .filter((e) => computeStatus(e, todayIso()) === "anunciada")
    .sort((a, b) => (a.dateStart || "9999").localeCompare(b.dateStart || "9999"));

  if (proximos.length === 0) {
    await sendMessage(env, chatId, "No tengo ningún evento in-game anunciado todavía sin empezar. Prueba con /eventosactivos.");
    return;
  }
  const LIMIT = 15;
  const shown = proximos.slice(0, LIMIT);
  const body = shown.map((e) => formatEventEntry(e)).join("\n\n");
  const header = `<b>Eventos in-game anunciados (${proximos.length})</b>\n\n`;
  const footer = proximos.length > LIMIT ? `\n\n… y ${proximos.length - LIMIT} más.` : "";
  await sendMessage(env, chatId, header + body + footer);
}

async function handleSearch(env, chatId, query) {
  const { entries: galleryEntries, generatedAt } = await getGalleryDataset(env);
  if (!generatedAt) {
    await sendMessage(env, chatId, "Todavía no tengo datos cargados (el bot acaba de desplegarse). Vuelve a intentarlo en unos minutos.");
    return;
  }

  const { matches, entries: found } = searchGallery(galleryEntries, query);

  if (matches.length === 0) {
    await sendMessage(
      env,
      chatId,
      `No encuentro ninguna distribución de «${escapeHtml(query)}» en mis datos. Cubro los Pokémon que se han repartido alguna vez por Mystery Gift — si crees que debería estar, avisa a quien mantiene el bot.`
    );
    return;
  }
  if (matches.length > 1) {
    await sendMessage(
      env,
      chatId,
      `Hay varias coincidencias, sé más concreto:\n${matches.map((m) => `• ${escapeHtml(m)}`).join("\n")}`
    );
    return;
  }

  const dexNumber = found[0]?.dexNumber ?? null;
  const speciesLabel = found[0]?.speciesEs || matches[0];

  const [{ entries: distEntries }, { entries: eventEntries }] = await Promise.all([
    getStatusDataset(env),
    getEventsDataset(env),
  ]);
  const activeDist = dexNumber != null ? findActiveDistributionsForDex(distEntries, dexNumber) : [];
  const activeEvents = dexNumber != null ? findActiveEventsForDex(eventEntries, dexNumber) : [];

  const keyboard = dexNumber != null ? historyKeyboard(dexNumber) : undefined;

  if (activeDist.length === 0 && activeEvents.length === 0) {
    const text = `<b>${escapeHtml(speciesLabel)}</b>\nNo hay ninguna distribución ni evento activo ahora mismo. ¿Quieres revisar las distribuciones anteriores de este Pokémon?`;
    await sendMessage(env, chatId, text, keyboard);
    return;
  }

  const parts = [`<b>${escapeHtml(speciesLabel)}</b> — activo ahora mismo`, ""];
  for (const e of activeDist) parts.push(formatStatusEntry(e), "");
  for (const e of activeEvents) parts.push(formatEventEntry(e), "");
  await sendMessage(env, chatId, parts.join("\n").trim(), keyboard);
}

async function handleHistoryCallback(env, chatId, messageId, dexNumber) {
  const { entries } = await getGalleryDataset(env);
  const speciesEntries = entries.filter((e) => e.dexNumber === dexNumber);
  const speciesLabel = speciesEntries[0]?.speciesEs || speciesEntries[0]?.species || `#${dexNumber}`;
  const text = formatHistoryByConsole(speciesLabel, speciesEntries);

  if (text.length <= 3800) {
    await editMessageText(env, chatId, messageId, text, null);
  } else {
    await editMessageReplyMarkup(env, chatId, messageId, null);
    await sendMessage(env, chatId, text);
  }
}

async function handleHome(env, chatId) {
  const days = daysUntilBankClosure();
  const countdown = days > 0 ? `Quedan <b>${days} días</b>.` : `Ya ha cerrado.`;
  const text = `<b>Pokémon Bank ⇢ Pokémon HOME</b>
Pokémon Bank deja de poder conectar con Pokémon HOME el <b>${BANK_CLOSURE_LABEL}</b>. ${countdown}

✅ <b>Conectan directo a HOME</b> (no dependen de Bank): Let's Go Pikachu/Eevee, Espada/Escudo, Diamante Brillante/Perla Reluciente, Leyendas Arceus, Escarlata/Púrpura, Legends: Z-A.

⚠️ <b>Dependen de Pokémon Bank</b> (y por tanto de esa fecha límite): todo lo de Generación 1 a 7 salvo Let's Go — Virtual Console, GBA (Rubí/Zafiro/Esmeralda/Rojo Fuego/Verde Hoja), DS (Diamante/Perla/Platino/Negro/Blanco) y 3DS (X/Y/ORAS/Sol/Luna/USUM).

⛔ <b>Sin ninguna ruta digital</b>: los repartos de la era de cartucho original de Gen 1-2 (antes de Virtual Console) — esos se quedaron atrapados hace años, no por este cierre.

Busca un Pokémon (p. ej. <code>mew</code>) y cada distribución te dirá su caso concreto.`;
  await sendMessage(env, chatId, text);
}

/** Fuerza una recarga inmediata de los 3 datasets desde GitHub (lo mismo
 * que hace el cron semanal), para no depender de esperar al cron ni de
 * llamar a /refresh por HTTP con curl/consola — solo tú puedes usarlo. */
async function handleRefresh(env, chatId) {
  const owner = env.OWNER_CHAT_ID;
  if (owner && String(chatId) !== String(owner)) {
    await sendMessage(env, chatId, "Este comando no está disponible.");
    return;
  }
  await sendMessage(env, chatId, "Recargando datos desde GitHub…");
  try {
    const results = await refreshData(env);
    const lines = ["Hecho. Entradas cargadas ahora mismo:"];
    lines.push(`• Distribuciones: ${results.status ?? "error al descargar"}`);
    lines.push(`• Galería (histórico): ${results.gallery ?? "error al descargar"}`);
    lines.push(`• Eventos in-game: ${results.events ?? "error al descargar"}`);
    await sendMessage(env, chatId, lines.join("\n"));
  } catch (err) {
    await sendMessage(env, chatId, `Ha fallado la recarga: ${err.message}`);
  }
}

async function handleFaltan(env, chatId) {
  const owner = env.OWNER_CHAT_ID;
  if (owner && String(chatId) !== String(owner)) {
    await sendMessage(env, chatId, "Este comando no está disponible.");
    return;
  }
  const repo = env.POKETRACKER_REPO;
  if (!repo) {
    await sendMessage(env, chatId, "El cruce con Poketracker no está configurado en este bot.");
    return;
  }
  const { entries, generatedAt } = await getGalleryDataset(env);
  if (!generatedAt) {
    await sendMessage(env, chatId, "Todavía no tengo el catálogo de distribuciones cargado. Vuelve a intentarlo en unos minutos.");
    return;
  }
  let data;
  try {
    data = await fetchPoketrackerData(repo);
  } catch (err) {
    await sendMessage(env, chatId, `No he podido leer el Poketracker ahora mismo: ${err.message}`);
    return;
  }
  const report = buildFaltanReport(data, entries);
  await sendMessage(env, chatId, formatFaltanReport(report));
}

async function handleAlertas(env, chatId, arg) {
  const value = (arg || "").trim().toLowerCase();
  if (value !== "on" && value !== "off") {
    const state = await getUserState(env, chatId);
    await sendMessage(
      env,
      chatId,
      `Usa <code>/alertas on</code> o <code>/alertas off</code>. Ahora mismo están <b>${
        state.alertsEnabled ? "activadas" : "desactivadas"
      }</b> para ti.`
    );
    return;
  }
  let state = await getUserState(env, chatId);
  state = setAlertsEnabled(state, value === "on");
  await saveUserState(env, chatId, state);
  await sendMessage(
    env,
    chatId,
    value === "on"
      ? "✅ Avisos activados. Te escribiré en cuanto detecte una distribución o evento nuevo, con botones para posponerlo, marcarlo hecho o silenciarlo."
      : "🔕 Avisos desactivados. Puedes reactivarlos cuando quieras con /alertas on."
  );
}

async function handleWondercard(env, chatId, id) {
  if (!id) {
    await sendMessage(env, chatId, "Dime el id de la distribución, por ejemplo: <code>/wondercard mew-gen4-hgss-random</code> (el id sale en el histórico).");
    return;
  }
  const { entries } = await getGalleryDataset(env);
  const entry = entries.find((e) => e.id === id.trim());
  if (!entry) {
    await sendMessage(env, chatId, `No encuentro ninguna distribución con el id «${escapeHtml(id)}». Búscala primero por nombre para ver su id exacto.`);
    return;
  }

  const url = EVENTSGALLERY_RAW_BASE + entry.representativeFile.split("/").map(encodeURIComponent).join("/");
  const res = await fetch(url);
  if (!res.ok) {
    await sendMessage(env, chatId, "No he podido descargar el archivo desde GitHub ahora mismo. Prueba de nuevo en un momento.");
    return;
  }
  const blob = await res.blob();
  const filename = entry.representativeFile.split("/").pop();
  const caption = `${entry.speciesEs || entry.species} — ${entry.game || entry.gameCode || "juego no identificado"}${entry.variantCount > 1 ? ` (1 de ${entry.variantCount} variantes)` : ""}`;
  await sendDocument(env, chatId, blob, filename, caption);
}

// --- callback_query (botones) ---

async function handleCallbackQuery(env, callbackQuery) {
  const chatId = callbackQuery.message?.chat?.id;
  const messageId = callbackQuery.message?.message_id;
  const data = callbackQuery.data || "";
  if (!chatId || !messageId) return;

  await ensureSubscribed(env, chatId);
  if (await isRateLimited(env, chatId)) {
    await answerCallbackQuery(env, callbackQuery.id);
    return;
  }

  const [action, ...rest] = data.split(":");

  if (action === "hi") {
    const dexNumber = Number(rest[0]);
    await answerCallbackQuery(env, callbackQuery.id);
    await handleHistoryCallback(env, chatId, messageId, dexNumber);
    return;
  }
  if (action === "cn") {
    await answerCallbackQuery(env, callbackQuery.id);
    await editMessageReplyMarkup(env, chatId, messageId, null);
    return;
  }

  const hash = rest[0];
  const idmap = await getIdMap(env);
  const key = idmap[hash];
  if (!key) {
    await answerCallbackQuery(env, callbackQuery.id, "Este botón ya ha caducado.");
    return;
  }
  const isEvent = key.startsWith("e:");
  const doneLabel = isEvent ? "Completado" : "Ya la tengo / canjeada";

  if (action === "sn") {
    await answerCallbackQuery(env, callbackQuery.id);
    await editMessageReplyMarkup(env, chatId, messageId, snoozeKeyboard(hash));
    return;
  }
  if (action === "bk") {
    await answerCallbackQuery(env, callbackQuery.id);
    await editMessageReplyMarkup(env, chatId, messageId, actionKeyboard(hash, doneLabel));
    return;
  }
  if (action === "sd") {
    const days = Number(rest[1]);
    let state = await getUserState(env, chatId);
    state = applyItemAction(state, key, "snooze", { days });
    await saveUserState(env, chatId, state);
    await answerCallbackQuery(env, callbackQuery.id, `Pospuesto ${days} día(s).`);
    await editMessageReplyMarkup(env, chatId, messageId, null);
    return;
  }
  if (action === "mu") {
    let state = await getUserState(env, chatId);
    state = applyItemAction(state, key, "mute");
    await saveUserState(env, chatId, state);
    await answerCallbackQuery(env, callbackQuery.id, "No volverás a ver avisos de esto.");
    await editMessageReplyMarkup(env, chatId, messageId, null);
    return;
  }
  if (action === "dn") {
    let state = await getUserState(env, chatId);
    state = applyItemAction(state, key, isEvent ? "complete" : "redeem");
    await saveUserState(env, chatId, state);
    await answerCallbackQuery(env, callbackQuery.id, isEvent ? "Marcado como completado." : "Marcada como canjeada.");
    await editMessageReplyMarkup(env, chatId, messageId, null);
    return;
  }

  await answerCallbackQuery(env, callbackQuery.id);
}

// --- Router principal ---

function parseCommand(text) {
  const trimmed = (text || "").trim();
  if (!trimmed.startsWith("/")) return null;
  const [cmdRaw, ...rest] = trimmed.split(/\s+/);
  const cmd = cmdRaw.slice(1).split("@")[0].toLowerCase();
  return { cmd, args: rest.join(" ") };
}

async function handleUpdate(env, update) {
  if (update.callback_query) {
    await handleCallbackQuery(env, update.callback_query);
    return;
  }

  const message = update.message || update.edited_message;
  if (!message || !message.text) return;
  const chatId = message.chat.id;
  const text = message.text;

  await ensureSubscribed(env, chatId);
  if (await isRateLimited(env, chatId)) return;

  const command = parseCommand(text);

  if (command) {
    switch (command.cmd) {
      case "start":
      case "ayuda":
      case "help":
        await sendMessage(env, chatId, buildHelpText(env, chatId));
        return;
      case "activas":
        await handleActivas(env, chatId);
        return;
      case "proximas":
      case "próximas":
        await handleProximas(env, chatId);
        return;
      case "eventosactivos":
        await handleEventosActivos(env, chatId);
        return;
      case "eventosproximos":
        await handleEventosProximos(env, chatId);
        return;
      case "alertas":
        await handleAlertas(env, chatId, command.args);
        return;
      case "wondercard":
        await handleWondercard(env, chatId, command.args);
        return;
      case "home":
        await handleHome(env, chatId);
        return;
      case "faltan":
        await handleFaltan(env, chatId);
        return;
      case "refresh":
        await handleRefresh(env, chatId);
        return;
      case "pokemon":
      case "pokémon":
        if (!command.args) {
          await sendMessage(env, chatId, "Dime qué Pokémon quieres consultar, por ejemplo: <code>/pokemon mew</code>");
          return;
        }
        await handleSearch(env, chatId, command.args);
        return;
      default:
        await sendMessage(env, chatId, "No conozco ese comando. Usa /ayuda para ver lo que sé hacer.");
        return;
    }
  }

  await handleSearch(env, chatId, text);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      const [status, gallery, events] = await Promise.all([
        getStatusDataset(env),
        getGalleryDataset(env),
        getEventsDataset(env),
      ]);
      return Response.json({
        ok: true,
        bot: env.BOT_NAME || "pokemon-distro-bot",
        status: { generatedAt: status.generatedAt, totalEntries: status.entries?.length ?? 0 },
        gallery: { generatedAt: gallery.generatedAt, totalEntries: gallery.entries?.length ?? 0 },
        events: { generatedAt: events.generatedAt, totalEntries: events.entries?.length ?? 0 },
      });
    }

    if (request.method === "POST" && url.pathname === "/refresh") {
      if (request.headers.get("X-Refresh-Secret") !== env.REFRESH_SECRET) {
        return new Response("Unauthorized", { status: 401 });
      }
      try {
        const results = await refreshData(env);
        return Response.json({ ok: true, ...results });
      } catch (err) {
        return Response.json({ ok: false, error: String(err) }, { status: 500 });
      }
    }

    if (request.method === "POST" && url.pathname === "/webhook") {
      if (
        env.WEBHOOK_SECRET &&
        request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET
      ) {
        return new Response("Unauthorized", { status: 401 });
      }
      const update = await request.json();
      ctx.waitUntil(
        handleUpdate(env, update).catch((err) => console.error("Error procesando update:", err))
      );
      return new Response("ok");
    }

    return new Response("pokemon-distro-bot: nada que ver aquí", { status: 404 });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(refreshData(env));
  },
};
