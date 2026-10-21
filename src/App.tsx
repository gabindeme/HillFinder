import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { effectiveRadiusKm, type Filters } from './core/filters';
import { rankClimbs } from './core/scoring';
import type { Climb } from './core/types';
import type { Place } from './data/nominatim';
import { SearchError, searchClimbs, type SearchProgress } from './data/searchClient';
import type { DataSource } from './worker/protocol';
import { ClimbDetail } from './ui/ClimbDetail';
import { ClimbList } from './ui/ClimbList';
import { FilterBar } from './ui/FilterBar';
import { LocationBar } from './ui/LocationBar';
import { MapView } from './ui/MapView';
import { useFilters, useStored } from './ui/storage';

/** Development test location (and the "try it" example): central Rennes. */
const RENNES: Place = { lat: 48.1113, lon: -1.68, label: 'Rennes, France' };

type Status =
  | { kind: 'idle' }
  | { kind: 'loading'; progress: SearchProgress | null }
  | { kind: 'error'; message: string }
  | { kind: 'done'; partial: boolean };

export default function App() {
  const { t } = useTranslation();
  const [origin, setOrigin] = useStored<Place | null>('hillfinder.origin', null);
  const [filters, setFilters] = useFilters();
  const [source, setSource] = useStored<DataSource>('hillfinder.source', 'fast');
  // Radius the current candidates were searched with. Shrinking the slider
  // just filters them; growing it beyond this triggers a new search.
  const searchRadius = useRef(effectiveRadiusKm(filters));
  const [candidates, setCandidates] = useState<Climb[] | null>(null);
  const [resolution, setResolution] = useState<number | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const latest = useRef(0);

  const run = useCallback(async (place: Place, radiusKm: number, src: DataSource) => {
    const id = ++latest.current;
    searchRadius.current = radiusKm;
    setStatus({ kind: 'loading', progress: null });
    setSelectedId(null);
    try {
      const out = await searchClimbs(place, radiusKm, src, (progress) => {
        if (id === latest.current) setStatus({ kind: 'loading', progress });
      });
      if (id !== latest.current) return;
      setCandidates(out.candidates);
      setResolution(out.resolution);
      setStatus({ kind: 'done', partial: out.missingTiles > 0 });
    } catch (err) {
      if (id !== latest.current) return;
      const busy = err instanceof SearchError && err.code === 'busy';
      setStatus({ kind: 'error', message: busy ? t('status.busy') : t('status.error', { message: (err as Error).message }) });
    }
  }, [t]);

  // Re-run the last search on startup (served from cache when recent).
  const restored = useRef(origin);
  const restoredSource = useRef(source);
  useEffect(() => {
    if (restored.current) void run(restored.current, searchRadius.current, restoredSource.current);
  }, [run]);

  const onPlace = (place: Place) => {
    setOrigin(place);
    void run(place, effectiveRadiusKm(filters), source);
  };

  const onSource = (s: DataSource) => {
    setSource(s);
    if (origin) void run(origin, searchRadius.current, s);
  };

  const onAreaCommit = (f: Filters) => {
    const km = effectiveRadiusKm(f);
    if (origin && km > searchRadius.current) void run(origin, km, source);
  };
  const radiusKm = effectiveRadiusKm(filters);
  // Lighting comes from OSM `lit` tags, only available with the detailed source.
  const hasLighting = source === 'detailed';

  const ranked = useMemo(
    // Without lighting data every path is "unknown", so the preference would only add noise.
    () =>
      candidates
        ? rankClimbs(candidates, {
            ...filters,
            preferLit: filters.preferLit && hasLighting,
            openAllTimes: filters.openAllTimes && hasLighting,
          })
        : null,
    [candidates, filters, hasLighting],
  );
  const selected = ranked?.climbs.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="app">
      <aside className="panel">
        <header className="header">
          <h1>
            ⛰ {t('app.name')}
            <small>{t('app.tagline')}</small>
          </h1>
          <LocationBar onPlace={onPlace} />
          {!origin && (
            <button type="button" className="link" onClick={() => onPlace(RENNES)}>
              {t('location.tryExample', { place: 'Rennes' })}
            </button>
          )}
        </header>

        <FilterBar
          filters={filters}
          onChange={setFilters}
          onAreaCommit={onAreaCommit}
          source={source}
          onSource={onSource}
        />

        <div className="results" aria-live="polite">
          {status.kind === 'loading' && <StatusLine progress={status.progress} />}
          {status.kind === 'error' && (
            <p className="message" role="alert">
              {status.message}{' '}
              <button type="button" className="link" onClick={() => origin && run(origin, searchRadius.current, source)}>
                {t('status.retry')}
              </button>
            </p>
          )}
          {status.kind === 'done' && ranked && !selected && (
            <>
              {ranked.climbs.length === 0 ? (
                <p className="message">{t('status.empty')}</p>
              ) : (
                <p className="muted">
                  {t('status.found', { count: ranked.climbs.length, radius: radiusKm })}
                  {ranked.relaxLevel > 0 && <> · {t('status.relaxed')}</>}
                </p>
              )}
              {status.partial && <p className="message">{t('status.partial')}</p>}
              {ranked.hiddenRestricted > 0 && (
                <p className="muted">{t('status.hidden', { count: ranked.hiddenRestricted })}</p>
              )}
              <ClimbList climbs={ranked.climbs} reach={filters.reach} onSelect={setSelectedId} />
            </>
          )}
          {status.kind === 'done' && selected && <ClimbDetail
              climb={selected}
              reach={filters.reach}
              detailed={hasLighting}
              showLit={hasLighting && filters.preferLit}
              onBack={() => setSelectedId(null)}
            />}
        </div>

        <footer className="footer muted">
          {t(`footer.data.${source}`)}
          {resolution && <> · {t('footer.resolution', { m: resolution.toFixed(0) })}</>}
        </footer>
      </aside>

      <MapView
        origin={origin}
        radiusKm={radiusKm}
        climbs={ranked?.climbs ?? []}
        selectedId={selectedId}
        onSelect={setSelectedId}
      />
    </div>
  );
}

function StatusLine({ progress }: { progress: SearchProgress | null }) {
  const { t } = useTranslation();
  const stage = progress?.stage ?? 'download';
  return (
    <div>
      <p className="status">
        <span className="spinner" aria-hidden />{' '}
        {t(`status.${stage}`, { done: progress?.done ?? 0, total: progress?.total ?? 1 })}
      </p>
      {stage === 'download' && <p className="muted">{t('status.slow')}</p>}
    </div>
  );
}
