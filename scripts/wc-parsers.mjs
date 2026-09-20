// Lectores binarios de wondercards / archivos de Pokémon de evento.
//
// Los offsets y la lógica de aquí están sacados directamente del código
// fuente de PKHeX (https://github.com/kwsch/PKHeX, licencia GPLv3),
// concretamente de PKHeX.Core/MysteryGifts/{WC6,WC7,WC8,WC9,PGF,PGT}.cs y
// PKHeX.Core/PKM/{PK3,PK4,PK5}.cs. No es un puerto completo de PKHeX: solo
// implementa lo mínimo para responder una pregunta muy concreta con
// garantías — "¿este archivo es shiny siempre / nunca / depende del
// entrenador?" — no para editar ni validar legalidad de Pokémon.
//
// Resultado de cada parser: { ok: true, shiny: "always"|"never"|"random",
// pid, id32 } o { ok: false, reason }.

function u16(buf, off) {
  return buf.readUInt16LE(off);
}
function u32(buf, off) {
  return buf.readUInt32LE(off);
}

/** Fórmula estándar de shiny por XOR, común a todos los formatos desde
 * Generación III en adelante: shiny si (TIDsup xor TIDinf xor PIDsup xor
 * PIDinf) está por debajo de un umbral que depende de la generación. */
function shinyXor(pid, id32) {
  const tid = id32 & 0xffff;
  const sid = (id32 >>> 16) & 0xffff;
  const pidLow = pid & 0xffff;
  const pidHigh = (pid >>> 16) & 0xffff;
  return (tid ^ sid ^ pidLow ^ pidHigh) >>> 0;
}

/** Gen 3-5: shiny si el xor < 8 (1/8192). Gen 6+: shiny si xor < 16 (1/4096,
 * con "square" en xor===0). Para nuestro propósito solo necesitamos
 * shiny/no-shiny, no distinguir square/star. */
function isShinyFromPidId(pid, id32, threshold) {
  if (id32 === 0) return false; // PID "anti-shiny" reservado (no hay dueño fijo)
  return shinyXor(pid, id32) < threshold;
}

// ---------------------------------------------------------------------
// Gen 6/7: WC6, WC6full(*), WC7, WC7full(*), WB7full — mismo layout base.
// PIDType en 0xA3 (0=FixedValue,1=Random,2=Always,3=Never); PID en 0xD4;
// ID32 (TID+SID) en 0x68.
// ---------------------------------------------------------------------
function parseWC6Like(buf) {
  if (buf.length < 0x108) return { ok: false, reason: "archivo demasiado corto para WC6/WC7" };
  const cardType = buf.readUInt8(0x51);
  if (cardType !== 0) return { ok: false, reason: "no es un regalo de Pokémon (objeto u otro tipo)" };
  const pidType = buf.readUInt8(0xa3);
  const pid = u32(buf, 0xd4);
  const id32 = u32(buf, 0x68);
  switch (pidType) {
    case 1: // Random
      return { ok: true, shiny: "random", pid, id32 };
    case 2: // Always shiny
      return { ok: true, shiny: "always", pid, id32 };
    case 3: // Never shiny
      return { ok: true, shiny: "never", pid, id32 };
    case 0: // FixedValue: el PID guardado ya determina el resultado
      return { ok: true, shiny: isShinyFromPidId(pid, id32, 16) ? "always" : "never", pid, id32 };
    default:
      return { ok: false, reason: `PIDType desconocido (${pidType})` };
  }
}

