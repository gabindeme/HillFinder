/**
 * Turns a soup of OSM ways into long continuous lines ("strokes").
 *
 * Why: OSM ways are cut arbitrarily (a street changes name, a bridge starts,
 * a mapper split it), so a single hill is often spread over several ways.
 * Conversely, one way may contain several climbs. We therefore:
 *   1. split every way at junctions into edges;
 *   2. at each node, pair up edge ends that continue each other most
 *      straightly (classic "natural road" stroke building);
 *   3. walk those pairings to chain edges into strokes.
 * Climbs are then detected along each stroke, in both directions.
 */
import { angleDiff, bearing, haversine } from './geo';
import type { LatLon, OsmWay } from './types';

/** Max deflection (degrees) allowed to continue a stroke through a junction. */
const MAX_DEFLECTION = 50;
/** Distance along an edge used to estimate its direction at an end. */
const BEARING_PROBE = 15;

export interface Edge {
  wayIndex: number;
  coords: LatLon[];
  nodeA: number;
  nodeB: number;
}

/** A piece of a stroke: an edge traversed forwards or backwards. */
export interface StrokePart {
  edge: number;
  reversed: boolean;
}

export function splitIntoEdges(ways: OsmWay[]): Edge[] {
  // A node is a split point when it is a way endpoint or shared by several ways.
  const usage = new Map<number, number>();
  for (const w of ways) {
    for (const n of w.nodes) usage.set(n, (usage.get(n) ?? 0) + 1);
  }
  const edges: Edge[] = [];
  ways.forEach((w, wayIndex) => {
    let start = 0;
    for (let i = 1; i < w.nodes.length; i++) {
      const isLast = i === w.nodes.length - 1;
      if (isLast || (usage.get(w.nodes[i]) ?? 0) > 1) {
        edges.push({
          wayIndex,
          coords: w.geometry.slice(start, i + 1),
          nodeA: w.nodes[start],
          nodeB: w.nodes[i],
        });
        start = i;
      }
    }
  });
  return edges;
}

/** Bearing pointing *away* from the node at the given end of the edge. */
function endBearing(edge: Edge, atB: boolean): number {
  const pts = atB ? [...edge.coords].reverse() : edge.coords;
  const origin = pts[0];
  let probe = pts[1];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    acc += haversine(pts[i - 1], pts[i]);
    probe = pts[i];
    if (acc >= BEARING_PROBE) break;
  }
  return bearing(origin, probe);
}

/** End key: edge index * 2 + (0 = A end, 1 = B end). */
const endKey = (edge: number, atB: boolean) => edge * 2 + (atB ? 1 : 0);

export function buildStrokes(edges: Edge[]): StrokePart[][] {
  // Group edge ends by node.
  const byNode = new Map<number, number[]>();
  edges.forEach((e, i) => {
    for (const [node, atB] of [[e.nodeA, false], [e.nodeB, true]] as const) {
      const list = byNode.get(node);
      if (list) list.push(endKey(i, atB));
      else byNode.set(node, [endKey(i, atB)]);
    }
  });

  const partner = new Int32Array(edges.length * 2).fill(-1);
  for (const ends of byNode.values()) {
    if (ends.length < 2) continue;
    if (ends.length === 2) {
      // Plain continuation (no junction): always chain, even through sharp bends.
      partner[ends[0]] = ends[1];
      partner[ends[1]] = ends[0];
      continue;
    }
    // Junction: greedily pair the straightest continuations. Two ends continue
    // each other straightly when their outgoing bearings are ~180° apart.
    const bearings = ends.map((k) => endBearing(edges[k >> 1], (k & 1) === 1));
    const pairs: [number, number, number][] = [];
    for (let i = 0; i < ends.length; i++) {
      for (let j = i + 1; j < ends.length; j++) {
        if (ends[i] >> 1 === ends[j] >> 1) continue; // don't pair a loop edge with itself
        const deflection = 180 - angleDiff(bearings[i], bearings[j]);
        if (deflection <= MAX_DEFLECTION) pairs.push([deflection, i, j]);
      }
    }
    pairs.sort((a, b) => a[0] - b[0]);
    const used = new Set<number>();
    for (const [, i, j] of pairs) {
      if (used.has(i) || used.has(j)) continue;
      used.add(i).add(j);
      partner[ends[i]] = ends[j];
      partner[ends[j]] = ends[i];
    }
  }

  const visited = new Uint8Array(edges.length);
  const strokes: StrokePart[][] = [];

  // Follow pairings from the given end until the line stops or loops.
  const walk = (fromEnd: number): StrokePart[] => {
    const parts: StrokePart[] = [];
    let next = partner[fromEnd];
    while (next !== -1) {
      const edge = next >> 1;
      if (visited[edge]) break;
      visited[edge] = 1;
      // Entering through the A end means traversing forwards.
      const enteredAtB = (next & 1) === 1;
      parts.push({ edge, reversed: enteredAtB });
      next = partner[endKey(edge, !enteredAtB)];
    }
    return parts;
  };

  for (let e = 0; e < edges.length; e++) {
    if (visited[e]) continue;
    visited[e] = 1;
    const forward = walk(endKey(e, true));
    const backward = walk(endKey(e, false))
      .reverse()
      .map((p) => ({ edge: p.edge, reversed: !p.reversed }));
    strokes.push([...backward, { edge: e, reversed: false }, ...forward]);
  }
  return strokes;
}
