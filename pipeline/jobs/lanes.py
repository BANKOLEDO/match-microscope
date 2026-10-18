"""lanes: compute passing options with risk, sampled every 10 frames.

For each sampled frame with a known carrier, every teammate is scored as a
passing option: forward gain plus openness (distance to the nearest
opponent), minus blockers (opponents within 3 units of the pass segment).
Risk is ``low`` / ``medium`` / ``high`` from the blocker count and the
receiver's tightness. The top 5 options per sample are kept.
"""

import numpy as np

from .common import frame_positions, segment_distance, team_of


SAMPLE_EVERY = 10
BLOCK_RADIUS = 3.0


def run(state):
    """Attach sampled passing-lane sets to the shared state."""
    frames = state["frames"]
    lane_sets = []

    for frame in frames[::SAMPLE_EVERY]:
        owner = frame["ball"].get("owner")
        if owner is None:
            continue
        ids, xy = frame_positions(frame)
        if owner not in ids:
            continue
        carrier_team = team_of(owner)
        carrier_idx = ids.index(owner)
        carrier = xy[carrier_idx]
        forward = 1.0 if carrier_team == state["match"]["home"]["id"] else -1.0

        options = []
        for i, pid in enumerate(ids):
            if team_of(pid) != carrier_team or pid == owner:
                continue
            target = xy[i]
            gain = float((target[0] - carrier[0]) * forward)
            dist = float(np.hypot(target[0] - carrier[0], target[1] - carrier[1]))
            if dist < 4.0:
                continue
            blockers = 0
            nearest_opp = 99.0
            for j, opp_id in enumerate(ids):
                if team_of(opp_id) == carrier_team:
                    continue
                d_seg = segment_distance(xy[j], carrier, target)
                d_rec = float(np.hypot(xy[j, 0] - target[0], xy[j, 1] - target[1]))
                nearest_opp = min(nearest_opp, d_rec)
                if d_seg < BLOCK_RADIUS:
                    blockers += 1
            if blockers >= 3 or nearest_opp < 1.5:
                risk = "high"
            elif blockers >= 1 or nearest_opp < 3.0:
                risk = "medium"
            else:
                risk = "low"
            openness = round(min(nearest_opp, 12.0), 1)
            options.append(
                {
                    "to": pid,
                    "risk": risk,
                    "open": openness,
                    "gain": round(gain, 1),
                    "blockers": blockers,
                }
            )
        options.sort(key=lambda o: ({"low": 0, "medium": 1, "high": 2}[o["risk"]], -o["gain"]))
        lane_sets.append(
            {
                "t": frame["t"],
                "by": owner,
                "options": options[:5],
            }
        )

    state["lanes"] = lane_sets
    open_count = sum(1 for s in lane_sets for o in s["options"] if o["risk"] == "low")
    return f"{len(lane_sets)} lane sets, {open_count} low-risk options"
