import { describe, expect, it } from 'vitest';
import { favoriteKey } from './favorites';

describe('favoriteKey', () => {
  const climb = (lat: number) => ({ coords: [{ lat, lon: -1.67 }, { lat: lat + 0.002, lon: -1.669 }] });

  it('recognises the same hill despite metre-level differences between searches', () => {
    expect(favoriteKey(climb(48.112551))).toBe(favoriteKey(climb(48.112549)));
  });

  it('distinguishes different hills', () => {
    expect(favoriteKey(climb(48.1125))).not.toBe(favoriteKey(climb(48.1205)));
  });
});
