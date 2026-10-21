import { describe, expect, it } from 'vitest';
import { annotateAccess, isAccessible, isClosedBarrier, restrictionOf } from './access';
import { detectClimbs, maxGrade, scanAscents } from './climbs';
import { dedupe } from './dedupe';
import { activeFilterCount, DEFAULT_FILTERS, effectiveRadiusKm } from './filters';
import { buildStrokes, splitIntoEdges } from './graph';
import { labelUnnamed, stitchRings } from './naming';
import { findCandidates } from './pipeline';
import { reverseProfile, STEP, strokeProfiles } from './profile';
import { passes, rankClimbs } from './scoring';
import { estimateRepSeconds, suggestSession } from './session';
import { classifyWay } from './tags';
import type { Climb, LatLon, OsmWay, Profile } from './types';

/** Profile from a list of elevations at STEP spacing along a north-going line. */
function profileOf(ele: number[]): Profile {
  const n = ele.length;
  return {
    lat: Float64Array.from({ length: n }, (_, i) => 48 + (i * STEP) / 111_320),
    lon: new Float64Array(n).fill(-1.68),
    dist: Float64Array.from({ length: n }, (_, i) => i * STEP),
    ele: Float64Array.from(ele),
    attr: new Int32Array(n),
  };
}

/** Elevations for a constant-grade stretch of `length` metres starting at `from`. */
const ramp = (from: number, grade: number, length: number) =>
  Array.from({ length: Math.round(length / STEP) }, (_, i) => from + grade * i * STEP);

describe('scanAscents', () => {
  it('tolerates small dips inside a climb', () => {
    const ele = [...ramp(0, 0.05, 100), 4.0, 3.5, ...ramp(4, 0.05, 100)];
    expect(scanAscents(ele, 2)).toHaveLength(1);
  });

  it('ends a climb at a dip deeper than the tolerance', () => {
    const ele = [...ramp(0, 0.05, 100), ...ramp(5, -0.05, 100), ...ramp(0, 0.05, 100)];
    expect(scanAscents(ele, 2)).toHaveLength(2);
  });
});

describe('detectClimbs', () => {
  it('splits two ramps separated by a long flat', () => {
    const ele = [...ramp(0, 0.06, 200), ...ramp(12, 0, 300), ...ramp(12, 0.06, 200)];
    const spans = detectClimbs(profileOf(ele));
    expect(spans).toHaveLength(2);
  });

  it('trims gentle run-ins so the average describes the hill', () => {
    const ele = [...ramp(0, 0.005, 60), ...ramp(0.3, 0.08, 150), ...ramp(12.3, 0.005, 60)];
    const p = profileOf(ele);
    const [[s, e]] = detectClimbs(p);
    const grade = (p.ele[e] - p.ele[s]) / (p.dist[e] - p.dist[s]);
    expect(grade).toBeGreaterThan(0.07);
  });

  it('finds the climb in the other direction on a reversed profile', () => {
    const p = profileOf(ramp(20, -0.05, 200));
    expect(detectClimbs(p)).toHaveLength(0);
    expect(detectClimbs(reverseProfile(p))).toHaveLength(1);
  });
});

describe('maxGrade', () => {
  it('uses a window so single-sample noise does not dominate', () => {
    const ele = ramp(0, 0.05, 200);
    ele[20] += 1; // a 1 m spike = 20% over one 5 m sample
    const p = profileOf(ele);
    expect(maxGrade(p.dist, p.ele, 0, ele.length - 1)).toBeLessThan(0.08);
  });
});

// A small cross-shaped network: a north–south street crossing an east–west one,
// with the N–S street split into two OSM ways at the junction.
const pt = (dy: number, dx: number): LatLon => ({ lat: 48 + dy / 111_320, lon: -1.68 + dx / 74_500 });
const crossWays: OsmWay[] = [
  { id: 1, nodes: [1, 2, 3], geometry: [pt(0, 0), pt(100, 0), pt(200, 0)], tags: { highway: 'residential' } },
  { id: 2, nodes: [3, 4, 5], geometry: [pt(200, 0), pt(300, 0), pt(400, 0)], tags: { highway: 'residential' } },
  { id: 3, nodes: [6, 3, 7], geometry: [pt(200, -200), pt(200, 0), pt(200, 200)], tags: { highway: 'footway' } },
];

describe('graph', () => {
  it('chains straight continuations through a junction', () => {
    const edges = splitIntoEdges(crossWays);
    expect(edges).toHaveLength(4);
    const strokes = buildStrokes(edges);
    expect(strokes).toHaveLength(2);
    expect(strokes.map((s) => s.length).sort()).toEqual([2, 2]);
  });
});

