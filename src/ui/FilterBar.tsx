/** MVP filters: radius and ranking priority. Advanced filters come next. */
import { useTranslation } from 'react-i18next';
import { RADIUS_RANGE, type Filters, type Priority } from '../core/filters';

const PRIORITIES: Priority[] = ['balanced', 'steepest', 'longest', 'gain', 'closest', 'trail'];

interface Props {
  filters: Filters;
  onChange: (f: Filters) => void;
  /** Called when the user lets go of the radius slider. */
  onRadiusCommit: (km: number) => void;
}

export function FilterBar({ filters, onChange, onRadiusCommit }: Props) {
  const { t } = useTranslation();
  return (
    <div className="filters">
      <label className="radius">
        <span>
          {t('filters.radius')} <strong>{filters.radiusKm} km</strong>
        </span>
        <input
          type="range"
          min={RADIUS_RANGE.min}
          max={RADIUS_RANGE.max}
          step={1}
          value={filters.radiusKm}
          onChange={(e) => onChange({ ...filters, radiusKm: Number(e.target.value) })}
          onPointerUp={(e) => onRadiusCommit(Number(e.currentTarget.value))}
          onKeyUp={(e) => onRadiusCommit(Number(e.currentTarget.value))}
        />
      </label>
      <label className="priority">
        <span>{t('filters.priority')}</span>
        <select
          value={filters.priority}
          onChange={(e) => onChange({ ...filters, priority: e.target.value as Priority })}
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {t(`filters.priorities.${p}`)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
