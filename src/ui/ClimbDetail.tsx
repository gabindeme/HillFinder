import { useTranslation } from 'react-i18next';
import type { Reach } from '../core/filters';
import type { RankedClimb } from '../core/scoring';
import { suggestSession } from '../core/session';
import { climbName, fmtAway, fmtDuration, fmtGrade, fmtM, fmtNum, surfaceLabel } from './format';
import { StarButton } from './ClimbList';
import { ProfileChart } from './ProfileChart';

interface Props {
  climb: RankedClimb;
  reach: Reach;
  /** The data source has lighting, opening hours and gates (detailed mode). */
  detailed: boolean;
  /** Show the share of lit path. */
  showLit: boolean;
  favorite: boolean;
  onToggleFavorite: () => void;
  onBack: () => void;
}

export function ClimbDetail({ climb, reach, detailed, showLit, favorite, onToggleFavorite, onBack }: Props) {
  const { t } = useTranslation();
  const session = suggestSession(climb);
  const start = climb.coords[0];
  const mid = climb.coords[Math.floor(climb.coords.length / 2)];
  // Walking directions to the bottom of the hill, on openstreetmap.org.
  const directions = `https://www.openstreetmap.org/directions?engine=fossgis_osrm_foot&route=;${start.lat},${start.lon}`;

  return (
    <article className="climb-detail">
      <div className="detail-top">
        <button type="button" className="link back" onClick={onBack}>
          ← {t('climb.back')}
        </button>
        <StarButton on={favorite} onClick={onToggleFavorite} label />
      </div>
      <h2>
        <span className="rank-inline">#{climb.rank}</span> {climbName(climb, t)}
      </h2>
      <p className="climb-meta">
        {fmtAway(climb, reach, t)} · {surfaceLabel(climb, t)} ·{' '}
        {showLit && <>{t('climb.lit', { pct: Math.round(climb.lit * 100) })} · </>}
        <a href={directions} target="_blank" rel="noreferrer">
          {t('climb.openMaps')}
        </a>
      </p>

      <dl className="stats">
        <div>
          <dt>{t('climb.length')}</dt>
          <dd>{fmtM(climb.length)}</dd>
        </div>
        <div>
          <dt>{t('climb.gain')}</dt>
          <dd>+{fmtM(climb.gain)}</dd>
        </div>
        <div>
          <dt>{t('climb.avgGrade')}</dt>
          <dd>{fmtGrade(climb.avgGrade)}</dd>
        </div>
        <div>
          <dt>{t('climb.maxGrade')}</dt>
          <dd>{fmtGrade(climb.maxGrade)}</dd>
        </div>
      </dl>

      <ProfileChart climb={climb} label={t('climb.profile')} />

      <section className="session">
        <h3>{t('session.title')}</h3>
        <p className="session-main">
          {t(`session.${session.kind}`, { reps: session.reps, length: session.repLength, grade: fmtNum(session.avgGrade, 1) })}
        </p>
        <p className="muted">
          {t('session.detail', {
            time: fmtDuration(session.repSeconds),
            gain: session.repGain,
            total: session.repGain * session.reps,
          })}{' '}
          {t('session.warmup')}
        </p>
      </section>

      <section className="access">
        <h3>{t('access.title')}</h3>
        {climb.access?.hours ? (
          <p className="message">🕗 {t('access.hours', { hours: climb.access.hours })}</p>
        ) : (
          <p>
            {t('access.clear')} {!detailed && <span className="muted">{t('access.noHoursCheck')}</span>}
          </p>
        )}
        <p className="muted">
          {t('access.disclaimer')}{' '}
          <a href={`https://www.openstreetmap.org/#map=18/${mid.lat}/${mid.lon}`} target="_blank" rel="noreferrer">
            {t('access.view')}
          </a>{' '}
          ·{' '}
          <a href={`https://www.openstreetmap.org/note/new#map=18/${mid.lat}/${mid.lon}`} target="_blank" rel="noreferrer">
            {t('access.report')}
          </a>
        </p>
      </section>

      <section className="breakdown">
        <h3>
          {t('climb.why')} · {Math.round(climb.score)}/100
        </h3>
        <ul>
          {climb.factors.map((f) => (
            <li key={f.key}>
              <span className="factor-name">{t(`factors.${f.key}`)}</span>
              {/* The bar shows how well the climb does on this factor (0–100%);
                  the numbers show the points earned out of the factor's weight. */}
              <span className="bar" aria-hidden>
                <span className="bar-fill" style={{ width: `${f.value * 100}%` }} />
              </span>
              <span className="factor-points">
                {f.points.toFixed(0)}/{(f.weight * 100).toFixed(0)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}
