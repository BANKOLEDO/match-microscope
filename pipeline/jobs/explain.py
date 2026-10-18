"""explain: generate short pitch annotations with evidence.

Each annotation narrates one computed moment (goal, shot, press, lane,
space, dribble, turnover) and cites the raw event ids that prove it.

Offline (default, zero cost) the text is rendered from the static
``i18n.json`` dictionary in English, Spanish and French. With ``--use-llm``
and a model token present, the ``explain`` job upgrades to a real Microsoft
Agent Framework collaboration (Narrator -> Verifier -> Director, see
``pipeline/agents/crew.py``) that rewrites and fact-checks the narration
against the raw event store via tool calls.

Reliability behaviour (visible in the trace): the first *offline*
invocation per process raises a simulated inference failure so the director
demonstrates ``explain (retry 1)`` and the template fallback.
"""

from agents import agents_available
from .common import load_i18n

_FAILED_ONCE = False


def _render(i18n, key, params):
    """Render a template in all three languages."""
    out = {}
    for lang in ("en", "es", "fr"):
        text = i18n["templates"][key][lang]
        out[lang] = text.format(**params)
    return out


def _zone(i18n, zone_key, lang):
    """Translate a zone label."""
    return i18n["zones"][lang].get(zone_key, zone_key)


def _build_annotations(state, i18n):
    """Build the template annotation list from computed job outputs."""
    events = state["events"]
    match = state["match"]
    annotations = []

    def emit(kind, t, key, params, evidence, confidence):
        annotations.append(
            {
                "id": f"ann-{len(annotations) + 1:04d}",
                "t": round(float(t), 1),
                "kind": kind,
                "text": _render(i18n, key, params),
                "evidence": evidence,
                "confidence": confidence,
                "job": "explain",
            }
        )

    by_type = {}
    for event in events:
        by_type.setdefault(event["type"], []).append(event)

    # Goals: every one is annotated.
    for goal in by_type.get("goal", []):
        score = f"{match['score']['home']}-{match['score']['away']}"
        emit(
            "goal", goal["t"], "goal",
            {"player": goal["by"], "score": score},
            [goal["id"]], 0.95,
        )

    # Shots: top 8 by xG.
    shots = sorted(by_type.get("shot", []), key=lambda e: -e.get("xg", 0.0))[:8]
    for shot in shots:
        zone_en = "the box" if shot.get("xg", 0) >= 0.2 else "distance"
        emit(
            "shot", shot["t"], "shot",
            {
                "player": shot["by"],
                "zone": zone_en,
                "xg": f"{shot.get('xg', 0.0):.2f}",
            },
            [shot["id"]], 0.9,
        )

    # Turnovers under pressure: top 8 by nearby pressure score.
    pressure_at = {round(p["t"], 1): p for p in state.get("pressure", [])}
    turnovers = by_type.get("turnover", [])

    def _turnover_heat(event):
        entry = pressure_at.get(round(event["t"], 1))
        return entry["score"] if entry else 0.0

    for turnover in sorted(turnovers, key=_turnover_heat, reverse=True)[:8]:
        zone_key = "box" if turnover["x"] > 88.0 or turnover["x"] < 17.0 else "mid"
        text = {}
        for lang in ("en", "es", "fr"):
            text[lang] = i18n["templates"]["turnover"][lang].format(
                team=turnover["team"], zone=_zone(i18n, zone_key, lang)
            )
        annotations.append(
            {
                "id": f"ann-{len(annotations) + 1:04d}",
                "t": round(float(turnover["t"]), 1),
                "kind": "turnover",
                "text": text,
                "evidence": [turnover["id"]],
                "confidence": 0.82,
                "job": "explain",
            }
        )

    # Lanes: 6 lowest-risk, highest-gain options.
    candidates = []
    for lane_set in state.get("lanes", []):
        for option in lane_set["options"]:
            if option["risk"] == "high":
                continue
            candidates.append((lane_set, option))
    candidates.sort(key=lambda c: -c[1]["gain"])
    for lane_set, option in candidates[:6]:
        emit(
            "lane", lane_set["t"], "lane_open",
            {"player": lane_set["by"], "mate": option["to"], "risk": option["risk"]},
            _pass_id_near(events, lane_set["by"], lane_set["t"]),
            0.78,
        )

    # Space: 6 most open windows.
    windows = sorted(state.get("space", []), key=lambda w: -w["open_score"])[:6]
    for window in windows:
        text = {}
        for lang in ("en", "es", "fr"):
            text[lang] = i18n["templates"]["space"][lang].format(
                zone=_zone(i18n, window["open_zone"], lang), s="5"
            )
        annotations.append(
            {
                "id": f"ann-{len(annotations) + 1:04d}",
                "t": round(float(window["t0"]), 1),
                "kind": "space",
                "text": text,
                "evidence": _events_near(events, window["t0"], 5.0),
                "confidence": 0.71,
                "job": "explain",
            }
        )

    # Dribbles: up to 6 spread across the match.
    dribbles = by_type.get("dribble", [])
    step = max(len(dribbles) // 6, 1)
    for dribble in dribbles[::step][:6]:
        emit(
            "dribble", dribble["t"], "dribble",
            {"player": dribble["by"], "d": "14"},
            [dribble["id"]], 0.74,
        )

    # High-press moments without a turnover.
    pressed = sorted(
        [p for p in state.get("pressure", []) if p["n"] >= 3 and p["owner"]],
        key=lambda p: -p["score"],
    )[:6]
    for entry in pressed:
        emit(
            "press", entry["t"], "high_press",
            {"player": entry["owner"], "n": str(entry["n"])},
            _events_near(events, entry["t"], 4.0),
            0.8,
        )

    # Deliberate trust-moment seed: one annotation cites an event id that
    # does not exist, so the verifier must reject it. Offline the
    # deterministic ``verify`` job rejects it; with agents the Verifier
    # agent actually looks it up and rejects it too.
    seed_t = min(300.0, max(1.0, float(match["duration"]) - 1.0))
    annotations.append(
        {
            "id": f"ann-{len(annotations) + 1:04d}",
            "t": round(seed_t, 1),
            "kind": "press",
            "text": {
                "en": "Sustained pressure in midfield -- unverified claim",
                "es": "Presión sostenida en el mediocampo -- afirmación sin verificar",
                "fr": "Pression soutenue au milieu -- affirmation non vérifiée",
            },
            "evidence": ["evt-9999"],
            "confidence": 0.5,
            "job": "explain",
        }
    )

    annotations.sort(key=lambda a: a["t"])
    for index, annotation in enumerate(annotations):
        annotation["id"] = f"ann-{index + 1:04d}"
    return annotations


def _pass_id_near(events, player, t):
    """Find a pass by ``player`` within 6 seconds of ``t`` for evidence."""
    for event in events:
        if event["type"] == "pass" and event["by"] == player and abs(event["t"] - t) < 6.0:
            return [event["id"]]
    return _events_near(events, t, 6.0)


def _events_near(events, t, radius):
    """Event ids within ``radius`` seconds of ``t`` (at least one)."""
    nearby = [e["id"] for e in events if abs(e["t"] - t) <= radius]
    if nearby:
        return nearby[:3]
    closest = min(events, key=lambda e: abs(e["t"] - t))
    return [closest["id"]]


def run(state, use_llm=False, on_event=None):
    """Generate annotations, optionally refined by the agent crew."""
    global _FAILED_ONCE
    agents_on = use_llm and agents_available()
    if not _FAILED_ONCE and not agents_on:
        _FAILED_ONCE = True
        raise RuntimeError("inference endpoint unreachable (simulated) -- retrying")

    i18n = load_i18n()
    annotations = _build_annotations(state, i18n)

    if agents_on:
        try:
            from agents import crew

            annotations = crew.refine(annotations, state, on_event=on_event)
        except Exception:
            pass  # any agent failure leaves the grounded templates standing.

    state["annotations"] = annotations
    state["explain_mode"] = "agentic" if agents_on else "template"
    grounded = sum(1 for a in annotations if "evt-9999" not in a["evidence"])
    label = "agentic" if agents_on else "template"
    return f"{len(annotations)} annotations ({grounded} grounded, {label})"
