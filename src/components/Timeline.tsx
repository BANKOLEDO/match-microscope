import { palette } from '../lib/colors';
import type { ChartsFile, MatchEvent } from '../lib/data';
import { formatT } from '../lib/format';

interface TimelineProps {
  frameIdx: number;
  frameCount: number;
  fps: number;
  duration: number;
  charts: ChartsFile;
  events: MatchEvent[];
  annotationTimes: number[];
  onSeek: (idx: number) => void;
  playing: boolean;
  onTogglePlay: () => void;
}

const W = 600;
const H = 44;

function pathFor(series: { t: number; v: number }[], max: number): string {
  const pts = series.map((p, i) => {
    const x = (i / Math.max(series.length - 1, 1)) * W;
    const y = H - 8 - (Math.min(p.v, max) / max) * (H - 18);
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return pts.join(' ');
}

export default function Timeline(props: TimelineProps) {
  const { frameIdx, frameCount, fps, duration, charts, events, annotationTimes, onSeek, playing, onTogglePlay } = props;
  const maxMom = Math.max(1, ...charts.momentum.map((m) => Math.max(m.home, m.away)));
  const maxP = Math.max(0.5, ...charts.pressure.map((p) => p.v));
  const toX = (t: number) => (t / duration) * W;
  const playX = (frameIdx / Math.max(frameCount - 1, 1)) * W;

  const clickSeek = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    onSeek(Math.round(ratio * (frameCount - 1)));
  };

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        onClick={clickSeek}
        role="slider"
        aria-label="match timeline"
        aria-valuemin={0}
        aria-valuemax={frameCount - 1}
        aria-valuenow={frameIdx}
        style={{ width: '100%', height: 'auto', display: 'block', cursor: 'pointer' }}
      >
        <path
          d={pathFor(charts.momentum.map((m) => ({ t: m.t, v: m.home })), maxMom)}
          fill="none"
          stroke={palette.textPrimary}
          strokeWidth={1.5}
          opacity={0.85}
        />
        <path
          d={pathFor(charts.momentum.map((m) => ({ t: m.t, v: m.away })), maxMom)}
          fill="none"
          stroke={palette.accent}
          strokeWidth={1.5}
          opacity={0.85}
        />
        <path
          d={pathFor(charts.pressure, maxP)}
          fill="none"
          stroke={palette.danger}
          strokeWidth={1}
          opacity={0.4}
        />
        {annotationTimes.map((t) => (
          <line key={t} x1={toX(t)} y1={H - 8} x2={toX(t)} y2={H - 2} stroke={palette.accentDim} strokeWidth={1} />
        ))}
        {events
          .filter((e) => e.type === 'goal')
          .map((e) => (
            <circle key={e.id} cx={toX(e.t)} cy={6} r={3} fill={palette.accent} />
          ))}
        {events
          .filter((e) => e.type === 'shot')
          .map((e) => (
            <circle key={e.id} cx={toX(e.t)} cy={6} r={1.6} fill="none" stroke={palette.textMuted} strokeWidth={1} />
          ))}
        <line x1={playX} y1={0} x2={playX} y2={H} stroke={palette.accent} strokeWidth={1} />
      </svg>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button type="button" onClick={onTogglePlay} aria-label={playing ? 'pause' : 'play'}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <input
          type="range"
          min={0}
          max={frameCount - 1}
          value={frameIdx}
          onChange={(e) => onSeek(Number(e.target.value))}
          aria-label="scrub match"
          style={{ flex: 1, accentColor: palette.accent }}
        />
        <span className="mono" style={{ color: palette.textMuted, minWidth: 96 }}>
          {formatT(frameIdx / fps)} / {formatT(duration)}
        </span>
      </div>
      <div className="mono legend-row">
        <span style={{ color: palette.accent }}>●</span> goal&nbsp;&nbsp;
        <span style={{ color: palette.textMuted }}>○</span> shot&nbsp;&nbsp;
        <span style={{ color: palette.accentDim }}>|</span> key moment — drag, click the chart, or press ← →
      </div>
    </div>
  );
}
