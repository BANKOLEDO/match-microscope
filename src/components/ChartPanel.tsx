import { useMemo } from 'react';
import { palette } from '../lib/colors';
import type { ChartsFile, Frame } from '../lib/data';
import { PITCH_H, PITCH_W, averagePositions } from '../lib/geometry';
import { playerName } from '../lib/names';

interface ChartPanelProps {
  charts: ChartsFile;
  frames: Frame[];
  homeId: string;
  awayId: string;
  homeName: string;
  awayName: string;
  currentT: number;
  fps: number;
  duration: number;
  onSeek: (idx: number) => void;
  compact?: boolean;
}

function MiniMomentum({
  charts,
  currentT,
  fps,
  duration,
  onSeek,
}: {
  charts: ChartsFile;
  currentT: number;
  fps: number;
  duration: number;
  onSeek: (i: number) => void;
}) {
  const W = 300;
  const H = 72;
  const max = Math.max(1, ...charts.momentum.map((m) => Math.max(m.home, m.away)));
  const xy = (i: number, v: number) => `${((i / (charts.momentum.length - 1)) * W).toFixed(1)},${(H - 6 - (v / max) * (H - 16)).toFixed(1)}`;
  const line = (key: 'home' | 'away') =>
    charts.momentum.map((m, i) => `${i === 0 ? 'M' : 'L'}${xy(i, m[key])}`).join(' ');
  const playX = (currentT / duration) * W;
  const seekRatio = (ratio: number) => {
    const last = charts.momentum.length - 1;
    if (last < 0) return;
    const t = charts.momentum[Math.round(ratio * last)]?.t ?? ratio * duration;
    onSeek(Math.round(t * fps));
  };
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      onClick={(e) => {
        const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
        seekRatio((e.clientX - rect.left) / rect.width);
      }}
      style={{ width: '100%', height: 'auto', display: 'block', cursor: 'pointer' }}
      role="img"
      aria-label="momentum chart, click to seek"
    >
      <path d={line('home')} fill="none" stroke={palette.textPrimary} strokeWidth={1.5} />
      <path d={line('away')} fill="none" stroke={palette.accent} strokeWidth={1.5} />
      <line x1={playX} y1={0} x2={playX} y2={H} stroke={palette.accentDim} strokeWidth={1} />
    </svg>
  );
}

