/** Remembering user preferences in localStorage. */
import { useEffect, useState } from 'react';
import { DEFAULT_FILTERS, type Filters } from '../core/filters';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as T;
    // Merge so new filter fields added in later versions get their defaults.
    return typeof fallback === 'object' && fallback !== null ? { ...fallback, ...parsed } : parsed;
  } catch {
    return fallback;
  }
}

export function useStored<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => read(key, fallback));
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage full or disabled: preferences just won't persist.
    }
  }, [key, value]);
  return [value, setValue] as const;
}

export const useFilters = () => useStored<Filters>('hillfinder.filters', DEFAULT_FILTERS);
