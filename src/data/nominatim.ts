/**
 * Address search with Nominatim (OpenStreetMap).
 *
 * Usage policy (https://operations.osmfoundation.org/policies/nominatim/):
 * at most 1 request per second, no autocomplete-as-you-type, cache results,
 * identify the app. A web page can't set User-Agent; the browser's Referer
 * identifies us instead. Searches are triggered on submit only.
 */
import type { LatLon } from '../core/types';
import { cacheGet, cacheSet, DAY } from './cache';

const URL_BASE = 'https://nominatim.openstreetmap.org/search';
const MIN_INTERVAL = 1100;
let lastCall = 0;

export interface Place extends LatLon {
  label: string;
}

export async function geocode(q: string, lang = 'en'): Promise<Place[]> {
  const query = q.trim();
  if (!query) return [];
  const key = `geo:${lang}:${query.toLowerCase()}`;
  const cached = await cacheGet<Place[]>(key, 30 * DAY);
  if (cached) return cached;

  const wait = lastCall + MIN_INTERVAL - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();

  const params = new URLSearchParams({ q: query, format: 'jsonv2', limit: '5', 'accept-language': lang });
  const res = await fetch(`${URL_BASE}?${params}`);
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const json = (await res.json()) as { lat: string; lon: string; display_name: string }[];
  const places = json.map((r) => ({ lat: Number(r.lat), lon: Number(r.lon), label: r.display_name }));
  await cacheSet(key, places);
  return places;
}
