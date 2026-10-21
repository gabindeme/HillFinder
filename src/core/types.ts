/** Shared domain types for the climb-finding core. Pure data, no DOM. */

export interface LatLon {
  lat: number;
  lon: number;
}

export interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

export type Tags = Record<string, string>;

/** An OSM way as returned by Overpass (`out body geom`). */
export interface OsmWay {
  id: number;
  nodes: number[];
  geometry: LatLon[];
  tags: Tags;
}

/** Returns terrain elevation in metres, or null where there is no data. */
export type ElevationSampler = (lat: number, lon: number) => number | null;

/** Per-way attributes relevant to runners, derived from OSM tags. */
export interface WayAttrs {
  wayId: number;
  name: string | null;
  highway: string;
  /** 1 = clearly trail/dirt, 0 = clearly paved, in between = unknown. */
  trail: number;
  /** 1 = car-free path, 0 = busy road. */
  safety: number;
  /** 1 = lit, 0 = unlit, 0.5 = unknown. */
  lit: number;
  /** Bridges and tunnels are not on the terrain surface (see profile.ts). */
  offTerrain: boolean;
}

/**
 * A resampled line with evenly spaced samples (index i is `i * step` metres
 * from the start). Parallel arrays keep large profiles cheap to build.
 */
export interface Profile {
  lat: Float64Array;
  lon: Float64Array;
  dist: Float64Array;
  ele: Float64Array;
  /** Index into the attrs table for the way each sample lies on. */
  attr: Int32Array;
}

/** A detected climb with everything the UI and scoring need. */
export interface Climb {
  id: string;
  /** Polyline from bottom to top. */
  coords: LatLon[];
  /** Elevation profile: distance from bottom (m) and elevation (m). */
  profile: { dist: number[]; ele: number[] };
  length: number;
  gain: number;
  avgGrade: number;
  maxGrade: number;
  startEle: number;
  /** Straight-line distance from the search origin to the bottom, metres. */
  distance: number;
  trail: number;
  safety: number;
  lit: number;
  names: string[];
  /** Most common OSM highway type along the climb (e.g. "footway"). */
  highway: string;
  /** For unnamed climbs: the park it's in, or the nearest named street. */
  near?: { kind: 'in' | 'near'; name: string };
}
