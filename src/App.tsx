import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { effectiveRadiusKm, type Filters } from './core/filters';
import { haversine } from './core/geo';
import { refineClimb } from './core/refine';
import { rankClimbs, type RankedClimb } from './core/scoring';
import { suggestSession } from './core/session';
import type { Climb } from './core/types';
import type { Place } from './data/nominatim';
import { fineProfiles } from './data/fineElevation';
import { SearchError, searchClimbs, warmUpSearch } from './data/searchClient';
import { ClimbDetail } from './ui/ClimbDetail';
import { ClimbList } from './ui/ClimbList';
import { useFavorites } from './ui/favorites';
import { FilterBar } from './ui/FilterBar';
import { fmtNum } from './ui/format';
import { LanguageSwitch } from './ui/LanguageSwitch';
import { LocationBar } from './ui/LocationBar';
import { progressTracker } from './ui/progress';
import { SearchProgress } from './ui/SearchProgress';
import { useFilters, useStored } from './ui/storage';
import type { DataSource, SearchStage } from './worker/protocol';

// MapLibre is most of the app's code: load it separately so the search panel
// shows (and works) while the map is still downloading.
const MapView = lazy(() => import('./ui/MapView').then((m) => ({ default: m.MapView })));

/** How many recent places to remember. */
const RECENT_PLACES = 5;

/** Development test location (and the "try it" example): central Rennes. */
const RENNES: Place = { lat: 48.1113, lon: -1.68, label: 'Rennes, France' };

type Status =
  | { kind: 'idle' }
  | { kind: 'loading'; stage: SearchStage; pct: number; nearbyKm: number | null; radiusKm: number }
  | { kind: 'error'; message: string }
  | { kind: 'done'; partial: boolean };

type Tab = 'results' | 'favorites';

