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

/** Korte nummers (112, 144) en 0800/0900-nummers hebben geen bruikbare internationale vorm. */
const SHORT = /^[1-9]\d{2,4}$/;
const SERVICE = /^0(800|900|906|909)\d{4,7}$/;

/** Als normalizePhone, maar een noodnummer mag ook kort of een 0800/0900-nummer zijn; die blijven alleen cijfers. */
export function normalizeEmergencyNumber(input: string): string | null {
  const digits = input.trim().replace(/[\s\-().]/g, '');
  if (SHORT.test(digits) || SERVICE.test(digits)) return digits;
  return normalizePhone(input);
}

// Nederlandse netnummers van twee cijfers (zonder de 0); de rest heeft er drie.
const NL_AREA_2 = new Set(['10', '13', '15', '20', '23', '24', '26', '30', '33', '35', '36', '38', '40', '43', '45', '46', '50', '53', '55', '58', '70', '71', '72', '73', '74', '75', '76', '77', '78', '79', '84', '85', '87', '88', '91']);
// Landcodes van één of twee cijfers; de rest heeft er drie.
const COUNTRY_1 = new Set(['1', '7']);
const COUNTRY_2 = new Set(['20', '27', '30', '31', '32', '33', '34', '36', '39', '40', '41', '43', '44', '45', '46', '47', '48', '49', '51', '52', '53', '54', '55', '56', '57', '58', '60', '61', '62', '63', '64', '65', '66', '81', '82', '84', '86', '90', '91', '92', '93', '94', '95', '98']);

/** In paren, met een groep van drie vooraan als het aantal oneven is: 470 12 34 56. */
const pairs = (digits: string) => (digits.length % 2 ? [digits.slice(0, 3), ...(digits.slice(3).match(/\d\d/g) ?? [])] : digits.match(/\d\d/g)!).join(' ');

/**
 * Leesbare schrijfwijze, altijd met landcode en zonder (0): +31 6 12 34 56 78, +31 58 123 45 67, +32 470 12 34 56.
 * Korte nummers blijven zoals ze zijn; 0800/0900-nummers worden 0900 8844.
 */
export function formatPhone(number: string): string {
  if (!number.startsWith('+')) return SERVICE.test(number) ? `${number.slice(0, 4)} ${number.slice(4)}` : number;
  const digits = number.slice(1);
  if (/^31\d{9}$/.test(digits)) {
    const n = digits.slice(2);
    if (n.startsWith('6')) return `+31 6 ${pairs(n.slice(1))}`;
    const area = NL_AREA_2.has(n.slice(0, 2)) ? n.slice(0, 2) : n.slice(0, 3);
    return `+31 ${area} ${pairs(n.slice(area.length))}`;
  }
  const cc = COUNTRY_1.has(digits[0]!) ? digits.slice(0, 1) : COUNTRY_2.has(digits.slice(0, 2)) ? digits.slice(0, 2) : digits.slice(0, 3);
  const rest = digits.slice(cc.length);
  return rest.length > 4 ? `+${cc} ${pairs(rest)}` : number;
}

/** Voor een tel:-link. */
export const telHref = (number: string) => `tel:${number}`;
