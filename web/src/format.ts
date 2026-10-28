/** "donderdag 31 december 2026" uit "2026-12-31". */
export function formatDate(iso: string | null | undefined) {
  if (!iso) return '';
  return new Date(`${iso}T12:00:00`).toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
