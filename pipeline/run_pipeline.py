#!/usr/bin/env python3
"""Run the Match Microscope pipeline over the generated matches.

Usage:
    python pipeline/run_pipeline.py                       # every match in index.json
    python pipeline/run_pipeline.py --match syn-001
    python pipeline/run_pipeline.py --use-llm             # needs Azure/OpenAI creds
    python pipeline/run_pipeline.py --check my-match.json # validate a file, no writes
    python pipeline/run_pipeline.py --input my-match.json --id my-match
    python pipeline/run_pipeline.py --tui                 # interactive terminal UI

Default is template annotations (no network). With ``--use-llm`` and
Microsoft Foundry / Azure OpenAI credentials (or any OpenAI-compatible
key) present, the explain job upgrades to a real Microsoft Agent Framework
collaboration -- a Narrator agent drafts each annotation, a tool-using
Verifier agent checks it against the raw event store, and a Director agent
adjudicates. Any agent failure falls back to the grounded templates.
Artefacts are written into ``public/data/``; the frontend only ever reads
those static files, so nothing is recomputed or re-billed at runtime.
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from jobs.common import load_dotenv, load_json, save_json  # noqa: E402
from jobs.director import run_match  # noqa: E402


def _index_entry(raw):
    """Build an index.json entry from a raw match payload."""
    match = raw["match"]
    home = dict(match["home"])
    away = dict(match["away"])
    home.setdefault("color", "#E8ECEF")
    away.setdefault("color", "#C8FF3D")
    return {
        "id": match["id"],
        "matchday": match.get("matchday", "Custom match"),
        "home": home,
        "away": away,
        "score": match.get("score", {"home": 0, "away": 0}),
        "duration": match["duration"],
        "fps": match["fps"],
        "frames": len(raw["frames"]),
        "events": len(raw["events"]),
    }


def _register_in_index(raw):
    """Add or replace this match's entry in index.json so the app can list it."""
    entry = _index_entry(raw)
    index = load_json("index.json")
    matches = [m for m in index["matches"] if m["id"] != entry["id"]]
    matches.append(entry)
    index["matches"] = matches
    save_json("index.json", index)


def _validate_only(path):
    """Validate an input file through ingest without writing artefacts."""
    from jobs import ingest  # imported here so --check is cheap

    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    state = {"match": raw.get("match"), "frames": raw.get("frames"), "events": raw.get("events")}
    detail = ingest.run(state)
    print(f"OK: {detail}")
    print(f"    {len(state['roster'])} players, {state['match']['fps']} fps, "
          f"{state['match']['duration']}s")
    return 0


def _resolve_input(path):
    """Read and json-parse an arbitrary match file."""
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def main():
    load_dotenv()  # pick up .env (e.g. AZURE_OPENAI_*) without overriding real env
    parser = argparse.ArgumentParser(description="Run the Match Microscope pipeline.")
    parser.add_argument("--match", default="all", help="match id or 'all'")
    parser.add_argument("--input", help="path to a custom match JSON to process")
    parser.add_argument("--id", help="id to store the custom match under")
    parser.add_argument("--check", help="validate a custom match JSON and exit")
    parser.add_argument("--tui", action="store_true", help="launch the interactive terminal UI")
    parser.add_argument(
        "--use-llm",
        action="store_true",
        help="run the agent crew with template fallback (needs model creds)",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=1,
        help="process this many matches in parallel (default 1)",
    )
    args = parser.parse_args()

    if args.use_llm:
        from agents import agents_available, describe_backend

        if agents_available():
            print(f"agentic explain enabled -> {describe_backend()}")
        else:
            print("--use-llm requested but no model creds / agent-framework found; "
                  "using grounded templates (set AZURE_OPENAI_* or OPENAI_API_KEY).")

    if args.check:
        return _validate_only(args.check)

    if args.tui:
        from tui import MatchMicroscopeTUI  # imported lazily; needs `textual`

        MatchMicroscopeTUI(use_llm=args.use_llm, input_path=args.input, match_id=args.id).run()
        return 0

    match_ids = []
    custom = None
    if args.input:
        custom = _resolve_input(args.input)
        match_id = args.id or custom["match"].get("id") or "custom"
        custom["match"]["id"] = match_id
        save_json(f"match-{match_id}.json", custom)
        _register_in_index(custom)
        match_ids = [match_id]
        print(f"registered custom match '{match_id}' from {args.input}")
    elif args.match == "all":
        index = load_json("index.json")
        match_ids = [m["id"] for m in index["matches"]]
    else:
        match_ids = [args.match]

    if args.workers > 1 and len(match_ids) > 1:
        from concurrent.futures import ThreadPoolExecutor

        print(f"processing {len(match_ids)} matches with {args.workers} workers")
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            list(pool.map(lambda mid: run_match(mid, use_llm=args.use_llm), match_ids))
    else:
        for match_id in match_ids:
            raw = custom if custom is not None else None
            run_match(match_id, use_llm=args.use_llm, raw=raw)
    print(f"pipeline complete for: {', '.join(match_ids)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