export default function App() {
  const { t } = useTranslation();
  const [origin, setOrigin] = useStored<Place | null>('hillfinder.origin', null);
  const [filters, setFilters] = useFilters();
  const [source, setSource] = useStored<DataSource>('hillfinder.source', 'fast');
  const { favorites, isFavorite, toggle: toggleFavorite } = useFavorites();
  const [tab, setTab] = useState<Tab>('results');
  // Radius the current candidates were searched with. Shrinking the slider
  // just filters them; growing it beyond this triggers a new search.
  const searchRadius = useRef(effectiveRadiusKm(filters));
  const [candidates, setCandidates] = useState<Climb[] | null>(null);
  const [resolution, setResolution] = useState<number | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [recent, setRecent] = useStored<Place[]>('hillfinder.recent', []);
  // Climbs whose LiDAR re-measurement was attempted / failed (see the refinement effect).
  const refineTried = useRef(new Set<string>());
  const [unrefinable, setUnrefinable] = useState<ReadonlySet<string>>(new Set());
  const latest = useRef(0);

  const run = useCallback(
    async (place: Place, radiusKm: number, src: DataSource, stairs: boolean) => {
      const id = ++latest.current;
      searchRadius.current = radiusKm;
      refineTried.current = new Set();
      const track = progressTracker();
      let nearbyKm: number | null = null;
      // Keep showing current results while the new search runs (if any): an
      // updating list feels much faster than an empty one.
      setStatus({ kind: 'loading', stage: 'nearby', pct: 0, nearbyKm, radiusKm });
      setSelectedId(null);
      setTab('results');
      try {
        const out = await searchClimbs(place, radiusKm, src, stairs, {
          onProgress: (p) => {
            if (id === latest.current) setStatus({ kind: 'loading', stage: p.stage, pct: track(p), nearbyKm, radiusKm });
          },
          onPartial: (p) => {
            if (id !== latest.current) return;
            nearbyKm = p.nearbyKm;
            setCandidates(p.candidates);
            setResolution(p.resolution);
          },
        });
        if (id !== latest.current) return;
        setCandidates(out.candidates);
        setResolution(out.resolution);
        setStatus({ kind: 'done', partial: out.missingTiles > 0 });
      } catch (err) {
        if (id !== latest.current) return;
        const busy = err instanceof SearchError && err.code === 'busy';
        const message = !navigator.onLine
          ? t('status.offline')
          : busy
            ? t('status.busy')
            : t('status.error', { message: (err as Error).message });
        setStatus({ kind: 'error', message });
      }
    },
    [t],
  );

  // Start the worker right away, and re-run the last search on startup
  // (instant when its results are cached).
  const restored = useRef({ origin, source, stairs: filters.includeStairs });
  useEffect(() => {
    warmUpSearch();
    const r = restored.current;
    if (r.origin) void run(r.origin, searchRadius.current, r.source, r.stairs);
  }, [run]);

  const onPlace = (place: Place) => {
    // A different place: old results would be misleading, clear them.
    setCandidates(null);
    setOrigin(place);
    setRecent((list) =>
      [place, ...list.filter((p) => haversine(p, place) > 200)].slice(0, RECENT_PLACES),
    );
    void run(place, effectiveRadiusKm(filters), source, filters.includeStairs);
  };

  const onSource = (s: DataSource) => {
    setSource(s);
    if (origin) void run(origin, searchRadius.current, s, filters.includeStairs);
  };

  const onFilters = (f: Filters) => {
    setFilters(f);
    // Stairs change which paths are searched, not just the ranking.
    if (origin && f.includeStairs !== filters.includeStairs) void run(origin, searchRadius.current, source, f.includeStairs);
  };

  const onAreaCommit = (f: Filters) => {
    const km = effectiveRadiusKm(f);
    if (origin && km > searchRadius.current) void run(origin, km, source, f.includeStairs);
  };
  const radiusKm = effectiveRadiusKm(filters);
  // Lighting and opening hours only come with the detailed source.
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

  // Re-measure the climbs on screen with LiDAR HD (see core/refine.ts). The
  // new stats can reorder the list and bring other climbs in, which are then
  // re-measured too; it settles within a round or two.
  useEffect(() => {
    if (!ranked || !candidates || status.kind !== 'done') return;
    const byId = new Map(candidates.map((c) => [c.id, c]));
    const todo = ranked.climbs
      .map((c) => byId.get(c.id))
      .filter((c): c is Climb => !!c && !c.refined && !refineTried.current.has(c.id));
    if (!todo.length) return;
    todo.forEach((c) => refineTried.current.add(c.id));
    const searchId = latest.current;
    const fail = (ids: string[]) => setUnrefinable((s) => new Set([...s, ...ids]));
    fineProfiles(todo.map((c) => c.coords))
      .then((results) => {
        if (searchId !== latest.current) return;
        const updated = new Map<string, Climb>();
        const failed: string[] = [];
        todo.forEach((c, i) => {
          const r = results[i];
          const refined = r ? refineClimb(c, r.ele, r.source) : null;
          if (refined) updated.set(c.id, refined);
          else failed.push(c.id);
        });
        setCandidates((list) => list?.map((c) => updated.get(c.id) ?? c) ?? list);
        if (failed.length) fail(failed);
      })
      .catch(() => fail(todo.map((c) => c.id)));
  }, [ranked, candidates, status.kind]);
  const measuring =
    status.kind === 'done' && !!ranked?.climbs.some((c) => !c.refined && !unrefinable.has(c.id));

  // Favourites, numbered in saved order, with distance from the current place.
  const favoriteClimbs = useMemo<RankedClimb[]>(
    () =>
      favorites.map((f, i) => ({
        ...f,
        rank: i + 1,
        distance: origin ? haversine(origin, f.coords[0]) : f.distance,
      })),
    [favorites, origin],
  );

  const shown = tab === 'favorites' ? favoriteClimbs : (ranked?.climbs ?? []);
  const selected = shown.find((c) => c.id === selectedId) ?? null;
  // The rep section of the selected climb, highlighted on the map.
  const selectedSession = useMemo(() => (selected ? suggestSession(selected) : null), [selected]);
  const selectedSection = selectedSession ? { from: selectedSession.from, to: selectedSession.to } : null;
  const loading = status.kind === 'loading';
  const hasResults = !!ranked && ranked.climbs.length > 0;

  return (
    <div className="app">
      <aside className="panel">
        <header className="header">
          <div className="title-row">
            <h1>
              ⛰ {t('app.name')}
              <small>{t('app.tagline')}</small>
            </h1>
            <LanguageSwitch />
          </div>
          <LocationBar onPlace={onPlace} recent={recent.filter((p) => !origin || haversine(p, origin) > 200)} />
          {!origin && (
            <button type="button" className="link" onClick={() => onPlace(RENNES)}>
              {t('location.tryExample', { place: 'Rennes' })}
            </button>
          )}
        </header>

        <FilterBar filters={filters} onChange={onFilters} onAreaCommit={onAreaCommit} source={source} onSource={onSource} />

        <nav className="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'results'} onClick={() => { setTab('results'); setSelectedId(null); }}>
            {t('tabs.results')}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'favorites'} onClick={() => { setTab('favorites'); setSelectedId(null); }}>
            ★ {t('tabs.favorites')} {favorites.length > 0 && <span className="badge">{favorites.length}</span>}
          </button>
        </nav>

        <div className="results" aria-live="polite">
          {selected ? (
            <ClimbDetail
              climb={selected}
              reach={filters.reach}
              detailed={hasLighting}
              showLit={hasLighting && filters.preferLit}
              favorite={isFavorite(selected)}
              onToggleFavorite={() => toggleFavorite(selected)}
              onBack={() => setSelectedId(null)}
            />
          ) : tab === 'favorites' ? (
            favoriteClimbs.length ? (
              <>
                <p className="muted">{t('favorites.note')}</p>
                <ClimbList climbs={favoriteClimbs} reach={filters.reach} onSelect={setSelectedId} isFavorite={isFavorite} onToggleFavorite={toggleFavorite} showScore={false} />
              </>
            ) : (
              <p className="empty">{t('favorites.empty')}</p>
            )
          ) : (
            <>
              {loading && (
                <SearchProgress
                  stage={status.stage}
                  pct={status.pct}
                  radiusKm={status.radiusKm}
                  compact={hasResults}
                  slowSource={source === 'detailed'}
                />
              )}
              {loading && status.nearbyKm && hasResults && (
                <p className="muted">{t('status.showingNearby', { km: fmtNum(status.nearbyKm, 1) })}</p>
              )}
              {status.kind === 'error' && (
                <p className="message" role="alert">
                  {status.message}{' '}
                  <button type="button" className="link" onClick={() => origin && run(origin, searchRadius.current, source, filters.includeStairs)}>
                    {t('status.retry')}
                  </button>
                </p>
              )}
              {ranked && (status.kind === 'done' || hasResults) && (
                <div className={loading ? 'updating' : undefined}>
                  {!loading &&
                    (ranked.climbs.length === 0 ? (
                      <p className="message">{t('status.empty')}</p>
                    ) : (
                      <p className="muted">
                        {t('status.found', { count: ranked.climbs.length, radius: fmtNum(radiusKm, radiusKm % 1 ? 1 : 0) })}
                        {ranked.relaxLevel > 0 && <> · {t('status.relaxed')}</>}
                      </p>
                    ))}
                  {measuring && (
                    <p className="measuring muted">
                      <span className="spinner" aria-hidden /> {t('status.measuring')}
                    </p>
                  )}
                  {status.kind === 'done' && status.partial && <p className="message">{t('status.partial')}</p>}
                  {!loading && ranked.hiddenRestricted > 0 && (
                    <p className="muted">{t('status.hidden', { count: ranked.hiddenRestricted })}</p>
                  )}
                  <ClimbList climbs={ranked.climbs} reach={filters.reach} onSelect={setSelectedId} isFavorite={isFavorite} onToggleFavorite={toggleFavorite} showScore />
                </div>
              )}
            </>
          )}
        </div>

        <footer className="footer muted">
          {t(`footer.data.${source}`)}
          {resolution && <> · {t('footer.resolution', { m: resolution.toFixed(0) })}</>}
        </footer>
      </aside>

      <div className="map-wrap">
        <Suspense fallback={<div className="map map-loading" />}>
          <MapView
            origin={origin}
            radiusKm={radiusKm}
            climbs={shown}
            selectedId={selectedId}
            section={selected ? selectedSection : null}
            searching={loading}
            onSelect={setSelectedId}
          />
        </Suspense>
        {/* On phones the list is below the fold: keep progress visible on the map. */}
        {loading && tab === 'results' && (
          <div className="map-pill" role="status">
            <span className="spinner" aria-hidden />
            {t(`status.${status.stage}`, { km: fmtNum(status.radiusKm, status.radiusKm % 1 ? 1 : 0) })}
            <span className="map-pill-pct">{Math.round(status.pct)}%</span>
          </div>
        )}
      </div>
    </div>
  );
}
