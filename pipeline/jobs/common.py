"""Shared helpers for pipeline jobs: paths, loading, saving, geometry.

All JSON artefacts are written with ``indent=1`` (proper indentation,
human readable, never minified).
"""

import json
import os
from pathlib import Path

import numpy as np


DATA_DIR = Path(__file__).resolve().parent.parent.parent / "public" / "data"
PIPELINE_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = PIPELINE_DIR.parent
PITCH_W = 105.0
PITCH_H = 68.0


def load_dotenv(path=None):
    """Load ``KEY=VALUE`` pairs from a ``.env`` file into ``os.environ``.

    Keeps the project dependency-free (no ``python-dotenv``). Existing shell
    variables always win, so CI secrets and real exports are never shadowed.
    """
    env_path = Path(path) if path else REPO_ROOT / ".env"
    if not env_path.is_file():
        return
    with open(env_path, "r", encoding="utf-8") as handle:
        for raw in handle:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value


def data_path(name):
    """Absolute path for a file inside ``public/data/``."""
    return DATA_DIR / name


def load_json(name):
    """Load a JSON file from ``public/data/``."""
    with open(data_path(name), "r", encoding="utf-8") as handle:
        return json.load(handle)


def save_json(name, payload):
    """Save a JSON artefact with readable indentation (never minified)."""
    with open(data_path(name), "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=1)
        handle.write("\n")


def load_i18n():
    """Load the static translation dictionary."""
    with open(PIPELINE_DIR / "i18n.json", "r", encoding="utf-8") as handle:
        return json.load(handle)


def team_of(player_id):
    """Derive the team from a player id prefix (``NOR-07`` -> ``NOR``)."""
    return player_id.split("-")[0]


def frame_positions(frame):
    """Return (ids, xy) for one frame. xy is an (n, 2) float array."""
    ids = [p["id"] for p in frame["players"]]
    xy = np.array([[p["x"], p["y"]] for p in frame["players"]], dtype=float)
    return ids, xy


def segment_distance(point, a, b):
    """Shortest distance from ``point`` to segment ``a``-``b``."""
    ab = b - a
    denom = float(np.dot(ab, ab))
    if denom < 1e-9:
        return float(np.hypot(point[0] - a[0], point[1] - a[1]))
    t = float(np.dot(point - a, ab) / denom)
    t = max(0.0, min(1.0, t))
    proj = a + t * ab
    return float(np.hypot(point[0] - proj[0], point[1] - proj[1]))
