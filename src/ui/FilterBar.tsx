/**
 * Search filters: the search area and ranking priority are always visible;
 * everything else lives in a collapsible "More filters" panel.
 */
import { useTranslation } from 'react-i18next';
import {
  activeFilterCount,
  DEFAULT_FILTERS,
  effectiveRadiusKm,
  MINUTES_RANGE,
  RADIUS_RANGE,
  type Filters,
  type Priority,
  type Reach,
  type Surface,
} from '../core/filters';
import type { DataSource } from '../worker/protocol';

const PRIORITIES: Priority[] = ['balanced', 'steepest', 'longest', 'gain', 'closest', 'trail'];
const REACHES: Reach[] = ['distance', 'foot', 'bike'];
const SURFACES: Surface[] = ['any', 'trail', 'road'];
const SOURCES: DataSource[] = ['fast', 'detailed'];

interface Props {
  filters: Filters;
  onChange: (f: Filters) => void;
  /** Called when the user lets go of a control that changes the search area. */
  onAreaCommit: (f: Filters) => void;
  source: DataSource;
  onSource: (s: DataSource) => void;
}

export function FilterBar({ filters, onChange, onAreaCommit, source, onSource }: Props) {
  // Only OSM's `lit` tag (detailed source) tells us about lighting.
  const hasLighting = source === 'detailed';
  const { t } = useTranslation();
  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => onChange({ ...filters, [key]: value });
  const commit = (patch: Partial<Filters>) => onAreaCommit({ ...filters, ...patch });
  const byTime = filters.reach !== 'distance';
  const active = activeFilterCount(filters);

  return (
    <div className="filters">
      <div className="filters-main">
        <fieldset className="segmented" aria-label={t('filters.reach')}>
          {REACHES.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={filters.reach === r}
              onClick={() => {
                onChange({ ...filters, reach: r });
                commit({ reach: r });
              }}
            >
              {t(`filters.reaches.${r}`)}
            </button>
          ))}
        </fieldset>

        {byTime ? (
          <label className="range">
            <span>
              {t('filters.travelTime')} <strong>{t('filters.minutes', { n: filters.travelMinutes })}</strong>{' '}
              <span className="muted">{t('filters.approxRadius', { km: effectiveRadiusKm(filters) })}</span>
            </span>
            <input
              type="range"
              min={MINUTES_RANGE.min}
              max={MINUTES_RANGE.max}
              step={5}
              value={filters.travelMinutes}
              onChange={(e) => set('travelMinutes', Number(e.target.value))}
              onPointerUp={(e) => commit({ travelMinutes: Number(e.currentTarget.value) })}
              onKeyUp={(e) => commit({ travelMinutes: Number(e.currentTarget.value) })}
            />
          </label>
        ) : (
          <label className="range">
            <span>
              {t('filters.radius')} <strong>{filters.radiusKm} km</strong>
            </span>
            <input
              type="range"
              min={RADIUS_RANGE.min}
              max={RADIUS_RANGE.max}
              step={1}
              value={filters.radiusKm}
              onChange={(e) => set('radiusKm', Number(e.target.value))}
              onPointerUp={(e) => commit({ radiusKm: Number(e.currentTarget.value) })}
              onKeyUp={(e) => commit({ radiusKm: Number(e.currentTarget.value) })}
            />
          </label>
        )}

        <label className="priority">
          <span>{t('filters.priority')}</span>
          <select value={filters.priority} onChange={(e) => set('priority', e.target.value as Priority)}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {t(`filters.priorities.${p}`)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <details className="more-filters">
        <summary>
          {t('filters.more')}
          {active > 0 && <span className="badge">{active}</span>}
        </summary>

        <div className="more-grid">
          <MinMax
            label={t('filters.length')}
            unit="m"
            min={filters.minLength}
            max={filters.maxLength}
            step={10}
            onMin={(v) => set('minLength', v)}
            onMax={(v) => set('maxLength', v)}
          />
          <MinMax
            label={t('filters.avgGrade')}
            unit="%"
            min={filters.minAvgGrade}
            max={filters.maxAvgGrade}
            step={0.5}
            onMin={(v) => set('minAvgGrade', v)}
            onMax={(v) => set('maxAvgGrade', v)}
          />

          <label className="field">
            <span>{t('filters.minGain')}</span>
            <NumberInput value={filters.minGain} step={1} unit="m" onChange={(v) => set('minGain', v)} />
          </label>

          <div className="field">
            <label className="check">
              <input
                type="checkbox"
                checked={filters.maxGrade !== null}
                onChange={(e) => set('maxGrade', e.target.checked ? 15 : null)}
              />
              <span>{t('filters.maxGrade')}</span>
            </label>
            {filters.maxGrade !== null && (
              <NumberInput value={filters.maxGrade} step={1} unit="%" onChange={(v) => set('maxGrade', v)} />
            )}
          </div>

          <fieldset className="field">
            <legend>{t('filters.surface')}</legend>
            <div className="segmented">
              {SURFACES.map((s) => (
                <button key={s} type="button" aria-pressed={filters.surface === s} onClick={() => set('surface', s)}>
                  {t(`filters.surfaces.${s}`)}
                </button>
              ))}
            </div>
          </fieldset>

          <label className="check wide">
            <input type="checkbox" checked={filters.avoidTraffic} onChange={(e) => set('avoidTraffic', e.target.checked)} />
            <span>
              {t('filters.avoidTraffic')}
              <small className="muted">{t('filters.avoidTrafficHint')}</small>
            </span>
          </label>

          <label className={`check wide${hasLighting ? '' : ' disabled'}`}>
            <input
              type="checkbox"
              checked={filters.preferLit && hasLighting}
              disabled={!hasLighting}
              onChange={(e) => set('preferLit', e.target.checked)}
            />
            <span>
              {t('filters.preferLit')}
              <small className="muted">{hasLighting ? t('filters.preferLitHint') : t('filters.noLighting')}</small>
            </span>
          </label>
        </div>

        <button
          type="button"
          className="link"
          onClick={() => onChange({ ...DEFAULT_FILTERS, reach: filters.reach, radiusKm: filters.radiusKm, travelMinutes: filters.travelMinutes, priority: filters.priority })}
          disabled={active === 0}
        >
          {t('filters.reset')}
        </button>

        <fieldset className="field source">
          <legend>{t('filters.source')}</legend>
          <div className="segmented">
            {SOURCES.map((s) => (
              <button key={s} type="button" aria-pressed={source === s} onClick={() => onSource(s)}>
                {t(`filters.sources.${s}`)}
              </button>
            ))}
          </div>
          <small className="muted">{t(`filters.sourceHints.${source}`)}</small>
        </fieldset>
      </details>
    </div>
  );
}

function MinMax(props: {
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  onMin: (v: number) => void;
  onMax: (v: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <fieldset className="field">
      <legend>{props.label}</legend>
      <div className="minmax">
        <NumberInput value={props.min} step={props.step} unit={props.unit} label={t('filters.min')} onChange={props.onMin} />
        <span aria-hidden>–</span>
        <NumberInput value={props.max} step={props.step} unit={props.unit} label={t('filters.max')} onChange={props.onMax} />
      </div>
    </fieldset>
  );
}

/** Numeric input that ignores empty/invalid text instead of writing NaN into the filters. */
function NumberInput(props: { value: number; step: number; unit: string; label?: string; onChange: (v: number) => void }) {
  return (
    <span className="number">
      <input
        type="number"
        inputMode="decimal"
        min={0}
        step={props.step}
        defaultValue={props.value}
        key={props.value /* resync when changed elsewhere, e.g. reset */}
        aria-label={props.label}
        onBlur={(e) => {
          const v = Number(e.target.value);
          if (e.target.value !== '' && Number.isFinite(v) && v >= 0) props.onChange(v);
          else e.target.value = String(props.value);
        }}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      <span className="unit">{props.unit}</span>
    </span>
  );
}
