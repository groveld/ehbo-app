// Telefoonnummers: één vaste schrijfwijze (E.164, bijv. +31612345678) voor opslag en vergelijken.

/**
 * Maakt van wat iemand intypt een E.164-nummer, of null als het geen geldig nummer is.
 * Nederlands is de standaard: 06…, 6… (naast het vaste +31-voorvoegsel), 0031… en +31… worden gelijk.
 */
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  let digits = trimmed.replace(/[\s\-().]/g, '');
  if (digits.startsWith('00')) digits = `+${digits.slice(2)}`;
  if (digits.startsWith('+')) {
    if (!/^\+[1-9]\d{7,14}$/.test(digits)) return null;
    // +31 06… komt voor als iemand beide voorvoegsels typt.
    if (digits.startsWith('+310')) digits = `+31${digits.slice(4)}`;
    return /^\+31\d{9}$/.test(digits) || !digits.startsWith('+31') ? digits : null;
  }
  if (!/^\d+$/.test(digits)) return null;
  if (/^0[1-9]\d{8}$/.test(digits)) return `+31${digits.slice(1)}`;
  if (/^[1-9]\d{8}$/.test(digits)) return `+31${digits}`;
  return null;
}

/** Leesbare schrijfwijze: 06-12 34 56 78 voor mobiel, 010-123 45 67 voor vast; buitenlands blijft E.164. */
export function formatPhone(e164: string): string {
  if (!e164.startsWith('+31') || e164.length !== 12) return e164;
  const n = `0${e164.slice(3)}`;
  if (n.startsWith('06')) return `06-${n.slice(2, 4)} ${n.slice(4, 6)} ${n.slice(6, 8)} ${n.slice(8)}`;
  return `${n.slice(0, 3)}-${n.slice(3, 6)} ${n.slice(6, 8)} ${n.slice(8)}`;
}

/** Voor een tel:-link. */
export const telHref = (e164: string) => `tel:${e164}`;
