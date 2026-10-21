import { useTranslation } from 'react-i18next';
import type { Reach } from '../core/filters';
import type { RankedClimb } from '../core/scoring';
import { climbName, fmtAway, fmtGrade, fmtM, gradeColor, surfaceLabel } from './format';

interface Props {
  climbs: RankedClimb[];
  reach: Reach;
  onSelect: (id: string) => void;
}

export function ClimbList({ climbs, reach, onSelect }: Props) {
  const { t } = useTranslation();
  return (
    <ol className="climb-list">
      {climbs.map((c) => (
        <li key={c.id}>
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
              </span>
            </span>
            <span className="score" title={t('climb.score')}>
              {Math.round(c.score)}
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}
