// Lokaal bewaren voor gebruik zonder bereik. localStorage kan ontbreken (privévenster); dan werkt alles nog, alleen niet offline.
export function load<T>(key: string): T | null {
  try {
    const value = localStorage.getItem(key);
    return value === null ? null : (JSON.parse(value) as T);
  } catch {
    return null;
  }
}

export function save(key: string, value: unknown) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Niet bewaard; de app werkt dan alleen met bereik.
  }
}
