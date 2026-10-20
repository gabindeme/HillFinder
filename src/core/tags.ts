import type { Tags, WayAttrs } from './types';

/** Highway types we consider runnable. Motorways, trunks, steps etc. are excluded. */
export const RUNNABLE_HIGHWAYS = [
  'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street',
  'service', 'pedestrian', 'track', 'path', 'footway', 'cycleway', 'bridleway',
] as const;

const RUNNABLE = new Set<string>(RUNNABLE_HIGHWAYS);
const NO_ACCESS = new Set(['private', 'no']);
const FOOT_OK = new Set(['yes', 'designated', 'permissive']);
const SKIP_SERVICE = new Set(['driveway', 'parking_aisle', 'drive-through']);

export function isRunnable(tags: Tags): boolean {
  const hw = tags.highway;
  if (!hw || !RUNNABLE.has(hw)) return false;
  if (tags.area === 'yes') return false;
  if (tags.foot === 'no') return false;
  if (tags.access && NO_ACCESS.has(tags.access) && !(tags.foot && FOOT_OK.has(tags.foot))) return false;
  if (hw === 'service' && tags.service && SKIP_SERVICE.has(tags.service)) return false;
  return true;
}

const PAVED = new Set([
  'paved', 'asphalt', 'concrete', 'concrete:plates', 'concrete:lanes', 'paving_stones', 'sett',
  'cobblestone', 'unhewn_cobblestone', 'metal', 'wood', 'chipseal', 'bricks',
]);
const UNPAVED = new Set([
  'unpaved', 'gravel', 'fine_gravel', 'compacted', 'dirt', 'earth', 'ground', 'grass', 'mud',
  'sand', 'woodchips', 'pebblestone', 'rock', 'grass_paver',
]);

/**
 * Trail-likeness when the `surface` tag is missing, by highway type. Paths and
 * tracks are usually unpaved in France; urban footways usually aren't.
 */
const TRAIL_DEFAULT: Record<string, number> = {
  track: 0.85, path: 0.8, bridleway: 0.85, footway: 0.35, cycleway: 0.15, pedestrian: 0.1,
};

/** Rough car exposure by highway type: 1 = no cars, 0 = busy road. */
const SAFETY: Record<string, number> = {
  path: 1, footway: 1, track: 0.95, bridleway: 1, cycleway: 0.95, pedestrian: 1,
  living_street: 0.9, service: 0.8, residential: 0.75, unclassified: 0.6,
  tertiary: 0.4, secondary: 0.2, primary: 0.05,
};

export function classifyWay(id: number, tags: Tags): WayAttrs {
  const hw = tags.highway ?? 'path';
  const surface = tags.surface;
  let trail = TRAIL_DEFAULT[hw] ?? 0;
  if (surface && PAVED.has(surface)) trail = 0;
  else if (surface && UNPAVED.has(surface)) trail = 1;
  // Tracks of grade1 are solid (often paved); higher grades are dirt.
  if (!surface && hw === 'track' && tags.tracktype === 'grade1') trail = 0.3;

  let safety = SAFETY[hw] ?? 0.5;
  // A road with a sidewalk or low speed limit is much nicer to run on.
  const sidewalk = tags.sidewalk ?? tags['sidewalk:both'];
  if (sidewalk && sidewalk !== 'no' && sidewalk !== 'none' && safety < 0.7) safety += 0.2;
  const maxspeed = Number.parseInt(tags.maxspeed ?? '', 10);
  if (maxspeed && maxspeed <= 30 && safety < 0.85) safety += 0.1;

  const lit = tags.lit === 'yes' ? 1 : tags.lit === 'no' ? 0 : 0.5;
  const offTerrain = (!!tags.bridge && tags.bridge !== 'no') || (!!tags.tunnel && tags.tunnel !== 'no');

  return { wayId: id, name: tags.name ?? null, highway: hw, trail, safety: Math.min(1, safety), lit, offTerrain };
}
