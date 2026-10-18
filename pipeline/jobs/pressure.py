"""pressure: compute pressure on the ball carrier, per frame.

For every frame with a known owner, the pressure score is the sum over
opponents of ``max(0, 1 - d / 8)`` where ``d`` is the distance to the
carrier. Crowding close to the ball scores near 1 per opponent; nobody
within 8 units scores 0. Also records the plain count of opponents
within 5 units (``n``), which the explainer uses for text.
"""

import numpy as np

from .common import frame_positions, team_of


PRESSURE_RADIUS = 8.0
COUNT_RADIUS = 5.0


def run(state):
    """Attach per-frame pressure series to the shared state."""
    series = []
    for frame in state["frames"]:
        owner = frame["ball"].get("owner")
        if owner is None:
            series.append({"t": frame["t"], "owner": None, "score": 0.0, "n": 0})
            continue
        ids, xy = frame_positions(frame)
        carrier_team = team_of(owner)
        try:
            carrier_idx = ids.index(owner)
        except ValueError:
            series.append({"t": frame["t"], "owner": owner, "score": 0.0, "n": 0})
            continue
        carrier = xy[carrier_idx]
        dists = np.hypot(xy[:, 0] - carrier[0], xy[:, 1] - carrier[1])
        score = 0.0
        count = 0
        for i, pid in enumerate(ids):
            if team_of(pid) == carrier_team:
                continue
            d = float(dists[i])
            if d < PRESSURE_RADIUS:
                score += max(0.0, 1.0 - d / PRESSURE_RADIUS)
            if d < COUNT_RADIUS:
                count += 1
        series.append(
            {
                "t": frame["t"],
                "owner": owner,
                "score": round(float(score), 2),
                "n": count,
            }
        )
    state["pressure"] = series
    peak = max(s["score"] for s in series)
    return f"{len(series)} scores, peak {peak:.2f}"
