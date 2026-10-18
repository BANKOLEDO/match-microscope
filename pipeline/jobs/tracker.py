"""tracker: compute velocities, detect possession.

Frames store positions only (keeps match files under the gzipped budget),
so this job derives kinematics: per-frame velocity per player via central
differences, the possession owner per frame, team possession shares, and
distance covered per player.
"""

import numpy as np

from .common import frame_positions, team_of


def run(state):
    """Attach tracking data to the shared state."""
    frames = state["frames"]
    roster = state["roster"]
    dt = 1.0 / float(state["match"]["fps"])

    stacked = []
    for frame in frames:
        _ids, xy = frame_positions(frame)
        stacked.append(xy)
    pos = np.array(stacked)  # (frames, players, 2)

    # Central differences -> velocity per player per frame.
    vel = np.zeros_like(pos)
    vel[1:-1] = (pos[2:] - pos[:-2]) / (2.0 * dt)
    vel[0] = (pos[1] - pos[0]) / dt
    vel[-1] = (pos[-1] - pos[-2]) / dt

    speed = np.hypot(vel[:, :, 0], vel[:, :, 1])
    distance = {
        pid: round(float(np.sum(speed[:, i]) * dt), 1)
        for i, pid in enumerate(roster)
    }
    top_speed = {
        pid: round(float(np.max(speed[:, i])), 2)
        for i, pid in enumerate(roster)
    }

    owners = [f["ball"].get("owner") for f in frames]
    possessed = [o for o in owners if o is not None]
    home_key = state["match"]["home"]["id"]
    away_key = state["match"]["away"]["id"]
    home_count = sum(1 for o in possessed if team_of(o) == home_key)
    away_count = sum(1 for o in possessed if team_of(o) == away_key)
    total = max(len(possessed), 1)

    state["tracking"] = {
        "distance": distance,
        "top_speed": top_speed,
        "possession": {
            home_key: round(home_count / total, 3),
            away_key: round(away_count / total, 3),
        },
        "mean_speed": round(float(np.mean(speed)), 2),
    }
    return (
        f"{len(frames)} frames tracked, "
        f"{home_key} {home_count / total * 100:.0f}% possession"
    )
