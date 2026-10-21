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
/** Detaches the listener of the running search when a newer one starts. */
let detachPrevious: (() => void) | null = null;

export interface PartialOutcome {
  candidates: Climb[];
  resolution: number;
  nearbyKm: number;
}

interface Handlers {
  onProgress: (p: SearchProgress) => void;
  onPartial: (p: PartialOutcome) => void;
}

const getWorker = () =>
  (worker ??= new Worker(new URL('../worker/search.worker.ts', import.meta.url), { type: 'module' }));

/** Spin the worker up early (module load + parse) so the first search starts at once. */
export const warmUpSearch = () => void getWorker();

/**
 * Starts a search; it supersedes (and cancels) any running one. A superseded
 * search's promise never settles, so callers just await the latest.
 */
export function searchClimbs(
  origin: LatLon,
  radiusKm: number,
  source: DataSource,
  includeStairs: boolean,
  { onProgress, onPartial }: Handlers,
): Promise<SearchOutcome> {
  const w = getWorker();
  const id = nextId++;
  detachPrevious?.();
  return new Promise((resolve, reject) => {
    const onMessage = (e: MessageEvent<WorkerMessage>) => {
      const msg = e.data;
      if (msg.id !== id) return;
      if (msg.type === 'progress') onProgress(msg);
      else if (msg.type === 'partial') onPartial(msg);
      else {
        w.removeEventListener('message', onMessage);
        if (msg.type === 'result') resolve({ candidates: msg.candidates, resolution: msg.resolution, missingTiles: msg.missingTiles });
        else reject(new SearchError(msg.message, msg.code));
      }
    };
    w.addEventListener('message', onMessage);
    detachPrevious = () => w.removeEventListener('message', onMessage);
    w.postMessage({ id, origin, radiusKm, source, includeStairs });
  });
}
