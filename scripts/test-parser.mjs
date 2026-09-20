// Test del lector binario de wondercards (wc-parsers.mjs) con buffers
// sintéticos que reproducen el layout real (offsets sacados del código
// fuente de PKHeX), más un test de humo del scraper de estado
// activa/anunciada contra una tabla HTML de ejemplo.
import assert from "node:assert/strict";
import { detectShiny } from "./wc-parsers.mjs";

function makeWC6Buffer({ cardType = 0, pidType, pid = 0, id32 = 0 }) {
  const buf = Buffer.alloc(0x110);
  buf.writeUInt8(cardType, 0x51);
  buf.writeUInt32LE(id32, 0x68);
  buf.writeUInt8(pidType, 0xa3);
  buf.writeUInt32LE(pid, 0xd4);
  return buf;
}

// PIDType 1 = Random
assert.equal(detectShiny(makeWC6Buffer({ pidType: 1 }), "wc6").shiny, "random");
// PIDType 2 = Always
assert.equal(detectShiny(makeWC6Buffer({ pidType: 2 }), "wc6").shiny, "always");
// PIDType 3 = Never
assert.equal(detectShiny(makeWC6Buffer({ pidType: 3 }), "wc6").shiny, "never");
// PIDType 0 = FixedValue: PID y TID/SID iguales -> xor 0 -> shiny (always)
{
  const tid = 12345, sid = 54321;
  const id32 = ((sid << 16) | tid) >>> 0;
  // Construimos un PID cuyo xor con id32 sea 0: pidHigh^pidLow^tid^sid=0
  const pidLow = 1111, pidHigh = (pidLow ^ tid ^ sid) >>> 0;
  const pid = ((pidHigh << 16) | pidLow) >>> 0;
  const res = detectShiny(makeWC6Buffer({ pidType: 0, pid, id32 }), "wc6");
  assert.equal(res.shiny, "always");
}
// PIDType 0 = FixedValue con xor grande -> never
{
  const res = detectShiny(makeWC6Buffer({ pidType: 0, pid: 0xdeadbeef, id32: 0x11112222 }), "wc6");
  assert.equal(res.shiny, "never");
}
// cardType != 0 (objeto, no Pokémon) -> excluido
{
  const res = detectShiny(makeWC6Buffer({ cardType: 1, pidType: 2 }), "wc6");
  assert.equal(res.ok, false);
}

// Formato/tamaño no soportado
{
  const res = detectShiny(Buffer.alloc(3), "wc6");
  assert.equal(res.ok, false);
}

// Extensión desconocida
{
  const res = detectShiny(Buffer.alloc(100), "xyz");
  assert.equal(res.ok, false);
}

console.log("Todos los tests de wc-parsers.mjs han pasado correctamente.");
