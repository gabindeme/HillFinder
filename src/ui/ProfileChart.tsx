/**
 * Elevation profile as an SVG area chart, filled by gradient band so the
 * steep parts stand out. Touch or hover to read distance, elevation and the
 * local gradient at any point; the suggested rep section is shaded.
 * Hand-drawn to avoid a chart dependency.
 */
import { useState, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { Climb } from '../core/types';
import { fmtGrade, fmtNum, gradeColor, GRADE_BANDS } from './format';

const W = 320;
const H = 150;
const PAD = { left: 34, right: 8, top: 22, bottom: 22 };
/** Local gradient readout window: ±10 m around the cursor. */
const READOUT_HALF_WINDOW = 10;

interface Props {
  climb: Climb;
  label: string;
  /** Rep section to shade, metres from the bottom. */
  section: { from: number; to: number } | null;
}

export function ProfileChart({ climb, label, section }: Props) {
  const { t } = useTranslation();
  const [cursor, setCursor] = useState<number | null>(null);
  const { dist, ele } = climb.profile;
  const maxD = dist[dist.length - 1];
  const lo = Math.min(...ele);
  const hi = Math.max(...ele);
  // Keep at least 10 m of vertical range so tiny hills don't look like walls.
  const span = Math.max(10, hi - lo);
  const yMin = lo - span * 0.1;
  const yMax = yMin + span * 1.2;
  const x = (d: number) => PAD.left + (d / maxD) * (W - PAD.left - PAD.right);
  const y = (e: number) => PAD.top + (1 - (e - yMin) / (yMax - yMin)) * (H - PAD.top - PAD.bottom);
  const base = H - PAD.bottom;

  // One filled shape per ~25 m piece, coloured by that piece's gradient.
  const step = 5;
  const pieces = [];
  for (let i = 0; i < dist.length - 1; i += step) {
    const j = Math.min(i + step, dist.length - 1);
    const grade = ((ele[j] - ele[i]) / Math.max(1, dist[j] - dist[i])) * 100;
    const pts = [];
    for (let k = i; k <= j; k++) pts.push(`${x(dist[k])},${y(ele[k])}`);
    pieces.push(
      <polygon key={i} points={`${x(dist[i])},${base} ${pts.join(' ')} ${x(dist[j])},${base}`} fill={gradeColor(grade)} opacity={0.85} />,
    );
  }
  const line = dist.map((d, i) => `${x(d)},${y(ele[i])}`).join(' ');
  const yTicks = [Math.ceil(yMin), Math.round((yMin + yMax) / 2), Math.floor(yMax)];
  const xTicks = [0, maxD / 2, maxD];

  const onPointer = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    const d = Math.min(maxD, Math.max(0, ((px - PAD.left) / (W - PAD.left - PAD.right)) * maxD));
    // Nearest sample (samples are evenly spaced).
    setCursor(Math.round((d / maxD) * (dist.length - 1)));
  };

  let readout = null;
  if (cursor !== null) {
    const a = dist.findIndex((d) => d >= dist[cursor] - READOUT_HALF_WINDOW);
    let b = dist.findIndex((d) => d >= dist[cursor] + READOUT_HALF_WINDOW);
    if (b === -1) b = dist.length - 1;
    const grade = ((ele[b] - ele[a]) / Math.max(1, dist[b] - dist[a])) * 100;
    const cx = x(dist[cursor]);
    const text = `${fmtNum(dist[cursor])} m · ${fmtNum(ele[cursor], 1)} m · ${fmtGrade(grade)}`;
    // Keep the label inside the chart.
    const boxW = 150;
    const bx = Math.min(W - PAD.right - boxW, Math.max(PAD.left, cx - boxW / 2));
    readout = (
      <g className="readout" pointerEvents="none">
        <line x1={cx} x2={cx} y1={PAD.top} y2={base} />
        <circle cx={cx} cy={y(ele[cursor])} r={3.5} />
        <rect x={bx} y={2} width={boxW} height={16} rx={4} />
        <text x={bx + boxW / 2} y={13.5} textAnchor="middle">
          {text}
        </text>
      </g>
    );
  }

  return (
    <figure className="profile-figure">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="profile"
        role="img"
        aria-label={label}
        onPointerMove={onPointer}
        onPointerDown={onPointer}
        onPointerLeave={() => setCursor(null)}
      >
        {section && (
          <g className="section-band">
            <rect x={x(section.from)} y={PAD.top} width={x(section.to) - x(section.from)} height={base - PAD.top} />
            <text x={(x(section.from) + x(section.to)) / 2} y={PAD.top + 10} textAnchor="middle">
              {t('chart.rep')}
            </text>
          </g>
        )}
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} className="grid" />
            <text x={PAD.left - 4} y={y(v) + 3} textAnchor="end">
              {v}
            </text>
          </g>
        ))}
        {pieces}
        <polyline points={line} fill="none" className="profile-line" />
        {xTicks.map((d, i) => (
          <text key={i} x={x(d)} y={H - 6} textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}>
            {fmtNum(d)} m
          </text>
        ))}
        {readout}
      </svg>
      <figcaption className="grade-legend">
        {GRADE_BANDS.map((b) => (
          <span key={b.label}>
            <i style={{ background: b.color }} />
            {b.label}
          </span>
        ))}
        <span className="muted">{t('chart.hint')}</span>
      </figcaption>
    </figure>
  );
}