describe('profiles', () => {
  it('interpolates across bridges instead of following the valley below', () => {
    const ways: OsmWay[] = [
      { id: 1, nodes: [1, 2], geometry: [pt(0, 0), pt(100, 0)], tags: { highway: 'path' } },
      { id: 2, nodes: [2, 3], geometry: [pt(100, 0), pt(150, 0)], tags: { highway: 'path', bridge: 'yes' } },
      { id: 3, nodes: [3, 4], geometry: [pt(150, 0), pt(250, 0)], tags: { highway: 'path' } },
    ];
    // Terrain: flat at 30 m with a 10 m deep river valley under the bridge.
    const sampler = (lat: number) => {
      const y = (lat - 48) * 111_320;
      return y > 100 && y < 150 ? 20 : 30;
    };
    const edges = splitIntoEdges(ways);
    const attrs = ways.map((w) => classifyWay(w.id, w.tags));
    const [profile] = strokeProfiles(buildStrokes(edges)[0], edges, attrs, sampler);
    expect(Math.min(...profile.ele)).toBeGreaterThan(29.9);
  });
});

describe('pipeline + ranking', () => {
  // The N–S street climbs 24 m over 400 m (6%).
  const sampler = (lat: number) => ((lat - 48) * 111_320) * 0.06;
  const origin = pt(0, 0);

  it('finds the hill and ranks it with a breakdown', () => {
    const candidates = findCandidates(crossWays, sampler, origin, 5000);
    const { climbs, relaxLevel } = rankClimbs(candidates, DEFAULT_FILTERS);
    expect(relaxLevel).toBe(2); // only one hill exists, so filters get relaxed
    expect(climbs[0].gain).toBeCloseTo(24, 0);
    expect(climbs[0].avgGrade).toBeCloseTo(6, 0);
    const total = climbs[0].factors.reduce((s, f) => s + f.points, 0);
    expect(total).toBeCloseTo(climbs[0].score);
  });

  it('always returns something, even when nothing matches the filters', () => {
    const candidates = findCandidates(crossWays, sampler, origin, 5000);
    const { climbs } = rankClimbs(candidates, { ...DEFAULT_FILTERS, minGain: 500, minAvgGrade: 20 });
    expect(climbs.length).toBeGreaterThan(0);
  });
});

describe('session', () => {
  it('is slower uphill than on the flat', () => {
    expect(estimateRepSeconds(400, 0.07)).toBeGreaterThan(estimateRepSeconds(400, 0));
  });

  it('suggests short sprints on a tiny hill and capped reps on a long one', () => {
    const climbOf = (length: number, grade: number) => {
      const dist = Array.from({ length: length / STEP + 1 }, (_, i) => i * STEP);
      return { length, gain: length * grade, profile: { dist, ele: dist.map((d) => d * grade) } } as Pick<
        Climb, 'length' | 'gain' | 'profile'
      >;
    };
    expect(suggestSession(climbOf(80, 0.1)).kind).toBe('short');
    const long = suggestSession(climbOf(1500, 0.05));
    expect(long.kind).toBe('long');
    expect(long.repLength).toBe(600);
    expect(long.avgGrade).toBeCloseTo(5, 1);
  });
});

describe('naming', () => {
  const climb = (coords: LatLon[]): Climb =>
    ({ coords, names: [], highway: 'footway' }) as unknown as Climb;

  it('labels an unnamed climb with the park it is in', () => {
    const park: OsmWay = {
      id: 9, nodes: [1, 2, 3, 4, 1],
      geometry: [pt(-100, -100), pt(-100, 100), pt(300, 100), pt(300, -100), pt(-100, -100)],
      tags: { leisure: 'park', name: 'Parc du Thabor' },
    };
    const c = climb([pt(0, 0), pt(100, 0), pt(200, 0)]);
    labelUnnamed([c], [park]);
    expect(c.near).toEqual({ kind: 'in', name: 'Parc du Thabor' });
  });

  it('falls back to the nearest named street', () => {
    const street: OsmWay = { id: 8, nodes: [1, 2], geometry: [pt(100, 60), pt(100, 300)], tags: { highway: 'residential', name: 'Rue Martenot' } };
    const c = climb([pt(0, 0), pt(100, 0), pt(200, 0)]);
    labelUnnamed([c], [street]);
    expect(c.near).toEqual({ kind: 'near', name: 'Rue Martenot' });
  });
});

