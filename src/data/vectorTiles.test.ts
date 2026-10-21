import { describe, expect, it } from 'vitest';
import { clipLine, omtTags } from './vectorTiles';

describe('clipLine', () => {
  // A line crossing from tile A (x 0..4096) into tile B (x 4096..8192), with buffer overlap.
  const line: [number, number][] = [[4000, 100], [4200, 300]];

  it('cuts at the tile edge so both tiles meet at the same point', () => {
    const [a] = clipLine(line, 0, 0, 4096);
    const [b] = clipLine(line, 4096, 0, 4096);
    expect(a[a.length - 1]).toEqual(b[0]);
    expect(a[a.length - 1][0]).toBe(4096);
  });

  it('splits a line that leaves and re-enters the tile', () => {
    const pieces = clipLine([[100, 100], [100, -50], [200, -50], [200, 100]], 0, 0, 4096);
    expect(pieces).toHaveLength(2);
  });

  it('drops lines entirely in the buffer', () => {
    expect(clipLine([[-60, 10], [-10, 20]], 0, 0, 4096)).toHaveLength(0);
  });
});

describe('omtTags', () => {
  it('maps OpenMapTiles classes to OSM highway tags', () => {
    expect(omtTags({ class: 'minor' })?.highway).toBe('residential');
    expect(omtTags({ class: 'path', subclass: 'footway', surface: 'unpaved' })).toMatchObject({ highway: 'footway', surface: 'unpaved' });
    expect(omtTags({ class: 'path', subclass: 'cycleway', brunnel: 'bridge' })?.bridge).toBe('yes');
  });

  it('skips unrunnable features', () => {
    expect(omtTags({ class: 'motorway' })).toBeNull();
    expect(omtTags({ class: 'path', subclass: 'steps' })).toBeNull();
    expect(omtTags({ class: 'service', service: 'parking_aisle' })).toBeNull();
    expect(omtTags({ class: 'rail' })).toBeNull();
  });
});