export default function ChartPanel({ charts, frames, homeId, awayId, homeName, awayName, currentT, fps, duration, onSeek, compact }: ChartPanelProps) {
  const avg = useMemo(() => averagePositions(frames), [frames]);
  const maxPasses = Math.max(1, ...charts.pass_network.nodes.map((n) => n.passes));
  const maxLink = Math.max(1, ...charts.pass_network.links.map((l) => l.count));
  const W = 300;
  const H = 196;
  const scaleX = (x: number) => (x / PITCH_W) * W;
  const scaleY = (y: number) => H - (y / PITCH_H) * H;
  const topLinks = charts.pass_network.links.slice(0, 24);
  const teamOf = useMemo(() => {
    const m = new Map<string, string>();
    charts.pass_network.nodes.forEach((n) => m.set(n.id, n.team));
    return m;
  }, [charts.pass_network.nodes]);
  const topPasser = useMemo(
    () => [...charts.pass_network.nodes].sort((a, b) => b.passes - a.passes)[0] ?? null,
    [charts.pass_network.nodes],
  );
  const cx = scaleX(PITCH_W / 2);
  const cy = scaleY(PITCH_H / 2);
  const last = charts.xg_cum[charts.xg_cum.length - 1];

  const passMap = (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="pass map">
      <rect x={0} y={0} width={W} height={H} fill={palette.pitchGreen} />
      <rect x={4} y={4} width={W - 8} height={H - 8} fill="none" stroke={palette.pitchLine} strokeWidth={1} />
      <line x1={cx} y1={4} x2={cx} y2={H - 4} stroke={palette.pitchLine} strokeWidth={1} />
      <circle cx={cx} cy={cy} r={22} fill="none" stroke={palette.pitchLine} strokeWidth={1} />
      {topLinks.map((l) => {
        const a = avg.get(l.source);
        const b = avg.get(l.dst);
        if (!a || !b) return null;
        const isHome = teamOf.get(l.source) === homeId;
        return (
          <line
            key={`${l.source}-${l.dst}`}
            x1={scaleX(a.x)}
            y1={scaleY(a.y)}
            x2={scaleX(b.x)}
            y2={scaleY(b.y)}
            stroke={isHome ? palette.textPrimary : palette.accent}
            strokeWidth={0.8 + (l.count / maxLink) * 3}
            opacity={0.28 + (l.count / maxLink) * 0.5}
            strokeLinecap="round"
          />
        );
      })}
      {charts.pass_network.nodes.map((n) => {
        const a = avg.get(n.id);
        if (!a) return null;
        const r = 3.5 + (n.passes / maxPasses) * 6;
        const isHome = n.team === homeId;
        return (
          <g key={n.id}>
            <title>
              {playerName(n.id)} · {n.passes} passes
            </title>
            <circle
              cx={scaleX(a.x)}
              cy={scaleY(a.y)}
              r={r}
              fill={isHome ? palette.textPrimary : palette.bgBase}
              stroke={isHome ? palette.bgBase : palette.accent}
              strokeWidth={1.5}
            />
            <text
              x={scaleX(a.x)}
              y={scaleY(a.y) + 3}
              fontSize={8}
              textAnchor="middle"
              fill={isHome ? palette.bgBase : palette.accent}
              fontFamily="JetBrains Mono, monospace"
              fontWeight="700"
            >
              {n.id.split('-').pop()}
            </text>
          </g>
        );
      })}
    </svg>
  );

  return (
    <div className={compact ? 'chart-wrap compact' : 'chart-wrap'}>
      {compact ? (
        <div className="mono facts-line">
          <span style={{ color: palette.textMuted }}>Ball at feet</span>{' '}
          {homeId} {Math.round((charts.possession?.[homeId] ?? 0) * 100)}% – {Math.round((charts.possession?.[awayId] ?? 0) * 100)}% {awayId}
          <span style={{ color: palette.textDim }}> · {charts.xg_cum.length} shots</span>
          <span style={{ color: palette.textDim }}>
            {' '}
            · goal chance {last ? `${last.home.toFixed(2)}–${last.away.toFixed(2)}` : '0.00–0.00'}
          </span>
        </div>
      ) : (
        <section>
          <h3 className="display sec-h">Match facts</h3>
          <div className="subhead">The whole story in three lines.</div>
          <div className="mono" style={{ fontSize: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: palette.textMuted }}>ball at feet</span>
              <span>
                {homeId} {Math.round((charts.possession?.[homeId] ?? 0) * 100)}% – {Math.round((charts.possession?.[awayId] ?? 0) * 100)}% {awayId}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: palette.textMuted }}>shots</span>
              <span>{charts.xg_cum.length}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: palette.textMuted }}>goal chance</span>
              <span>{last ? `${last.home.toFixed(2)}–${last.away.toFixed(2)}` : '0.00–0.00'}</span>
            </div>
          </div>
        </section>
      )}

      <section className="passmap-sec">
        <h3 className="display sec-h">Pass map</h3>
        <div className="subhead">
          Each dot is a player. A thicker line means more passes between two of them; a bigger dot means that player
          moved the ball more.
        </div>
        <div className="mono legend-row">
          <span style={{ color: palette.textPrimary }}>●</span> {homeName}
          <span style={{ color: palette.accent, marginLeft: 12 }}>●</span> {awayName}
          {topPasser && (
            <span style={{ color: palette.textMuted, marginLeft: 12 }}>
              most passes: {playerName(topPasser.id)}
            </span>
          )}
        </div>
        <div className="passmap-wrap">{passMap}</div>
      </section>

      {!compact && (
        <section>
          <div className="label">who’s on top</div>
          <div className="subhead">
            {homeName} in white, {awayName} in lime — click the line to jump there.
          </div>
          <MiniMomentum charts={charts} currentT={currentT} fps={fps} duration={duration} onSeek={onSeek} />
        </section>
      )}

      <section className={compact ? 'xg-compact' : undefined}>
        <h3 className="display sec-h">Goal-chance race</h3>
        <div className="subhead">Running total of goal chance (xG) — higher means a goal was more likely.</div>
        <div className="mono" style={{ fontSize: 12 }}>
          {charts.xg_cum.length === 0 && <div style={{ color: palette.textDim }}>no shots yet</div>}
          {charts.xg_cum.slice(compact ? -3 : -6).map((s) => (
            <div key={`${s.t}-${s.by}`} style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: palette.textMuted }}>
                {s.by} · {s.xg.toFixed(2)}
              </span>
              <span>
                {s.home.toFixed(2)} – {s.away.toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
