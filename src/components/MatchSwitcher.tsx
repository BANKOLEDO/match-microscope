import type { IndexFile } from '../lib/data';

interface MatchSwitcherProps {
  index: IndexFile;
  matchId: string;
  onChange: (id: string) => void;
}

export default function MatchSwitcher({ index, matchId, onChange }: MatchSwitcherProps) {
  return (
    <label className="label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      match
      <select
        value={matchId}
        onChange={(e) => onChange(e.target.value)}
        aria-label="switch match"
        style={{
          background: 'var(--bg-elevated)',
          color: 'var(--text-primary)',
          border: '1px solid var(--line)',
          borderRadius: 4,
          padding: '5px 8px',
          fontSize: 13,
        }}
      >
        {index.matches.map((m) => (
          <option key={m.id} value={m.id}>
            {m.matchday} — {m.home.name} {m.score.home}–{m.score.away} {m.away.name}
          </option>
        ))}
      </select>
    </label>
  );
}
