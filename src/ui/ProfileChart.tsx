/**
 * Elevation profile as a small SVG area chart, filled by gradient band so
 * the steep parts stand out. Hand-drawn to avoid a chart dependency.
 */
import type { Climb } from '../core/types';
import { gradeColor } from './format';

const W = 320;
const H = 140;
const PAD = { left: 34, right: 8, top: 8, bottom: 22 };

export function ProfileChart({ climb, label }: { climb: Climb; label: string }) {
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

  // One filled quad per ~25 m piece, coloured by that piece's gradient.
  const step = 5;
  const pieces = [];
  for (let i = 0; i < dist.length - 1; i += step) {
    const j = Math.min(i + step, dist.length - 1);
    const grade = ((ele[j] - ele[i]) / Math.max(1, dist[j] - dist[i])) * 100;
    const pts = [];
    for (let k = i; k <= j; k++) pts.push(`${x(dist[k])},${y(ele[k])}`);
    pieces.push(
      <polygon
        key={i}
        points={`${x(dist[i])},${base} ${pts.join(' ')} ${x(dist[j])},${base}`}
        fill={gradeColor(grade)}
        opacity={0.85}
      />,
    );
  }
  const line = dist.map((d, i) => `${x(d)},${y(ele[i])}`).join(' ');
  const yTicks = [Math.ceil(yMin), Math.round((yMin + yMax) / 2), Math.floor(yMax)];
  const xTicks = [0, maxD / 2, maxD];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="profile" role="img" aria-label={label}>
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
          {Math.round(d)} m
        </text>
      ))}
    </svg>
  );
}