// ---------------------------------------------------------------------
// Gen 8/9: WC8, WA8, WB8, WC9, WA9 — mismo layout base (CardStart=0x0).
// PIDType: 0=Never,1=Random,2=AlwaysStar,3=AlwaysSquare,4=FixedValue.
// WC8/WA8/WB8: PID en 0x2C, ID32 en 0x20, PIDType en 0x248.
// WC9/WA9:     PID en 0x24, ID32 en 0x18, PIDType en 0x240.
// ---------------------------------------------------------------------
function parseWC8Like(buf) {
  if (buf.length < 0x260) return { ok: false, reason: "archivo demasiado corto para WC8" };
  const cardType = buf.readUInt8(0x11);
  if (cardType !== 1) return { ok: false, reason: "no es un regalo de Pokémon (objeto u otro tipo)" };
  const pidType = buf.readUInt8(0x248);
  const pid = u32(buf, 0x2c);
  const id32 = u32(buf, 0x20);
  return interpretGen89(pidType, pid, id32);
}

function parseWC9Like(buf) {
  if (buf.length < 0x260) return { ok: false, reason: "archivo demasiado corto para WC9" };
  const cardType = buf.readUInt8(0x11);
  if (cardType !== 1) return { ok: false, reason: "no es un regalo de Pokémon (objeto u otro tipo)" };
  const pidType = buf.readUInt8(0x240);
  const pid = u32(buf, 0x24);
  const id32 = u32(buf, 0x18);
  return interpretGen89(pidType, pid, id32);
}

function interpretGen89(pidType, pid, id32) {
  switch (pidType) {
    case 0:
      return { ok: true, shiny: "never", pid, id32 };
    case 1:
      return { ok: true, shiny: "random", pid, id32 };
    case 2:
    case 3:
      return { ok: true, shiny: "always", pid, id32 };
    case 4:
      return { ok: true, shiny: isShinyFromPidId(pid, id32, 16) ? "always" : "never", pid, id32 };
    default:
      return { ok: false, reason: `PIDType desconocido (${pidType})` };
  }
}

// ---------------------------------------------------------------------
// Gen 5: PGF. ID32 en 0x00, PID en 0x08, PIDType en 0x37
// (0=Never,1=Random,2=Always).
// ---------------------------------------------------------------------
function parsePGF(buf) {
  if (buf.length < 0xcc) return { ok: false, reason: "archivo demasiado corto para PGF" };
  const cardType = buf.readUInt8(0xb3);
  if (cardType !== 1) return { ok: false, reason: "no es un regalo de Pokémon (objeto u otro tipo)" };
  const pidType = buf.readUInt8(0x37);
  const pid = u32(buf, 0x08);
  const id32 = u32(buf, 0x00);
  switch (pidType) {
    case 0:
      return { ok: true, shiny: "never", pid, id32 };
    case 1:
      return { ok: true, shiny: "random", pid, id32 };
    case 2:
      return { ok: true, shiny: "always", pid, id32 };
    default:
      return { ok: false, reason: `PIDType desconocido (${pidType})` };
  }
}

// ---------------------------------------------------------------------
// Gen 4: PGT (y PCD, que es PGT + metadatos extra al final). El PGT
// contiene un PK4 "de fábrica" ya en claro en el offset 0x08: PID en
// +0x00, TID16/SID16 en +0x0C/+0x0E respecto al PK4 embebido, es decir
// PID en 0x08 y el ID32 combinado en 0x14 dentro del PGT.
// El propio wondercard puede llevar la pareja PID/TID ya emparejada para
// forzar el resultado (igual que en generaciones posteriores), así que
// basta con aplicar la fórmula estándar (umbral 8, Gen 3-5).
// ---------------------------------------------------------------------
// GiftType4 (PGT.cs): None=0, Pokémon=1, PokémonEgg=2, Item=3, Rule=4,
// Goods=5, HasSubType=6, ManaphyEgg=7, MemberCard=8, ..., PokémonMovie=13.
const PGT_ENTITY_TYPES = new Set([1, 2, 7, 13]);

