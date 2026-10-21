import { useTranslation } from 'react-i18next';
import type { Reach } from '../core/filters';
import { reliability } from '../core/refine';
import type { RankedClimb } from '../core/scoring';
import { climbName, fmtAway, fmtGrade, fmtM, gradeColor, surfaceLabel } from './format';

interface Props {
  climbs: RankedClimb[];
  reach: Reach;
  onSelect: (id: string) => void;
  isFavorite: (c: RankedClimb) => boolean;
  onToggleFavorite: (c: RankedClimb) => void;
  /** Scores only make sense within one search; favourites hide them. */
  showScore: boolean;
}

export function ClimbList({ climbs, reach, onSelect, isFavorite, onToggleFavorite, showScore }: Props) {
  const { t } = useTranslation();
  return (
    <ol className="climb-list">
      {climbs.map((c) => (
        <li key={c.id} className="climb-item">
          <button type="button" className="climb-card" onClick={() => onSelect(c.id)}>
            <span className="rank" style={{ background: gradeColor(c.avgGrade) }}>
              {c.rank}
            </span>
            <span className="climb-main">
              <span className="climb-name">{climbName(c, t)}</span>
              <span className="climb-stats">
                {fmtM(c.length)} · +{fmtM(c.gain)} · {fmtGrade(c.avgGrade)} ({t('climb.maxGrade')}{' '}
                {fmtGrade(c.maxGrade)})
              </span>
              <span className="climb-meta">
                {fmtAway(c, reach, t)} · {surfaceLabel(c, t)}
                {c.access?.hours && <span className="tag">🕗 {t('access.hoursBadge')}</span>}
                {(c.stairs ?? 0) >= 0.5 && <span className="tag stairs">🪜 {t('climb.stairsBadge')}</span>}
                {reliability(c).level === 'check' && <span className="tag warn">⚠ {t('accuracy.badge')}</span>}
              </span>
            </span>
            {showScore && (
              <span className="score" title={t('climb.score')}>
                {Math.round(c.score)}
              </span>
            )}
          </button>
          <StarButton on={isFavorite(c)} onClick={() => onToggleFavorite(c)} />
        </li>
      ))}
    </ol>
  );
}

export function StarButton({ on, onClick, label }: { on: boolean; onClick: () => void; label?: boolean }) {
  const { t } = useTranslation();
  const text = on ? t('favorites.remove') : t('favorites.add');
  return (
    <button type="button" className={`star${on ? ' on' : ''}${label ? ' with-label' : ''}`} aria-pressed={on} aria-label={text} title={text} onClick={onClick}>
      {on ? '★' : '☆'}
      {label && <span>{on ? t('favorites.saved') : t('favorites.save')}</span>}
    </button>
  );
}
