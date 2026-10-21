/**
 * MapLibre map: search origin, radius, and the ranked climbs. Each climb is
 * drawn as a line coloured by gradient segment, with a numbered marker at the
 * bottom of the hill.
 */
import type { Feature, FeatureCollection } from 'geojson';
import {
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  setWorkerUrl,
  type GeoJSONSource,
  type MapLayerMouseEvent,
  type StyleSpecification,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { useEffect, useRef } from 'react';
import { bboxAround } from '../core/geo';
import type { RankedClimb } from '../core/scoring';
import type { LatLon } from '../core/types';
import { gradeColor } from './format';

// MapLibre locates its worker relative to its own module, which breaks once
// Vite pre-bundles it. Point it at the (self-contained) worker file explicitly.
setWorkerUrl(maplibreWorkerUrl);

const STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

interface Props {
  origin: LatLon | null;
  radiusKm: number;
  climbs: RankedClimb[];
  selectedId: string | null;
  /** A search is running: the origin marker pulses. */
  searching: boolean;
  onSelect: (id: string) => void;
}

/** Split a climb into ~25 m pieces, each coloured by its own gradient. */
function gradientSegments(c: RankedClimb, selected: boolean): Feature[] {
  const { dist, ele } = c.profile;
  const out: Feature[] = [];
  const step = 5; // samples: 5 × 5 m = 25 m
  for (let i = 0; i < c.coords.length - 1; i += step) {
    const j = Math.min(i + step, c.coords.length - 1);
    const grade = ((ele[j] - ele[i]) / Math.max(1, dist[j] - dist[i])) * 100;
    out.push({
      type: 'Feature',
      properties: { id: c.id, color: gradeColor(grade), selected },
      geometry: { type: 'LineString', coordinates: c.coords.slice(i, j + 1).map((p) => [p.lon, p.lat]) },
    });
  }
  return out;
}

function circle(center: LatLon, radiusKm: number): Feature {
  const { north, east } = bboxAround(center, radiusKm * 1000);
  const dLat = north - center.lat;
  const dLon = east - center.lon;
  const ring = Array.from({ length: 65 }, (_, i) => {
    const a = (i / 64) * 2 * Math.PI;
    return [center.lon + dLon * Math.cos(a), center.lat + dLat * Math.sin(a)];
  });
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } };
}

const empty: FeatureCollection = { type: 'FeatureCollection', features: [] };

export function MapView({ origin, radiusKm, climbs, selectedId, searching, onSelect }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markers = useRef<Marker[]>([]);
  const originMarker = useRef<Marker | null>(null);
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  });
  const loaded = useRef(false);
  // Updates requested before the style finished loading, replayed on load.
  const pending = useRef<(() => void)[]>([]);
  const whenLoaded = (fn: () => void) => (loaded.current ? fn() : pending.current.push(fn));

  useEffect(() => {
    const map = new MapLibreMap({
      container: container.current!,
      style: STYLE,
      center: [-1.68, 48.1113],
      zoom: 12,
      attributionControl: { compact: true },
    });
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    map.on('load', () => {
      map.addSource('radius', { type: 'geojson', data: empty });
      map.addLayer({ id: 'radius', type: 'line', source: 'radius', paint: { 'line-color': '#1565c0', 'line-width': 1.5, 'line-dasharray': [3, 2] } });
      map.addSource('climbs', { type: 'geojson', data: empty });
      // White casing under the coloured line keeps climbs readable on any background.
      map.addLayer({
        id: 'climbs-casing', type: 'line', source: 'climbs', layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#fff', 'line-width': ['case', ['get', 'selected'], 11, 7] },
      });
      map.addLayer({
        id: 'climbs', type: 'line', source: 'climbs', layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['get', 'color'], 'line-width': ['case', ['get', 'selected'], 7, 4] },
      });
      map.on('click', 'climbs-casing', (e: MapLayerMouseEvent) => {
        const id = e.features?.[0]?.properties?.id;
        if (id) onSelectRef.current(String(id));
      });
      map.on('mouseenter', 'climbs-casing', () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', 'climbs-casing', () => (map.getCanvas().style.cursor = ''));
      loaded.current = true;
      pending.current.splice(0).forEach((fn) => fn());
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      loaded.current = false;
      // Drop updates queued for this map (React dev mode mounts components twice).
      pending.current = [];
    };
  }, []);

  // Origin + radius.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      originMarker.current?.remove();
      (map.getSource('radius') as GeoJSONSource).setData(origin ? circle(origin, radiusKm) : empty);
      if (!origin) return;
      const el = document.createElement('div');
      el.className = 'origin-marker';
      originMarker.current = new Marker({ element: el }).setLngLat([origin.lon, origin.lat]).addTo(map);
      const b = bboxAround(origin, radiusKm * 1000);
      map.fitBounds([[b.west, b.south], [b.east, b.north]], { padding: 20, duration: 600 });
    };
    whenLoaded(apply);
  }, [origin, radiusKm]);

  // Climbs + selection.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      // Draw the selected climb last so it sits on top.
      const ordered = [...climbs].sort((a, b) => Number(a.id === selectedId) - Number(b.id === selectedId));
      (map.getSource('climbs') as GeoJSONSource).setData({
        type: 'FeatureCollection',
        features: ordered.flatMap((c) => gradientSegments(c, c.id === selectedId)),
      });
      markers.current.forEach((m) => m.remove());
      markers.current = climbs.map((c) => {
        const el = document.createElement('button');
        el.className = `rank-marker${c.id === selectedId ? ' selected' : ''}`;
        el.textContent = String(c.rank);
        el.setAttribute('aria-label', `Climb ${c.rank}`);
        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          onSelectRef.current(c.id);
        });
        return new Marker({ element: el }).setLngLat([c.coords[0].lon, c.coords[0].lat]).addTo(map);
      });
      const sel = climbs.find((c) => c.id === selectedId);
      if (sel) {
        const lons = sel.coords.map((p) => p.lon);
        const lats = sel.coords.map((p) => p.lat);
        map.fitBounds(
          [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
          { padding: 60, maxZoom: 17, duration: 600 },
        );
      }
    };
    whenLoaded(apply);
  }, [climbs, selectedId]);

  useEffect(() => {
    originMarker.current?.getElement().classList.toggle('searching', searching);
  }, [searching, origin]);

  return <div ref={container} className="map" />;
}
