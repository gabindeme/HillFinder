import { describe, expect, it } from 'vitest';
import en from './locales/en.json';
import fr from './locales/fr.json';

/** Flattened keys, ignoring i18next plural suffixes (languages differ in plural forms). */
function keys(obj: object, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null ? keys(v, `${prefix}${k}.`) : [`${prefix}${k.replace(/_(zero|one|two|few|many|other)$/, '')}`],
  );
}

describe('translations', () => {
  it('French has exactly the same keys as English', () => {
    expect([...new Set(keys(fr))].sort()).toEqual([...new Set(keys(en))].sort());
  });

  it('keeps the same {{placeholders}} in every string', () => {
    const placeholders = (s: string) => [...s.matchAll(/{{(\w+)}}/g)].map((m) => m[1]).sort();
    const flat = (obj: object, prefix = ''): [string, string][] =>
      Object.entries(obj).flatMap(([k, v]) => (typeof v === 'object' ? flat(v, `${prefix}${k}.`) : [[`${prefix}${k}`, v as string]]));
    const frMap = new Map(flat(fr));
    for (const [key, value] of flat(en)) {
      const other = frMap.get(key);
      if (other !== undefined) expect(placeholders(other), key).toEqual(placeholders(value));
    }
  });
});
