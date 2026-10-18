import { useMemo } from 'react';
import { palette, riskColor } from '../lib/colors';
import type { Annotation, Frame, LaneSet, MatchEvent } from '../lib/data';
import { PITCH_H, PITCH_W, playerTrail } from '../lib/geometry';

interface PitchProps {
  frames: Frame[];
  frameIdx: number;
  fps: number;
  layers: string[];
  annotations: { ann: Annotation; x: number; y: number }[];
  lang: string;
  laneSet: LaneSet | null;
  heat: number[] | null;
  pressureScore: number;
  focusPlayer: string | null;
  showCoords: boolean;
  homeId: string;
  eventsById: Map<string, MatchEvent>;
  danger: { home: number; away: number } | null;
  goalFlash: { x: number; y: number; by: string } | null;
  onSelectPlayer: (playerId: string | null) => void;
}

const GRID_X = 21;
const GRID_Y = 14;

/** Full pitch markings in pitch units (105 x 68, origin bottom-left). */
function Markings() {
  const s = { stroke: palette.pitchLine, strokeWidth: 0.25, fill: 'none' };
  const boxes: React.ReactNode[] = [];
  // Penalty boxes (16.5 deep, 40.3 wide) and 6-yard boxes (5.5 deep, 18.32 wide).
  for (const side of [0, 1] as const) {
    const x0 = side === 0 ? 0 : PITCH_W;
    const dir = side === 0 ? 1 : -1;
    const bx = (d: number) => (side === 0 ? d : PITCH_W - d);
    boxes.push(
      <g key={side}>
        <rect x={Math.min(bx(0), bx(16.5))} y={(PITCH_H - 40.32) / 2} width={16.5} height={40.32} {...s} />,
        <rect x={Math.min(bx(0), bx(5.5))} y={(PITCH_H - 18.32) / 2} width={5.5} height={18.32} {...s} />,
        <circle cx={bx(11)} cy={PITCH_H / 2} r={0.4} fill={palette.pitchLine} />,
        <line
          x1={bx(0)}
          y1={PITCH_H / 2 - 3.66}
          x2={bx(0)}
          y2={PITCH_H / 2 + 3.66}
          stroke={palette.textPrimary}
          strokeWidth={0.5}
        />,
      </g>,
    );
    void dir;
  }
  return (
    <g>
      <rect x={0} y={0} width={PITCH_W} height={PITCH_H} {...s} />
      <line x1={PITCH_W / 2} y1={0} x2={PITCH_W / 2} y2={PITCH_H} {...s} />
      <circle cx={PITCH_W / 2} cy={PITCH_H / 2} r={9.15} {...s} />
      <circle cx={PITCH_W / 2} cy={PITCH_H / 2} r={0.4} fill={palette.pitchLine} />
      {boxes}
    </g>
  );
}

