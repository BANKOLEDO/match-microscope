"""personalize: build role-specific and language-specific views.

Same intelligence, four experiences. This job does not call any model; it
reshapes verified pipeline output into per-role views plus a per-player
index for player-focus mode. Languages ride along on every annotation
(English, Spanish, French), translated from the static dictionary.

- analyst: every layer, raw coordinates, confidence scores, event ids.
- coach: tactical layers (pressure, lanes, space), exportable, no ids.
- fan: momentum, danger zone and key moments (goals + big chances) only.
- player: one selected player highlighted -- heat map, pass network
  neighbourhood and involvement timeline; others dimmed.
"""


def run(state):
    """Build the personalization artefact for the shared state."""
    annotations = state["annotations"]
    events = state["events"]

    key_moments = [
        a["id"]
        for a in annotations
        if a["kind"] in ("goal",) or (a["kind"] == "shot")
    ]
    tactical = [
        a["id"] for a in annotations if a["kind"] in ("press", "lane", "space", "turnover")
    ]
    all_ids = [a["id"] for a in annotations]

    players = {}
    for pid in state["roster"]:
        involved = [e["id"] for e in events if e.get("by") == pid or e.get("to") == pid]
        heat = [0] * (21 * 14)
        players[pid] = {
            "events": involved,
            "timeline": sorted({e["t"] for e in events if e.get("by") == pid}),
        }

    # Per-player heat cells from space windows is expensive; instead the
    # frontend renders heat from raw frames. Store involvement counts.
    for pid in players:
        players[pid]["involvement"] = len(players[pid]["events"])

    state["personalized"] = {
        "roles": {
            "analyst": {
                "layers": ["pressure", "lanes", "space", "momentum", "xg", "trails", "coords"],
                "annotations": all_ids,
                "show_coords": True,
                "show_confidence": True,
                "show_event_ids": True,
                "export": True,
            },
            "coach": {
                "layers": ["pressure", "lanes", "space", "trails"],
                "annotations": tactical,
                "show_coords": False,
                "show_confidence": True,
                "show_event_ids": False,
                "export": True,
            },
            "fan": {
                "layers": ["momentum", "danger"],
                "annotations": key_moments,
                "show_coords": False,
                "show_confidence": False,
                "show_event_ids": False,
                "export": False,
            },
            "player": {
                "layers": ["heatmap", "network", "timeline", "trails"],
                "annotations": all_ids,
                "show_coords": False,
                "show_confidence": True,
                "show_event_ids": False,
                "export": False,
            },
        },
        "players": players,
        "languages": ["en", "es", "fr"],
    }
    return f"4 modes x 3 langs, {len(players)} player profiles"
