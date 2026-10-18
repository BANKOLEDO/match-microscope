import { palette } from '../lib/colors';
import { playerName } from '../lib/names';

interface PlayerCardProps {
  playerId: string;
  teamId: string;
  teamName: string;
  role: string;
  involvements: number;
  touches: number;
  moments: number;
  isHome: boolean;
  onUnfollow: () => void;
}

/**
 * Featured-player card: jersey number tile, name, tag pills and three big
 * numbers. Readable at a glance, no jargon.
 */
export default function PlayerCard(props: PlayerCardProps) {
  const { playerId, teamId, teamName, role, involvements, touches, moments, isHome, onUnfollow } = props;
  const number = playerId.split('-')[1] ?? '';
  const tileBg = isHome ? palette.textPrimary : palette.accent;
  return (
    <div className="player-card">
      <div className="player-head">
        <div className="player-number" style={{ background: tileBg, color: palette.bgBase }}>
          <span className="display" style={{ fontSize: 34 }}>
            {number}
          </span>
          <span className="mono" style={{ fontSize: 10 }}>
            {teamId}
          </span>
        </div>
        <button type="button" className="unfollow" onClick={onUnfollow}>
          Unfollow
        </button>
      </div>
      <div>
        <h3 className="display player-name">{playerName(playerId)}</h3>
        <div className="player-tags">
          <span className="tag">{playerId}</span>
          <span className="tag">{role}</span>
          <span className="tag">{teamName}</span>
        </div>
        <div className="player-stats mono">
          <div>
            <div className="stat-num">{involvements}</div>
            <div className="stat-label">involved</div>
          </div>
          <div>
            <div className="stat-num">{touches}</div>
            <div className="stat-label">touches</div>
          </div>
          <div>
            <div className="stat-num">{moments}</div>
            <div className="stat-label">big moments</div>
          </div>
        </div>
      </div>
    </div>
  );
}
