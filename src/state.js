// Estado por usuario: preferencias de avisos y qué ha hecho cada persona con
// cada distribución/evento (silenciado, canjeado/completado, pospuesto).
// Cualquier usuario del bot tiene su propio estado — no es solo para el
// dueño del bot.

const SUBSCRIBERS_KEY = "subscribers";
const MAX_SNOOZE_DAYS = 7;

export function userStateKey(chatId) {
  return `sub:${chatId}`;
}

export function defaultUserState() {
  return { alertsEnabled: true, items: {} };
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/** ¿Este item no se le debe mostrar/avisar a este usuario ahora mismo?
 * (silenciado, marcado como canjeado/completado, o pospuesto hasta una
 * fecha futura). */
export function isSuppressed(state, itemId, today = todayIso()) {
  const item = state.items?.[itemId];
  if (!item) return false;
  if (item.muted || item.redeemed || item.completed) return true;
  if (item.snoozedUntil && item.snoozedUntil >= today) return true;
  return false;
}

/** Aplica una acción del usuario sobre un item concreto y devuelve el nuevo
 * estado (no muta el original). Acciones: "mute", "unmute", "redeem",
 * "complete", "unmark", "snooze" (con days, 1-7). */
export function applyItemAction(state, itemId, action, { days } = {}) {
  const items = { ...(state.items || {}) };
  const current = { ...(items[itemId] || {}) };

  switch (action) {
    case "mute":
      current.muted = true;
      break;
    case "unmute":
      delete current.muted;
      break;
    case "redeem":
      current.redeemed = true;
      break;
    case "complete":
      current.completed = true;
      break;
    case "unmark":
      delete current.redeemed;
      delete current.completed;
      delete current.muted;
      delete current.snoozedUntil;
      break;
    case "snooze": {
      const requested = Number.isFinite(days) ? days : MAX_SNOOZE_DAYS;
      const clamped = Math.max(1, Math.min(MAX_SNOOZE_DAYS, requested));
      const until = new Date(Date.now() + clamped * 86400000).toISOString().slice(0, 10);
      current.snoozedUntil = until;
      return { ...state, items: { ...items, [itemId]: current } };
    }
    default:
      return state;
  }

  items[itemId] = current;
  return { ...state, items };
}

export function setAlertsEnabled(state, enabled) {
  return { ...state, alertsEnabled: !!enabled };
}

export { MAX_SNOOZE_DAYS };

// --- Funciones que sí tocan KV (no puras, no se testean unitariamente) ---

export async function getUserState(env, chatId) {
  const raw = await env.DISTRO_KV.get(userStateKey(chatId));
  if (!raw) return defaultUserState();
  try {
    const parsed = JSON.parse(raw);
    return { ...defaultUserState(), ...parsed, items: parsed.items || {} };
  } catch {
    return defaultUserState();
  }
}

export async function saveUserState(env, chatId, state) {
  await env.DISTRO_KV.put(userStateKey(chatId), JSON.stringify(state));
}

export async function getSubscribers(env) {
  const raw = await env.DISTRO_KV.get(SUBSCRIBERS_KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/** Añade este chat_id a la lista de suscriptores si no estaba ya. No hace
 * ningún write a KV si ya estaba (para no gastar cuota en cada mensaje). */
export async function ensureSubscribed(env, chatId) {
  const subs = await getSubscribers(env);
  const key = String(chatId);
  if (subs.some((s) => String(s) === key)) return subs;
  const updated = [...subs, key];
  await env.DISTRO_KV.put(SUBSCRIBERS_KEY, JSON.stringify(updated));
  return updated;
}
