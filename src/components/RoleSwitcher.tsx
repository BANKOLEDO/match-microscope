const ROLES = [
  { id: 'analyst', label: 'Analyst', hint: 'See everything, with proof' },
  { id: 'coach', label: 'Coach', hint: 'Tactics plus an exportable report' },
  { id: 'fan', label: 'Fan', hint: 'Just the big story' },
  { id: 'player', label: 'Follow a player', hint: 'One player, their whole game' },
] as const;

interface RoleSwitcherProps {
  role: string;
  onChange: (role: string) => void;
}

/** How-to-watch switcher. Plain labels with hover hints. */
export default function RoleSwitcher({ role, onChange }: RoleSwitcherProps) {
  return (
    <div role="group" aria-label="how to watch" className="seg" style={{ display: 'flex', gap: 4 }}>
      {ROLES.map((r) => (
        <button key={r.id} type="button" title={r.hint} aria-pressed={role === r.id} onClick={() => onChange(r.id)}>
          {r.label}
        </button>
      ))}
    </div>
  );
}