export default function Pitch(props: PitchProps) {
  const {
    frames,
    frameIdx,
    fps,
    layers,
    annotations,
    lang,
    laneSet,
    heat,
    pressureScore,
    focusPlayer,
    showCoords,
    homeId,
    danger,
    goalFlash,
    onSelectPlayer,
  } = props;
  const frame = frames[frameIdx];
  const posById = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    for (const p of frame.players) m.set(p.id, { x: p.x, y: p.y });
    return m;
  }, [frame]);

  const trails = useMemo(() => {
    if (!layers.includes('trails')) return [];
    return frame.players.map((p) => ({
      id: p.id,
      pts: playerTrail(frames, frameIdx, p.id, 15),
    }));
  }, [frames, frameIdx, frame.players, layers]);

  const carrier = frame.ball.owner ? posById.get(frame.ball.owner) : null;
  const cellW = PITCH_W / GRID_X;
  const cellH = PITCH_H / GRID_Y;
  const ballTrail = frames
    .slice(Math.max(0, frameIdx - 5), frameIdx + 1)
    .map((f) => f.ball);
  const prevFrame = frames[Math.max(0, frameIdx - 1)];
  const prevById = new Map<string, { x: number; y: number }>();
  for (const p of prevFrame.players) prevById.set(p.id, { x: p.x, y: p.y });
  const laneTargets = new Map<string, string>();
  if (laneSet) {
    for (const o of laneSet.options) laneTargets.set(o.to, o.risk);
  }

  return (
    <svg
      viewBox="-4 -7 113 79"
      role="img"
      aria-label={`pitch at ${frame.t} seconds`}
      style={{ width: '100%', height: 'auto', display: 'block', background: palette.pitchGreen }}
    >
      <rect x={-4} y={-7} width={113} height={79} fill="transparent" onClick={() => onSelectPlayer(null)} />
      {Array.from({ length: 15 }, (_, i) =>
        i % 2 === 1 ? (
          <rect key={i} x={i * 7} y={0} width={7} height={PITCH_H} fill="#1E422F" opacity={0.5} />
        ) : null,
      )}
      <g aria-label="microscope rulers" fontFamily="JetBrains Mono, IBM Plex Mono, monospace" fontSize={1.7} fill={palette.pitchLine}>
        {[0, 15, 30, 45, 60, 75, 90, 105].map((x) => (
          <text key={x} x={x} y={-4.6} textAnchor="middle">
            {x}
          </text>
        ))}
        {[0, 17, 34, 51, 68].map((y) => (
          <text key={y} x={-3.4} y={PITCH_H - y + 0.6} textAnchor="end">
            {y}
          </text>
        ))}
      </g>
      <Markings />
      <g aria-label="goals">
        <rect x={-2.6} y={PITCH_H / 2 - 4.6} width={2.6} height={9.2} fill={palette.bgBase} stroke="#fff" strokeWidth={0.3} />
        <rect x={PITCH_W} y={PITCH_H / 2 - 4.6} width={2.6} height={9.2} fill={palette.bgBase} stroke="#fff" strokeWidth={0.3} />
      </g>

      {danger && (
        <g>
          <rect x={PITCH_W - 30} y={(PITCH_H - 40.32) / 2} width={30} height={40.32} fill={palette.danger} opacity={danger.home * 0.35} />
          <rect x={0} y={(PITCH_H - 40.32) / 2} width={30} height={40.32} fill={palette.danger} opacity={danger.away * 0.35} />
        </g>
      )}

      {layers.includes('space') && heat && (
        <g>
          {heat.map((v, i) =>
            v > 0.35 ? (
              <rect
                key={i}
                x={(i % GRID_X) * cellW}
                y={PITCH_H - (Math.floor(i / GRID_X) + 1) * cellH}
                width={cellW}
                height={cellH}
                fill={palette.accent}
                opacity={v * 0.5}
              />
            ) : null,
          )}
        </g>
      )}

      {layers.includes('lanes') &&
        laneSet &&
        laneSet.options.map((o) => {
          const to = posById.get(o.to);
          const from = posById.get(laneSet.by);
          if (!to || !from) return null;
          return (
            <line
              key={o.to}
              x1={from.x}
              y1={PITCH_H - from.y}
              x2={to.x}
              y2={PITCH_H - to.y}
              stroke={riskColor(o.risk)}
              strokeWidth={0.35}
              strokeDasharray={o.risk === 'high' ? '1.2 0.8' : undefined}
              opacity={0.9}
            />
          );
        })}

      {layers.includes('pressure') && carrier && pressureScore > 0.05 && (
        <circle
          cx={carrier.x}
          cy={PITCH_H - carrier.y}
          r={2 + pressureScore * 2.2}
          fill={palette.danger}
          opacity={0.3}
        />
      )}

      {trails.map((t) =>
        t.pts.length > 1 ? (
          <polyline
            key={t.id}
            points={t.pts.map((p) => `${p.x},${PITCH_H - p.y}`).join(' ')}
            fill="none"
            stroke={t.id.startsWith(homeId) ? palette.textPrimary : palette.accent}
            strokeWidth={0.25}
            opacity={focusPlayer && t.id !== focusPlayer ? 0.08 : 0.35}
          />
        ) : null,
      )}

      {frame.players.map((p) => {
        const isHome = p.id.startsWith(homeId);
        const dimmed = focusPlayer !== null && p.id !== focusPlayer;
        const prev = prevById.get(p.id);
        const speed = prev ? Math.hypot(p.x - prev.x, p.y - prev.y) * fps : 0;
        const r = 0.85 + Math.min(speed / 7, 1) * 0.5;
        const isOwner = p.id === frame.ball.owner;
        const isFocus = p.id === focusPlayer;
        const laneRisk = laneTargets.get(p.id);
        return (
          <g
            key={p.id}
            opacity={dimmed ? 0.25 : 1}
            onClick={(e) => {
              e.stopPropagation();
              onSelectPlayer(p.id);
            }}
            style={{ cursor: 'pointer' }}
          >
            <title>{`${p.id} · ${isHome ? homeId : 'away'} · ${speed.toFixed(1)} units/s`}</title>
            {laneRisk && layers.includes('lanes') && (
              <circle
                cx={p.x}
                cy={PITCH_H - p.y}
                r={r + 0.8}
                fill="none"
                stroke={riskColor(laneRisk)}
                strokeWidth={0.3}
                opacity={0.9}
              />
            )}
            {(isOwner || isFocus) && (
              <circle
                cx={p.x}
                cy={PITCH_H - p.y}
                r={r + 0.7}
                fill="none"
                stroke={palette.accent}
                strokeWidth={0.35}
                opacity={0.95}
              />
            )}
            <circle
              cx={p.x}
              cy={PITCH_H - p.y}
              r={isFocus ? r + 0.4 : r}
              fill={isHome ? palette.textPrimary : palette.bgBase}
              stroke={isHome ? 'none' : palette.accent}
              strokeWidth={isHome ? 0 : 0.35}
            />
            {(showCoords || isFocus || isOwner) && (
              <text
                x={p.x + 1.2}
                y={PITCH_H - p.y - 1}
                fontSize={1.9}
                fill={palette.textMuted}
                fontFamily="JetBrains Mono, IBM Plex Mono, monospace"
              >
                {p.id}
                {showCoords ? ` ${p.x.toFixed(1)},${p.y.toFixed(1)}` : ''}
              </text>
            )}
          </g>
        );
      })}

      <circle cx={frame.ball.x} cy={PITCH_H - frame.ball.y} r={1.3} fill="none" stroke="#fff" strokeWidth={0.2} opacity={0.7} />
      <circle cx={frame.ball.x} cy={PITCH_H - frame.ball.y} r={0.6} fill="#fff" />
      {ballTrail.length > 1 && (
        <polyline
          points={ballTrail.map((b) => `${b.x},${PITCH_H - b.y}`).join(' ')}
          fill="none"
          stroke="#fff"
          strokeWidth={0.35}
          opacity={0.75}
        />
      )}

      {goalFlash && (
        <g>
          <circle cx={goalFlash.x} cy={PITCH_H - goalFlash.y} r={3.2} fill="none" stroke={palette.accent} strokeWidth={0.45} />
          <text
            x={PITCH_W / 2}
            y={10}
            textAnchor="middle"
            fontSize={7}
            fill={palette.accent}
            fontFamily="Anton, 'Arial Narrow', sans-serif"
            style={{ paintOrder: 'stroke' }}
            stroke={palette.pitchGreen}
            strokeWidth={1}
          >
            GOAL — {goalFlash.by}
          </text>
        </g>
      )}

      {annotations.slice(0, 3).map((a, i) => {
        const lx = Math.min(a.x + 4, PITCH_W - 30);
        const ly = Math.max(a.y - 4 - i * 5, 4);
        const label = a.ann.text[lang as 'en' | 'es' | 'fr'] ?? a.ann.text.en;
        return (
          <g key={a.ann.id}>
            <line
              x1={a.x}
              y1={PITCH_H - a.y}
              x2={lx}
              y2={PITCH_H - ly}
              stroke={palette.textMuted}
              strokeWidth={0.2}
            />
            <text
              x={lx}
              y={PITCH_H - ly}
              fontSize={2.3}
              fill={a.ann.verified === false ? palette.danger : palette.textPrimary}
              fontFamily="JetBrains Mono, IBM Plex Mono, monospace"
              style={{ paintOrder: 'stroke' }}
              stroke={palette.pitchGreen}
              strokeWidth={0.6}
            >
              {label.length > 52 ? `${label.slice(0, 52)}…` : label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
