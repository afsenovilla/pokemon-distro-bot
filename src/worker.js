import {
  computeStatus,
  formatStatusEntry,
  formatGalleryEntry,
  searchGallery,
  escapeHtml,
  daysUntilBankClosure,
  BANK_CLOSURE_LABEL,
} from "./lib.js";
import { fetchPoketrackerData, buildFaltanReport, formatFaltanReport } from "./poketracker.js";

const KV_KEY_STATUS = "distributions"; // data/distributions.json (activas/anunciadas, juego actual)
const KV_KEY_GALLERY = "eventsgallery"; // data/eventsgallery.json (historial completo + shiny verificado)

const EVENTSGALLERY_RAW_BASE = "https://raw.githubusercontent.com/projectpokemon/EventsGallery/master/";

const HELP_TEXT = `<b>Pokémon Distribuciones Bot</b>
Te digo en qué juegos se ha distribuido un Pokémon a lo largo de TODA la historia de Mystery Gift, si era shiny (comprobado leyendo la wondercard real, no adivinado), y te dejo descargarte esa wondercard. También sé qué distribuciones del juego actual están activas o anunciadas.

<b>Comandos</b>
• Escribe el nombre de un Pokémon (o usa /pokemon nombre) — p. ej. <code>mew</code> (cada resultado indica si puede llegar a Pokémon HOME o si depende de Pokémon Bank)
• /wondercard &lt;id&gt; — descarga el archivo real de una distribución (el id sale debajo de cada resultado)
• /home — recordatorio del cierre de Pokémon Bank y qué juegos se ven afectados
• /activas — distribuciones del juego actual activas ahora
• /proximas — distribuciones del juego actual anunciadas que aún no han empezado
• /faltan — cruce con la Living Dex de Poketracker: qué se queda atrapado si no se mueve a HOME a tiempo, y qué shiny garantizados faltan por conseguir
• /ayuda — este mensaje

Fuente del historial: <a href="https://github.com/projectpokemon/EventsGallery">projectpokemon/EventsGallery</a> (el mismo archivo que usa PKHeX para legalidad), actualizado cada semana.`;

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

function sendMessage(env, chatId, text) {
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
    chunks.map((chunk) =>
      telegramApi(env, "sendMessage", {
        chat_id: chatId,
        text: chunk,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      })
    )
  );
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

async function getStatusDataset(env) {
  const raw = await env.DISTRO_KV.get(KV_KEY_STATUS);
  if (!raw) return { generatedAt: null, entries: [] };
  try {
    return JSON.parse(raw);
  } catch {
    return { generatedAt: null, entries: [] };
  }
}

async function getGalleryDataset(env) {
  const raw = await env.DISTRO_KV.get(KV_KEY_GALLERY);
  if (!raw) return { generatedAt: null, entries: [] };
  try {
    return JSON.parse(raw);
  } catch {
    return { generatedAt: null, entries: [] };
  }
}