describe('dedupe', () => {
  const line = (dx: number, len = 200): Climb =>
    ({ coords: [pt(0, dx), pt(len / 2, dx), pt(len, dx)] }) as unknown as Climb;

  it('drops a sidewalk running alongside the road', () => {
    expect(dedupe([line(0), line(8)])).toHaveLength(1);
  });

  it('keeps one route per hill but keeps separate hills', () => {
    expect(dedupe([line(0), line(120)])).toHaveLength(1); // parallel paths up the same slope
    expect(dedupe([line(0), line(800)])).toHaveLength(2);
  });
});

describe('stitchRings', () => {
  it('joins split outline pieces, reversing where needed', () => {
    const a = pt(0, 0), b = pt(0, 100), c = pt(100, 100), d = pt(100, 0);
    const rings = stitchRings([[a, b], [c, b], [c, d, a]]);
    expect(rings).toHaveLength(1);
    expect(rings[0]).toHaveLength(5);
  });
});

describe('filters', () => {
  it('turns travel time into a straight-line radius', () => {
    expect(effectiveRadiusKm({ ...DEFAULT_FILTERS, reach: 'distance', radiusKm: 7 })).toBe(7);
    // 15 min running at 10 km/h = 2.5 km of route ≈ 1.9 km straight line
    expect(effectiveRadiusKm({ ...DEFAULT_FILTERS, reach: 'foot', travelMinutes: 15 })).toBeCloseTo(1.9, 1);
    expect(effectiveRadiusKm({ ...DEFAULT_FILTERS, reach: 'bike', travelMinutes: 15 })).toBeGreaterThan(3);
  });

  it('counts only the advanced filters the user changed', () => {
    expect(activeFilterCount(DEFAULT_FILTERS)).toBe(0);
    expect(activeFilterCount({ ...DEFAULT_FILTERS, surface: 'trail', minGain: 20, radiusKm: 12 })).toBe(2);
  });

  it('excludes busy roads when avoiding traffic, unless nothing else exists', () => {
    const busy = { distance: 100, length: 300, gain: 20, avgGrade: 6.7, maxGrade: 8, trail: 0, safety: 0.1 } as Climb;
    expect(passes(busy, { ...DEFAULT_FILTERS, avoidTraffic: true })).toBe(false);
    expect(passes(busy, { ...DEFAULT_FILTERS, avoidTraffic: false })).toBe(true);
  });
});

describe('access', () => {
  const climbAlong = (dx: number) =>
    ({ coords: Array.from({ length: 41 }, (_, i) => pt(i * 5, dx)), names: [] }) as unknown as Climb;
  const area = (tags: Record<string, string>): OsmWay => ({
    id: -1, nodes: [],
    geometry: [pt(-50, -50), pt(-50, 50), pt(250, 50), pt(250, -50), pt(-50, -50)],
    tags,
  });

  it('flags climbs inside a military area even if the path itself has no access tag', () => {
    const c = climbAlong(0);
    annotateAccess([c], [area({ landuse: 'military', name: 'Quartier Leschi' })]);
    expect(c.access?.restricted).toBe('military');
    expect(isAccessible(c)).toBe(false);
  });

  it('keeps climbs outside restricted areas and reports park opening hours', () => {
    const outside = climbAlong(500);
    const inPark = climbAlong(0);
    annotateAccess([outside, inPark], [area({ leisure: 'park', name: 'Parc du Thabor', opening_hours: '07:30-20:30' })]);
    expect(isAccessible(outside)).toBe(true);
    expect(inPark.access?.hours).toBe('07:30-20:30');
    expect(isAccessible(inPark)).toBe(true);
  });

  it('blocks climbs through a locked gate but not an ordinary gate', () => {
    const c = climbAlong(0);
    const gate = (tags: Record<string, string>): OsmWay => ({ id: -2, nodes: [], geometry: [pt(100, 0)], tags });
    annotateAccess([c], [gate({ barrier: 'gate' })]);
    expect(c.access?.closedGate).toBe(false);
    annotateAccess([c], [gate({ barrier: 'gate', locked: 'yes' })]);
    expect(c.access?.closedGate).toBe(true);
  });

  it('classifies restriction kinds', () => {
    expect(restrictionOf({ amenity: 'school' })).toBe('school');
    expect(restrictionOf({ access: 'private', landuse: 'grass' })).toBe('private');
    expect(restrictionOf({ highway: 'service', access: 'private' })).toBeNull();
    expect(isClosedBarrier({ barrier: 'gate', access: 'private', foot: 'yes' })).toBe(false);
  });
});
