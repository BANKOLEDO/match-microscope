import { useState } from 'react';
import { palette } from '../lib/colors';
import type { MatchEvent, PressureFrame } from '../lib/data';
import { formatT, parseT } from '../lib/format';

interface CommandBarProps {
  events: MatchEvent[];
  pressure: PressureFrame[];
  homeId: string;
  fps: number;
  duration: number;
  onSeek: (idx: number) => void;
  onSetRole: (role: string) => void;
}

interface Hit {
  time: string;
  title: string;
  sub: string;
  frameIdx: number;
}

/** Director console: plain-words commands with rich jump-to cards. */
export default function CommandBar({ events, pressure, homeId, fps, duration, onSeek, onSetRole }: CommandBarProps) {
  const [value, setValue] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [hitsTitle, setHitsTitle] = useState('');
  const [note, setNote] = useState('Ask in plain words — a time, “goals”, “pressure”, or a way to watch.');

  const presets = [
    { label: 'Show me the goals', cmd: 'goals' },
    { label: 'Where was the pressure?', cmd: 'find high-pressure moments' },
    { label: 'Fan view', cmd: 'fan' },
    { label: 'Analyst view', cmd: 'analyst' },
  ];

  const clear = () => {
    setHits([]);
    setHitsTitle('');
    setNote('Ask in plain words — a time, “goals”, “pressure”, or a way to watch.');
  };

  const run = (raw: string) => {
    const cmd = raw.trim().toLowerCase();
    if (!cmd) return;

    const jump = cmd.match(/^(?:jump to\s+)?(\d{1,3}:\d{1,2}|\d+(?:\.\d+)?)$/);
    if (jump) {
      const t = parseT(jump[1], duration);
      if (t === null) {
        setHits([]);
        setHitsTitle('');
        setNote('That time is outside the match — try anything from 00:00 to the final whistle.');
        return;
      }
      onSeek(Math.round(t * fps));
      setHits([]);
      setHitsTitle('');
      setNote(`Jumped to ${formatT(t)} — press Play to watch from here.`);
      return;
    }

    if (cmd.includes('pressure')) {
      const top = [...pressure]
        .filter((p) => p.owner)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);
      setHits(
        top.map((p) => ({
          time: formatT(p.t),
          title: `${p.owner} crowded out`,
          sub: `pressure ${p.score.toFixed(2)} · ${p.n} opponents within touching distance`,
          frameIdx: Math.round(p.t * fps),
        })),
      );
      setHitsTitle('The 5 most crowded moments');
      setNote('Tap a card to jump straight there.');
      return;
    }

    if (cmd.includes('goal')) {
      const goals = events.filter((e) => e.type === 'goal').sort((a, b) => a.t - b.t);
      const awayId = events.map((e) => e.by.split('-')[0]).find((id) => id !== homeId) ?? 'AWAY';
      let home = 0;
      let away = 0;
      setHits(
        goals.map((g) => {
          if (g.team === homeId) home += 1;
          else away += 1;
          const shot = events.find(
            (e) => e.type === 'shot' && e.by === g.by && g.t - e.t >= 0 && g.t - e.t < 4,
          );
          return {
            time: formatT(g.t),
            title: `${g.by} scores`,
            sub: `goal chance ${shot ? shot.xg?.toFixed(2) ?? '—' : '—'} · score now ${home}–${away} (${homeId}–${awayId})`,
            frameIdx: Math.round(g.t * fps),
          };
        }),
      );
      setHitsTitle(goals.length > 0 ? `All ${goals.length} goals` : 'No goals');
      setNote(goals.length > 0 ? 'Tap a card to rewatch it.' : 'No goals in this match.');
      return;
    }

    if (['analyst', 'coach', 'fan', 'player'].includes(cmd)) {
      onSetRole(cmd);
      setHits([]);
      setHitsTitle('');
      setNote(`Switched to ${cmd === 'player' ? 'follow-a-player' : cmd} view.`);
      return;
    }

    setHits([]);
    setHitsTitle('');
    setNote('I didn’t get that — try a time like 03:12, “goals”, “pressure”, or fan / coach / analyst.');
  };

  return (
    <div>
      <h2 className="display" style={{ fontSize: 20, margin: '0 0 8px' }}>
        Direct the replay
      </h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(value);
        }}
      >
        <div className="console-row">
          <span className="console-prompt" aria-hidden="true">
            ›
          </span>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Type a time like 03:12, or ask for goals…"
            aria-label="director console"
            className="mono console-input"
          />
          <button type="submit">Go</button>
        </div>
      </form>
      <div className="mono" style={{ fontSize: 11, color: palette.textDim, marginTop: 6 }}>
        {note}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
        {presets.map((p) => (
          <button key={p.label} type="button" onClick={() => run(p.cmd)}>
            {p.label}
          </button>
        ))}
      </div>
      {hits.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <span className="label">{hitsTitle}</span>
            <button type="button" onClick={clear} style={{ padding: '2px 6px' }}>
              clear
            </button>
          </div>
          <div className="hit-grid">
            {hits.map((h) => (
              <button key={`${h.time}-${h.title}`} type="button" className="hit-card" onClick={() => onSeek(h.frameIdx)}>
                <span className="display hit-time">{h.time}</span>
                <span className="hit-title">{h.title}</span>
                <span className="mono hit-sub">{h.sub}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
