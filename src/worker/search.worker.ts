/// <reference lib="webworker" />
/**
 * Runs the heavy part of a search (downloads + climb detection) off the main
 * thread, so the UI stays responsive on phones.
 */
import { bboxAround } from '../core/geo';
import { findCandidates } from '../core/pipeline';
import { loadElevation } from '../data/ignElevation';
import { fetchWays, OverpassBusyError } from '../data/overpass';
import type { SearchRequest, WorkerMessage } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

/** Paths are fetched a bit beyond the radius so climbs starting near the edge aren't cut. */
const PATH_MARGIN = 500;
/** …and elevation a bit further, since climbs can run outward from the edge. */
const ELEVATION_MARGIN = 1500;

const post = (msg: WorkerMessage) => self.postMessage(msg);

self.onmessage = async (e: MessageEvent<SearchRequest>) => {
  const { id, origin, radiusKm } = e.data;
  const radius = radiusKm * 1000;
  try {
    // Paths and elevation are independent: download both at once, reporting
    // combined progress (each elevation tile is one step, the paths one more).
    let tiles = { done: 0, total: 1 };
    let pathsDone = 0;
    const report = () =>
      post({ type: 'progress', id, stage: 'download', done: tiles.done + pathsDone, total: tiles.total + 1 });
    report();
    const [ways, grid] = await Promise.all([
      fetchWays(origin, radius + PATH_MARGIN).then((w) => {
        pathsDone = 1;
        report();
        return w;
      }),
      loadElevation(bboxAround(origin, radius + ELEVATION_MARGIN), (done, total) => {
        tiles = { done, total };
        report();
      }),
    ]);
    const candidates = findCandidates(ways, grid.sampler, origin, radius, (done, total) =>
      post({ type: 'progress', id, stage: 'analysis', done, total }),
    );
    post({ type: 'result', id, candidates, resolution: grid.resolution, missingTiles: grid.missingTiles });
  } catch (err) {
    const code = err instanceof OverpassBusyError ? 'busy' : undefined;
    post({ type: 'error', id, code, message: err instanceof Error ? err.message : String(err) });
  }
};
