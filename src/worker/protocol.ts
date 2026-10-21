/** Messages exchanged with the search worker. */
import type { Climb, LatLon } from '../core/types';

/**
 * Where paths come from: 'fast' = OpenFreeMap vector tiles (CDN, seconds, no
 * lighting info); 'detailed' = Overpass API (slower, full OSM tags incl. `lit`).
 */
export type DataSource = 'fast' | 'detailed';

export interface SearchRequest {
  id: number;
  origin: LatLon;
  radiusKm: number;
  source: DataSource;
}

/** 'nearby' = quick first pass around the origin; then 'download' and 'analysis' for the full area. */
export type SearchStage = 'nearby' | 'download' | 'analysis';

export type WorkerMessage =
  /** For 'download', done/total count elevation tiles plus path tiles (or one step for Overpass). */
  | { type: 'progress'; id: number; stage: SearchStage; done: number; total: number }
  /** Climbs within `nearbyKm`, posted before the full search finishes. */
  | { type: 'partial'; id: number; candidates: Climb[]; resolution: number; nearbyKm: number }
  | { type: 'result'; id: number; candidates: Climb[]; resolution: number; missingTiles: number }
  | { type: 'error'; id: number; message: string; code?: 'busy' };
