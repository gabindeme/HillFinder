import { describe, expect, it } from 'vitest';
import { sameClimb } from './favorites';

describe('sameClimb', () => {
  const climb = (lat: number) => ({ coords: [{ lat, lon: -1.67 }, { lat: lat + 0.002, lon: -1.669 }] });

  it('recognises the same hill despite metre-level differences between searches', () => {
    // These straddle a 4-decimal rounding boundary, which broke key comparison.
    expect(sameClimb(climb(48.112551), climb(48.112549))).toBe(true);
    expect(sameClimb(climb(48.1125), climb(48.11265))).toBe(true); // ~17 m apart
  });

  it('distinguishes different hills', () => {
    expect(sameClimb(climb(48.1125), climb(48.1205))).toBe(false);
  });
});
