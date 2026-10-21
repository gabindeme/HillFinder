/**
 * Search feedback that makes waiting feel shorter: a progress bar that only
 * moves forward, a plain-language step, and placeholder cards in the shape of
 * the results while nothing is on screen yet.
 */
import { useTranslation } from 'react-i18next';
import type { SearchStage } from '../worker/protocol';
import { fmtNum } from './format';

interface Props {
  stage: SearchStage;
  /** 0–100, see progress.ts. */
  pct: number;
  radiusKm: number;
  /** Results are already on screen (previous or nearby): show a slim bar only. */
  compact: boolean;
  /** Detailed (Overpass) searches can be slow on first use: say so. */
  slowSource: boolean;
}

export function SearchProgress({ stage, pct, radiusKm, compact, slowSource }: Props) {
  const { t } = useTranslation();
  return (
    <div className={`search-progress${compact ? ' compact' : ''}`} role="status">
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${Math.max(3, pct)}%` }} />
      </div>
      <p className="progress-label">
        {t(`status.${stage}`, { km: fmtNum(radiusKm, radiusKm % 1 ? 1 : 0) })}
        {slowSource && stage !== 'analysis' && !compact && <span className="muted"> {t('status.slow')}</span>}
      </p>
      {!compact && (
        <ul className="skeleton-list" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <li key={i} className="skeleton-card">
              <span className="sk-dot" />
              <span className="sk-lines">
                <span className="sk-line" style={{ width: `${70 - i * 8}%` }} />
                <span className="sk-line short" />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
