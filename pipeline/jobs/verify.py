"""verify: verify every annotation against raw events.

For each annotation, every cited event id must exist in the match, and the
annotation time must sit inside the match duration and near its evidence
(within 12 seconds). Anything unverifiable gets ``verified: false`` plus a
machine-readable reason. This is the trust moment in the demo.
"""


def run(state):
    """Check annotation evidence and stamp verified flags."""
    event_by_id = state["event_by_id"]
    duration = state["match"]["duration"]
    annotations = state["annotations"]

    ok_count = 0
    for annotation in annotations:
        reasons = []
        if not (0.0 <= annotation["t"] <= duration):
            reasons.append("annotation outside match duration")
        if not annotation.get("evidence"):
            reasons.append("no evidence cited")
        for event_id in annotation.get("evidence", []):
            event = event_by_id.get(event_id)
            if event is None:
                reasons.append(f"evidence {event_id} not found in match events")
            elif abs(event["t"] - annotation["t"]) > 12.0:
                reasons.append(f"evidence {event_id} too far from annotation time")
        if reasons:
            annotation["verified"] = False
            annotation["reason"] = "; ".join(reasons)
        else:
            annotation["verified"] = True
            annotation.pop("reason", None)
            ok_count += 1

    state["verify_summary"] = {
        "verified": ok_count,
        "failed": len(annotations) - ok_count,
    }
    return f"{ok_count} verified, {len(annotations) - ok_count} failed"