async function refreshData(env) {
  const [statusRes, galleryRes] = await Promise.all([
    fetch(env.GITHUB_DATA_URL, { headers: { "cache-control": "no-cache" } }),
    fetch(env.GITHUB_GALLERY_URL, { headers: { "cache-control": "no-cache" } }),
  ]);
  const results = {};
  if (statusRes.ok) {
    const json = await statusRes.json();
    await env.DISTRO_KV.put(KV_KEY_STATUS, JSON.stringify(json));
    results.status = json.entries?.length ?? 0;
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
  return results;
}

async function isRateLimited(env, chatId) {
  const key = `rl:${chatId}`;
  const current = await env.DISTRO_KV.get(key);
  const count = current ? Number(current) : 0;
  if (count >= 8) return true;
  await env.DISTRO_KV.put(key, String(count + 1), { expirationTtl: 60 });
  return false;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

async function handleActivas(env, chatId) {
  const { entries } = await getStatusDataset(env);
  const activas = entries
    .filter((e) => computeStatus(e, todayIso()) === "activa")
    .sort((a, b) => (a.dateEnd || "9999").localeCompare(b.dateEnd || "9999"));

  if (activas.length === 0) {
    await sendMessage(
      env,
      chatId,
      "No tengo ninguna distribución del juego actual marcada como activa ahora mismo. Prueba con /proximas."
    );
    return;
  }

  const LIMIT = 15;
  const shown = activas.slice(0, LIMIT);
  const body = shown.map((e) => formatStatusEntry(e, { showSpecies: true })).join("\n\n");
  const header = `<b>Distribuciones activas ahora (${activas.length})</b>\n\n`;
  const footer =
    activas.length > LIMIT ? `\n\n… y ${activas.length - LIMIT} más.` : "";
  await sendMessage(env, chatId, header + body + footer);
}

async function handleProximas(env, chatId) {
  const { entries } = await getStatusDataset(env);
  const proximas = entries
    .filter((e) => computeStatus(e, todayIso()) === "anunciada")
    .sort((a, b) => (a.dateStart || "9999").localeCompare(b.dateStart || "9999"));

  if (proximas.length === 0) {
    await sendMessage(
      env,
      chatId,
      "No tengo ninguna distribución del juego actual anunciada todavía sin empezar. Prueba con /activas."
    );
    return;
  }

  const LIMIT = 15;
  const shown = proximas.slice(0, LIMIT);
  const body = shown.map((e) => formatStatusEntry(e, { showSpecies: true })).join("\n\n");
  const header = `<b>Distribuciones anunciadas (${proximas.length})</b>\n\n`;
  const footer = proximas.length > LIMIT ? `\n\n… y ${proximas.length - LIMIT} más.` : "";
  await sendMessage(env, chatId, header + body + footer);
}

async function handleSearch(env, chatId, query) {
  const { entries, generatedAt } = await getGalleryDataset(env);
  if (!generatedAt) {
    await sendMessage(
      env,
      chatId,
      "Todavía no tengo datos cargados (el bot acaba de desplegarse). Vuelve a intentarlo en unos minutos."
    );
    return;
  }

  const { matches, entries: found } = searchGallery(entries, query);

  if (matches.length === 0) {
    await sendMessage(
      env,
      chatId,
      `No encuentro ninguna distribución de «${escapeHtml(
        query
      )}» en mis datos. Cubro los Pokémon que se han repartido alguna vez por Mystery Gift — si crees que debería estar, avisa a quien mantiene el bot.`
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

  const sorted = [...found].sort((a, b) => (b.generation ?? 0) - (a.generation ?? 0));
  const LIMIT = 12;
  const shown = sorted.slice(0, LIMIT);
  const header = `<b>${escapeHtml(sorted[0]?.speciesEs || matches[0])}</b> — ${sorted.length} distribución(es) encontradas\n\n`;
  const body = shown.map((e) => formatGalleryEntry(e)).join("\n\n");
  const footer = sorted.length > LIMIT ? `\n\n… y ${sorted.length - LIMIT} más (sé más concreto o pide directamente el id si ya lo conoces).` : "";
  await sendMessage(env, chatId, header + body + footer);
}

async function handleHome(env, chatId) {
  const days = daysUntilBankClosure();
  const countdown =
    days > 0
      ? `Quedan <b>${days} días</b>.`
      : `Ya ha cerrado.`;
  const text = `<b>Pokémon Bank ⇢ Pokémon HOME</b>
Pokémon Bank deja de poder conectar con Pokémon HOME el <b>${BANK_CLOSURE_LABEL}</b>. ${countdown}

✅ <b>Conectan directo a HOME</b> (no dependen de Bank): Let's Go Pikachu/Eevee, Espada/Escudo, Diamante Brillante/Perla Reluciente, Leyendas Arceus, Escarlata/Púrpura, Legends: Z-A.

⚠️ <b>Dependen de Pokémon Bank</b> (y por tanto de esa fecha límite): todo lo de Generación 1 a 7 salvo Let's Go — Virtual Console, GBA (Rubí/Zafiro/Esmeralda/Rojo Fuego/Verde Hoja), DS (Diamante/Perla/Platino/Negro/Blanco) y 3DS (X/Y/ORAS/Sol/Luna/USUM).

⛔ <b>Sin ninguna ruta digital</b>: los repartos de la era de cartucho original de Gen 1-2 (antes de Virtual Console) — esos se quedaron atrapados hace años, no por este cierre.

Busca un Pokémon (p. ej. <code>mew</code>) y cada distribución te dirá su caso concreto.`;
  await sendMessage(env, chatId, text);
}

async function handleFaltan(env, chatId) {
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

async function handleWondercard(env, chatId, id) {
  if (!id) {
    await sendMessage(env, chatId, "Dime el id de la distribución, por ejemplo: <code>/wondercard mew-gen4-hgss-random</code> (el id sale debajo de cada resultado de búsqueda).");
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

function parseCommand(text) {
  const trimmed = (text || "").trim();
  if (!trimmed.startsWith("/")) return null;
  const [cmdRaw, ...rest] = trimmed.split(/\s+/);
  const cmd = cmdRaw.slice(1).split("@")[0].toLowerCase();
  return { cmd, args: rest.join(" ") };
}

async function handleUpdate(env, update) {
  const message = update.message || update.edited_message;
  if (!message || !message.text) return;
  const chatId = message.chat.id;
  const text = message.text;

  if (await isRateLimited(env, chatId)) return;

  const command = parseCommand(text);

  if (command) {
    switch (command.cmd) {
      case "start":
      case "ayuda":
      case "help":
        await sendMessage(env, chatId, HELP_TEXT);
        return;
      case "activas":
        await handleActivas(env, chatId);
        return;
      case "proximas":
      case "próximas":
        await handleProximas(env, chatId);
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
      const [status, gallery] = await Promise.all([getStatusDataset(env), getGalleryDataset(env)]);
      return Response.json({
        ok: true,
        bot: env.BOT_NAME || "pokemon-distro-bot",
        status: { generatedAt: status.generatedAt, totalEntries: status.entries?.length ?? 0 },
        gallery: { generatedAt: gallery.generatedAt, totalEntries: gallery.entries?.length ?? 0 },
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
