import { useTranslation } from 'react-i18next';
import type { RankedClimb } from '../core/scoring';
import { suggestSession } from '../core/session';
import { climbName, fmtDuration, fmtGrade, fmtKm, fmtM, surfaceLabel } from './format';
import { ProfileChart } from './ProfileChart';

interface Props {
  climb: RankedClimb;
  onBack: () => void;
}

export function ClimbDetail({ climb, onBack }: Props) {
  const { t } = useTranslation();
  const session = suggestSession(climb);
  const start = climb.coords[0];
  // Walking directions to the bottom of the hill, on openstreetmap.org.
  const directions = `https://www.openstreetmap.org/directions?engine=fossgis_osrm_foot&route=;${start.lat},${start.lon}`;

  return (
    <article className="climb-detail">
      <button type="button" className="link back" onClick={onBack}>
        ← {t('climb.back')}
      </button>
      <h2>
        <span className="rank-inline">#{climb.rank}</span> {climbName(climb, t)}
      </h2>
      <p className="climb-meta">
        {t('climb.away', { km: fmtKm(climb.distance) })} · {surfaceLabel(climb, t)} ·{' '}
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
          {t(`session.${session.kind}`, { reps: session.reps, length: session.repLength, grade: session.avgGrade })}
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
