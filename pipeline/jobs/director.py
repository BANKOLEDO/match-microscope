"""director: orchestrate the ten jobs in dependency order.

Runs ingest -> tracker -> pressure -> lanes -> space -> charts -> explain
-> verify -> personalize, sharing one state object. Retries ``explain``
up to 3 times on inference failure with template fallback, logs every
handoff ``{from, to, timestamp, payload_size, status}``, and writes the
``trace-<id>.json`` artefact the frontend renders in the PIPELINE panel.
"""

import sys
import time

from agents import describe_backend
from . import charts, explain, ingest, lanes, personalize, pressure, space, tracker, verify
from .common import load_json, save_json


JOB_ORDER = [
    ("ingest", ingest.run, {}),
    ("tracker", tracker.run, {}),
    ("pressure", pressure.run, {}),
    ("lanes", lanes.run, {}),
    ("space", space.run, {}),
    ("charts", charts.run, {}),
    ("explain", explain.run, {"retries": 3}),
    ("verify", verify.run, {}),
    ("personalize", personalize.run, {}),
]


def _payload_size(state):
    """Rough payload size for handoff logging."""
    return (
        len(state.get("frames", [])) * 24
        + len(state.get("events", []))
        + len(state.get("annotations", []))
    )


def run_match(match_id, use_llm=False, raw=None, on_event=None):
    """Run the full pipeline for one match id. Returns the trace.

    ``raw`` lets a caller pass an already-loaded match payload (used by
    ``--input`` to process any sensible match file). ``on_event`` is an
    optional callback receiving small progress dicts, used by the TUI.
    """
    def emit(event):
        if on_event is not None:
            on_event(event)

    # Reset the simulated first-attempt failure so every match trace
    # demonstrates the director retry, not just the first match.
    explain._FAILED_ONCE = False  # noqa: SLF001 -- intentional demo hook
    if raw is None:
        raw = load_json(f"match-{match_id}.json")
    state = {
        "match": raw["match"],
        "frames": raw["frames"],
        "events": raw["events"],
    }

    rows = []
    handoffs = []
    previous = "director"
    emit({"type": "match_start", "match": match_id})

    for name, fn, opts in JOB_ORDER:
        attempts = 0
        detail = ""
        status = "ok"
        max_attempts = opts.get("retries", 1)
        emit({"type": "job_start", "job": name})
        while True:
            attempts += 1
            try:
                if name == "explain":
                    detail = fn(state, use_llm=use_llm, on_event=emit)
                else:
                    detail = fn(state)
                break
            except Exception as exc:  # noqa: BLE001 -- pipeline must log, not crash
                detail = str(exc)
                if attempts >= max_attempts:
                    status = "failed"
                    break
                emit({"type": "job_retry", "job": name, "attempt": attempts, "detail": detail})
                time.sleep(0.1)
        if status == "failed":
            rows.append(
                {"job": name, "status": "failed", "detail": detail, "attempts": attempts}
            )
            handoffs.append(
                {
                    "from": previous,
                    "to": name,
                    "timestamp": round(time.time(), 1),
                    "payload_size": _payload_size(state),
                    "status": "failed",
                }
            )
            emit({"type": "job_done", "job": name, "status": "failed", "detail": detail, "attempts": attempts})
            print(f"[{match_id}] {name}: FAILED -- {detail}", file=sys.stderr)
            raise RuntimeError(f"job {name} failed: {detail}")

        label = f"retry {attempts - 1}" if attempts > 1 else "ok"
        rows.append(
            {"job": name, "status": label, "detail": detail, "attempts": attempts}
        )
        handoffs.append(
            {
                "from": previous,
                "to": name,
                "timestamp": round(time.time(), 1),
                "payload_size": _payload_size(state),
                "status": label,
            }
        )
        emit({"type": "job_done", "job": name, "status": label, "detail": detail, "attempts": attempts})
        previous = name
        print(f"[{match_id}] {name}: {detail} ({label})")

    rows.append(
        {
            "job": "director",
            "status": "ok",
            "detail": f"trace written ({state.get('explain_mode', 'template')})",
            "attempts": 1,
        }
    )
    emit({"type": "job_done", "job": "director", "status": "ok", "detail": "trace written", "attempts": 1})

    mode = state.get("explain_mode", "template")
    backend = describe_backend() if mode == "agentic" else "offline (templates)"
    trace = {"match": match_id, "agents": backend, "jobs": rows, "handoffs": handoffs}
    save_json(f"trace-{match_id}.json", trace)
    save_json(
        f"annotations-{match_id}.json",
        {"match": match_id, "annotations": state["annotations"]},
    )
    # Charts carry every pre-computed render series so the frontend only
    # ever reads static JSON: no runtime backend, no recomputation.
    save_json(
        f"charts-{match_id}.json",
        {
            "match": match_id,
            **state["charts"],
            "lanes": state["lanes"],
            "space": state["space"],
            "pressure_frames": state["pressure"],
        },
    )
    save_json(
        f"personalized-{match_id}.json",
        {"match": match_id, **state["personalized"]},
    )
    emit({"type": "match_done", "match": match_id, "trace": trace})
    return trace
