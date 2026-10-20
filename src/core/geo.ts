import type { BBox, LatLon } from './types';

const EARTH_RADIUS = 6371008.8;
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

export function haversine(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from a to b, degrees clockwise from north in [0, 360). */
export function bearing(a: LatLon, b: LatLon): number {
  const φ1 = toRad(a.lat);
  const φ2 = toRad(b.lat);
  const Δλ = toRad(b.lon - a.lon);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Smallest absolute difference between two bearings, in [0, 180]. */
export function angleDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

export function bboxAround(center: LatLon, radius: number): BBox {
  const dLat = toDeg(radius / EARTH_RADIUS);
  const dLon = toDeg(radius / (EARTH_RADIUS * Math.cos(toRad(center.lat))));
  return { south: center.lat - dLat, north: center.lat + dLat, west: center.lon - dLon, east: center.lon + dLon };
}

/**
 * Equirectangular projection around a reference point, giving metres.
 * Accurate to well under 1% over the few tens of km we work with, and much
 * cheaper than haversine in hot loops.
 */
export function localProjection(ref: LatLon) {
  const ky = (Math.PI / 180) * EARTH_RADIUS;
  const kx = ky * Math.cos(toRad(ref.lat));
  return {
    x: (lon: number) => (lon - ref.lon) * kx,
    y: (lat: number) => (lat - ref.lat) * ky,
  };
}
