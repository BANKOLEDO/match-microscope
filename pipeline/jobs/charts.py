"""charts: build pass network, momentum and xG series.

- Pass network: nodes are players (sized by completed passes), links count
  completed passes between teammates.
- Momentum: per 5-second window, attack value per team = xG generated plus
  a small weight for completed passes and final-third entries.
- xG cumulative: running total per team at each shot.
- Pressure line: max pressure per 5-second window, synced to the timeline.
"""

from .common import team_of


WINDOW_S = 5.0


def run(state):
    """Build chart series and attach them to the shared state."""
    match = state["match"]
    events = state["events"]
    home = match["home"]["id"]
    duration = match["duration"]

    nodes = {}
    links = {}
    for event in events:
        if event["type"] != "pass" or event.get("outcome") != "complete":
            continue
        src, dst = event["by"], event.get("to")
        if not dst:
            continue
        nodes[src] = nodes.get(src, 0) + 1
        nodes[dst] = nodes.get(dst, 0) + 1
        key = (src, dst)
        links[key] = links.get(key, 0) + 1

    for pid in state["roster"]:
        nodes.setdefault(pid, 0)

    pass_network = {
        "nodes": [
            {"id": pid, "team": team_of(pid), "passes": count}
            for pid, count in sorted(nodes.items())
        ],
        "links": [
            {"source": src, "dst": dst, "count": count}
            for (src, dst), count in sorted(links.items(), key=lambda kv: -kv[1])
        ],
    }

    n_windows = int(duration / WINDOW_S)
    momentum = []
    xg_cum = []
    running = {home: 0.0, match["away"]["id"]: 0.0}
    shots = sorted(
        [e for e in events if e["type"] == "shot"], key=lambda e: e["t"]
    )
    pressure_by_window = [0.0] * n_windows
    for entry in state.get("pressure", []):
        idx = min(int(entry["t"] / WINDOW_S), n_windows - 1)
        pressure_by_window[idx] = max(pressure_by_window[idx], entry["score"])

    for w in range(n_windows):
        t0, t1 = w * WINDOW_S, (w + 1) * WINDOW_S
        window_events = [e for e in events if t0 <= e["t"] < t1]
        score = {home: 0.0, match["away"]["id"]: 0.0}
        for event in window_events:
            team = event["team"]
            if team not in score:
                continue
            if event["type"] == "shot":
                score[team] += 3.0 * event.get("xg", 0.0)
            elif event["type"] == "pass" and event.get("outcome") == "complete":
                score[team] += 0.05
            elif event["type"] == "goal":
                score[team] += 1.5
        momentum.append(
            {
                "t": round(t0, 1),
                "home": round(score[home], 2),
                "away": round(score[match["away"]["id"]], 2),
            }
        )

    for shot in shots:
        running[shot["team"]] = round(running.get(shot["team"], 0.0) + shot.get("xg", 0.0), 2)
        xg_cum.append(
            {
                "t": shot["t"],
                "team": shot["team"],
                "by": shot["by"],
                "xg": shot.get("xg", 0.0),
                "home": running[home],
                "away": running[match["away"]["id"]],
            }
        )

    state["charts"] = {
        "pass_network": pass_network,
        "momentum": momentum,
        "xg_cum": xg_cum,
        "possession": state.get("tracking", {}).get("possession", {}),
        "pressure": [
            {"t": round(w * WINDOW_S, 1), "v": round(v, 2)}
            for w, v in enumerate(pressure_by_window)
        ],
    }
    return (
        f"{len(pass_network['links'])} links, "
        f"{len(momentum)} momentum windows, "
        f"{len(xg_cum)} shots"
    )
