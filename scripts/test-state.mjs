import assert from "node:assert/strict";
import { defaultUserState, isSuppressed, applyItemAction, setAlertsEnabled, MAX_SNOOZE_DAYS } from "../src/state.js";

const base = defaultUserState();
assert.equal(base.alertsEnabled, true);
assert.deepEqual(base.items, {});

// --- silenciar ---
let s = applyItemAction(base, "mew-gen4", "mute");
assert.equal(isSuppressed(s, "mew-gen4"), true);
assert.equal(isSuppressed(s, "otro-id"), false); // no afecta a otros items
s = applyItemAction(s, "mew-gen4", "unmute");
assert.equal(isSuppressed(s, "mew-gen4"), false);

// --- canjeada / completado ---
s = applyItemAction(base, "jirachi-gen3", "redeem");
assert.equal(isSuppressed(s, "jirachi-gen3"), true);
s = applyItemAction(base, "raid-finale", "complete");
assert.equal(isSuppressed(s, "raid-finale"), true);

// --- posponer, con tope de 7 días ---
s = applyItemAction(base, "mew-gen4", "snooze", { days: 3 });
assert.equal(isSuppressed(s, "mew-gen4", "2024-01-01"), true); // pospuesto, día 1
// calculamos la fecha esperada relativa a hoy (la función usa Date.now())
const expected3 = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
assert.equal(s.items["mew-gen4"].snoozedUntil, expected3);

// Pedir más de 7 días se recorta a 7
s = applyItemAction(base, "mew-gen4", "snooze", { days: 30 });
const expected7 = new Date(Date.now() + MAX_SNOOZE_DAYS * 86400000).toISOString().slice(0, 10);
assert.equal(s.items["mew-gen4"].snoozedUntil, expected7);

// Pedir 0 o negativo se sube a 1
s = applyItemAction(base, "mew-gen4", "snooze", { days: 0 });
const expected1 = new Date(Date.now() + 1 * 86400000).toISOString().slice(0, 10);
assert.equal(s.items["mew-gen4"].snoozedUntil, expected1);

// --- quitar marca ---
s = applyItemAction(base, "mew-gen4", "redeem");
s = applyItemAction(s, "mew-gen4", "unmark");
assert.equal(isSuppressed(s, "mew-gen4"), false);

// --- inmutabilidad: el estado original no cambia ---
const original = defaultUserState();
const afterMute = applyItemAction(original, "x", "mute");
assert.deepEqual(original.items, {});
assert.notDeepEqual(original, afterMute);

// --- alertas on/off ---
const disabled = setAlertsEnabled(base, false);
assert.equal(disabled.alertsEnabled, false);
assert.equal(base.alertsEnabled, true); // no muta el original

console.log("Todos los tests de state.js han pasado correctamente.");
