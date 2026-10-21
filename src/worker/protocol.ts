/** Messages exchanged with the search worker. */
import type { Climb, LatLon } from '../core/types';

export interface SearchRequest {
  id: number;
  origin: LatLon;
  radiusKm: number;
}

export type SearchStage = 'download' | 'analysis';

export type WorkerMessage =
  /** For 'download', done/total count elevation tiles plus one step for the paths. */
  | { type: 'progress'; id: number; stage: SearchStage; done: number; total: number }
  | { type: 'result'; id: number; candidates: Climb[]; resolution: number; missingTiles: number }
  | { type: 'error'; id: number; message: string; code?: 'busy' };
