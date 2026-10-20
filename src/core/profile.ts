/**
 * Builds evenly-sampled elevation profiles along strokes.
 */
import { haversine } from './geo';
import type { Edge, StrokePart } from './graph';
import type { ElevationSampler, LatLon, Profile, WayAttrs } from './types';

/** Sample spacing along lines, metres. */
export const STEP = 5;
/** Gaps without elevation data longer than this split the profile. */
const MAX_GAP = 150;

interface Vertex extends LatLon {
  attr: number;
}

/** Flatten a stroke into vertices, each tagged with the way of the segment that follows it. */
function strokeVertices(stroke: StrokePart[], edges: Edge[]): Vertex[] {
  const out: Vertex[] = [];
  for (const part of stroke) {
    const edge = edges[part.edge];
    const pts = part.reversed ? [...edge.coords].reverse() : edge.coords;
    // The shared node already exists (end of the previous part); it now starts
    // a segment of this part's way.
    if (out.length) out[out.length - 1].attr = edge.wayIndex;
    for (let i = out.length ? 1 : 0; i < pts.length; i++) {
      out.push({ lat: pts[i].lat, lon: pts[i].lon, attr: edge.wayIndex });
    }
  }
  return out;
}

/** Resample a polyline every STEP metres, carrying the way index of each sample. */
function resample(vertices: Vertex[]) {
  const lat: number[] = [];
  const lon: number[] = [];
  const attr: number[] = [];
  if (vertices.length < 2) return { lat, lon, attr };
  let carry = 0; // distance into the current segment of the next sample
  for (let i = 1; i < vertices.length; i++) {
    const a = vertices[i - 1];
    const b = vertices[i];
    const len = haversine(a, b);
    while (carry <= len) {
      const t = len === 0 ? 0 : carry / len;
      lat.push(a.lat + (b.lat - a.lat) * t);
      lon.push(a.lon + (b.lon - a.lon) * t);
      attr.push(a.attr);
      carry += STEP;
    }
    carry -= len;
  }
  return { lat, lon, attr };
}

/**
 * Median-of-3 then moving average over ±2 samples (25 m window).
 *
 * The lidar DEM is accurate, but OSM lines are often a few metres off the real
 * path and can touch a ditch, wall or embankment edge. Those show up as single
 * sample spikes; the median kills them, the mean removes residual jitter that
 * would otherwise inflate max gradients.
 */
export function smooth(ele: Float64Array): Float64Array {
  const n = ele.length;
  const med = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    if (i === 0 || i === n - 1) {
      med[i] = ele[i];
      continue;
    }
    const a = ele[i - 1], b = ele[i], c = ele[i + 1];
    med[i] = Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
  }
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    // Shrink the window symmetrically near the ends: a lopsided window would
    // pull the end points towards the interior and under-report gain.
    const r = Math.min(2, i, n - 1 - i);
    let sum = 0;
    for (let j = i - r; j <= i + r; j++) sum += med[j];
    out[i] = sum / (2 * r + 1);
  }
  return out;
}

/**
 * Elevation profiles for one stroke. Usually one profile; several when the
 * stroke crosses long areas without elevation data.
 */
export function strokeProfiles(
  stroke: StrokePart[],
  edges: Edge[],
  attrs: WayAttrs[],
  sampler: ElevationSampler,
): Profile[] {
  const { lat, lon, attr } = resample(strokeVertices(stroke, edges));
  const n = lat.length;
  if (n < 4) return [];

  // Bridges and tunnels: the DEM is bare-earth terrain, so sampling under a
  // bridge gives the river/road below, i.e. a fake 10 m dip. We treat those
  // samples as missing and interpolate between the abutments instead.
  const raw = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    raw[i] = attrs[attr[i]].offTerrain ? NaN : (sampler(lat[i], lon[i]) ?? NaN);
  }

  const profiles: Profile[] = [];
  let i = 0;
  while (i < n) {
    while (i < n && Number.isNaN(raw[i])) i++;
    const start = i;
    let end = i; // last valid index of this piece
    while (i < n) {
      if (!Number.isNaN(raw[i])) {
        end = i;
        i++;
        continue;
      }
      let j = i;
      while (j < n && Number.isNaN(raw[j])) j++;
      if (j >= n || (j - i) * STEP > MAX_GAP) break;
      for (let k = i; k < j; k++) {
        const t = (k - end) / (j - end);
        raw[k] = raw[end] + (raw[j] - raw[end]) * t;
      }
      i = j;
    }
    if (end - start >= 3) profiles.push(makeProfile(lat, lon, attr, raw, start, end));
    i = end + 1;
  }
  return profiles;
}

function makeProfile(
  lat: number[], lon: number[], attr: number[], raw: Float64Array, start: number, end: number,
): Profile {
  const m = end - start + 1;
  const dist = new Float64Array(m);
  for (let k = 0; k < m; k++) dist[k] = k * STEP;
  return {
    lat: Float64Array.from(lat.slice(start, end + 1)),
    lon: Float64Array.from(lon.slice(start, end + 1)),
    attr: Int32Array.from(attr.slice(start, end + 1)),
    dist,
    ele: smooth(raw.slice(start, end + 1)),
  };
}

/** The same profile walked the other way. */
export function reverseProfile(p: Profile): Profile {
  const n = p.dist.length;
  const last = p.dist[n - 1];
  const rev = <T extends Float64Array | Int32Array>(a: T) => a.slice().reverse() as T;
  return {
    lat: rev(p.lat),
    lon: rev(p.lon),
    attr: rev(p.attr),
    ele: rev(p.ele),
    dist: rev(p.dist).map((d) => last - d),
  };
}
