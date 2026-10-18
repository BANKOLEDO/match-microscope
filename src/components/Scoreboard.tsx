import { formatT } from '../lib/format';

interface ScoreboardProps {
  homeName: string;
  awayName: string;
  homeScore: number;
  awayScore: number;
  clock: number;
  homeXg: number;
  awayXg: number;
  pressure: number;
  leader: string;
  totalGoals: number;
  totalShots: number;
  totalXg: number;
}

/**
 * Hero scoreboard band: giant condensed matchup type (SHOWCASE hero),
 * live chips (countdown-chip language), and a lime stat card
 * (03 Days / 15 Speakers energy) with full-match totals.
 */
export default function Scoreboard(props: ScoreboardProps) {
  const { homeName, awayName, homeScore, awayScore, clock } = props;
  const chips = [
    { label: 'clock', value: formatT(clock) },
    { label: 'goal chance now', value: `${props.homeXg.toFixed(2)}–${props.awayXg.toFixed(2)}` },
    { label: 'pressure on ball', value: props.pressure > 1.2 ? 'high' : props.pressure > 0.4 ? 'rising' : 'low' },
    { label: 'on top', value: props.leader },
  ];
  const stats = [
    { label: 'goals', value: String(props.totalGoals) },
    { label: 'shots', value: String(props.totalShots) },
    { label: 'goal chance', value: props.totalXg.toFixed(2) },
  ];
  return (
    <div className="scoreboard">
      <div className="scoreboard-main">
        <h1 className="display scoreboard-title">
          {homeName} <span className="scoreboard-score">{homeScore}–{awayScore}</span> {awayName}
        </h1>
        <div className="scoreboard-chips">
          {chips.map((c) => (
            <div key={c.label} className="live-chip">
              <span className="live-chip-value mono">{c.value}</span>
              <span className="live-chip-label">{c.label}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="lime-card" aria-label="match totals">
        {stats.map((s) => (
          <div key={s.label} className="lime-stat">
            <span className="display lime-stat-value">{s.value}</span>
            <span className="lime-stat-label">{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
