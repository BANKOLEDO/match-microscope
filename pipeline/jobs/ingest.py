"""ingest: parse frames, normalize events, validate schema.

Reads a raw ``match-<id>.json`` payload, validates it, and builds the shared
state every downstream job reads from. Fails fast, with a message that says
exactly what is wrong -- so bad data never reaches the frontend, and a judge
feeding their own match knows precisely what to fix.

The only hard requirements are the *shape* of the data, not its size: any
``fps``, any ``duration``, and any number of players per frame (all frames
must agree). The bundled synthetic matches use 5 fps x 600 s = 3,000 frames.
"""


def _fail(message):
    """Abort ingestion with a human-readable validation error."""
    raise ValueError(message)


def run(state):
    """Validate the raw match payload and attach lookup indexes."""
    match = state.get("match")
    frames = state.get("frames")
    events = state.get("events")

    if not isinstance(match, dict):
        _fail("'match' object is required")
    for key in ("id", "home", "away", "duration", "fps"):
        if key not in match:
            _fail(f"match.{key} is required")
    for side in ("home", "away"):
        info = match[side]
        if not isinstance(info, dict) or "id" not in info or "name" not in info:
            _fail(f"match.{side} needs at least 'id' and 'name'")

    fps = match["fps"]
    duration = match["duration"]
    if not isinstance(fps, (int, float)) or fps <= 0:
        _fail("match.fps must be a positive number")
    if not isinstance(duration, (int, float)) or duration <= 0:
        _fail("match.duration must be a positive number of seconds")

    if not isinstance(frames, list) or not frames:
        _fail("frames: a non-empty list is required")
    if not isinstance(events, list):
        _fail("events: a list is required")

    expected = round(duration * fps)
    if abs(len(frames) - expected) > max(1, round(fps)):
        _fail(
            f"expected about {expected} frames for {duration}s at {fps}fps, "
            f"got {len(frames)}"
        )
    if frames[0].get("t") != 0.0:
        _fail("frames[0].t must be 0.0 (frames must start at the beginning)")

    n_players = len(frames[0].get("players") or [])
    if n_players < 1:
        _fail("frames[0].players must contain at least one player")
    for index, frame in enumerate(frames):
        players = frame.get("players")
        got = len(players) if players is not None else 0
        if got != n_players:
            _fail(
                f"frames[{index}] has {got} players, expected {n_players} "
                "(every frame must list the same players)"
            )
        for player in players:
            if "id" not in player or "x" not in player or "y" not in player:
                _fail(f"frames[{index}] has a player without id/x/y")
        ball = frame.get("ball")
        if not isinstance(ball, dict) or "x" not in ball or "y" not in ball:
            _fail(f"frames[{index}].ball needs x and y")

    event_by_id = {}
    for event in events:
        event_id = event.get("id")
        if not event_id:
            _fail("every event needs a non-empty id")
        if event_id in event_by_id:
            _fail(f"duplicate event id: {event_id}")
        if "type" not in event:
            _fail(f"event {event_id} is missing 'type'")
        t = event.get("t")
        if not isinstance(t, (int, float)):
            _fail(f"event {event_id} is missing a numeric 't'")
        if not (0.0 <= t <= duration):
            _fail(f"event {event_id} at t={t} is outside the match (0..{duration}s)")
        event_by_id[event_id] = event

    roster = [player["id"] for player in frames[0]["players"]]

    state["event_by_id"] = event_by_id
    state["roster"] = roster
    state["stats"] = {"frames": len(frames), "events": len(events)}
    return f"{len(frames)} frames, {len(events)} events"