function parsePGT(buf) {
  if (buf.length < 0x104) return { ok: false, reason: "archivo demasiado corto para PGT" };
  const giftType = u16(buf, 0x00);
  if (!PGT_ENTITY_TYPES.has(giftType)) {
    return { ok: false, reason: "no es un regalo de Pokémon (objeto u otro tipo)" };
  }
  if (giftType === 7) {
    return { ok: true, shiny: "random", pid: 0, id32: 0 }; // huevo Manaphy: el PID se genera al eclosionar
  }
  const pid = u32(buf, 0x08);
  const id32 = u32(buf, 0x14);
  if (pid === 0 || pid === 1) {
    // Sin PID fijado en la plantilla: el juego genera uno normal al
    // entregar el regalo (probabilidad estándar, ni forzado shiny ni
    // bloqueado).
    return { ok: true, shiny: "random", pid, id32 };
  }
  return { ok: true, shiny: isShinyFromPidId(pid, id32, 8) ? "always" : "never", pid, id32 };
}

function parsePCD(buf) {
  // PCD = PGT (0x104 bytes) + metadatos; el PGT va al principio.
  return parsePGT(buf);
}

// ---------------------------------------------------------------------
// Gen 3/4/5: archivos "pk3"/"pk4"/"pk5" — un Pokémon concreto ya generado,
// con su PID y su TID/SID horneados. Formato en claro (no cifrado) tal
// como lo usa PKHeX para archivos sueltos en disco.
// ---------------------------------------------------------------------
function parsePK3(buf) {
  if (buf.length < 80) return { ok: false, reason: "archivo demasiado corto para PK3" };
  const pid = u32(buf, 0x00);
  const tid = u16(buf, 0x04);
  const sid = u16(buf, 0x06);
  const id32 = (sid << 16) | tid;
  return { ok: true, shiny: isShinyFromPidId(pid, id32, 8) ? "always" : "never", pid, id32 };
}

function parsePK4(buf) {
  if (buf.length < 136) return { ok: false, reason: "archivo demasiado corto para PK4" };
  const pid = u32(buf, 0x00);
  const tid = u16(buf, 0x0c);
  const sid = u16(buf, 0x0e);
  const id32 = (sid << 16) | tid;
  return { ok: true, shiny: isShinyFromPidId(pid, id32, 8) ? "always" : "never", pid, id32 };
}

function parsePK5(buf) {
  if (buf.length < 136) return { ok: false, reason: "archivo demasiado corto para PK5" };
  const pid = u32(buf, 0x00);
  const tid = u16(buf, 0x0c);
  const sid = u16(buf, 0x0e);
  const id32 = (sid << 16) | tid;
  return { ok: true, shiny: isShinyFromPidId(pid, id32, 8) ? "always" : "never", pid, id32 };
}

const PARSERS_BY_EXT = {
  wc6: parseWC6Like,
  wc6full: parseWC6Like,
  wc7: parseWC6Like,
  wc7full: parseWC6Like,
  wb7full: parseWC6Like,
  wc8: parseWC8Like,
  wa8: parseWC8Like,
  wb8: parseWC8Like,
  wc9: parseWC9Like,
  wa9: parseWC9Like,
  pgf: parsePGF,
  pgt: parsePGT,
  pcd: parsePCD,
  wc4: parsePGT, // EventsGallery convierte los PCD/PGT de Gen4 a ".wc4" con el mismo layout de PGT
  pk3: parsePK3,
  pk4: parsePK4,
  pk5: parsePK5,
};

/** Devuelve { ok, shiny: 'always'|'never'|'random', pid, id32 } o
 * { ok:false, reason } si el formato no se reconoce o el archivo no
 * cuadra con lo esperado. Nunca lanza. */
export function detectShiny(buf, ext) {
  const parser = PARSERS_BY_EXT[ext.toLowerCase()];
  if (!parser) return { ok: false, reason: `formato .${ext} no soportado por el verificador binario` };
  try {
    return parser(buf);
  } catch (err) {
    return { ok: false, reason: `error leyendo el binario: ${err.message}` };
  }
}

export const SUPPORTED_BINARY_EXTENSIONS = Object.keys(PARSERS_BY_EXT);
