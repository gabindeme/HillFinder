/** Promise-based wrapper around the search worker. */
import type { Climb, LatLon } from '../core/types';
import type { DataSource, SearchStage, WorkerMessage } from '../worker/protocol';

export interface SearchProgress {
  stage: SearchStage;
  done: number;
  total: number;
}

export interface SearchOutcome {
  candidates: Climb[];
  resolution: number;
  missingTiles: number;
}

export class SearchError extends Error {
  readonly code?: 'busy';
  constructor(message: string, code?: 'busy') {
    super(message);
    this.code = code;
  }
}

let worker: Worker | null = null;
let nextId = 1;

/** Starts a search. Callers should ignore results of searches they've superseded. */
export function searchClimbs(
  origin: LatLon,
  radiusKm: number,
  source: DataSource,
  onProgress: (p: SearchProgress) => void,
): Promise<SearchOutcome> {
  worker ??= new Worker(new URL('../worker/search.worker.ts', import.meta.url), { type: 'module' });
  const id = nextId++;
  const w = worker;
  return new Promise((resolve, reject) => {
    const onMessage = (e: MessageEvent<WorkerMessage>) => {
      const msg = e.data;
      if (msg.id !== id) return;
      if (msg.type === 'progress') onProgress(msg);
      else {
        w.removeEventListener('message', onMessage);
        if (msg.type === 'result') resolve({ candidates: msg.candidates, resolution: msg.resolution, missingTiles: msg.missingTiles });
        else reject(new SearchError(msg.message, msg.code));
      }
    };
    w.addEventListener('message', onMessage);
    w.postMessage({ id, origin, radiusKm, source });
  });
}
