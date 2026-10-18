"""space: compute the open-space heat map per 5-second window.

The pitch is divided into a 21 x 14 grid. For each 5-second window (25
frames), every cell counts nearby players; openness is
``1 - min(count / 3, 1)``. The most open named zone per window is recorded
so the explainer can narrate it ("Open space -- left wing unoccupied").
"""

import numpy as np

from .common import PITCH_H, PITCH_W, frame_positions


GRID_X = 21
GRID_Y = 14
WINDOW_S = 5.0


def _zone_label(cx, cy):
    """Name the most-open cell in coarse tactical language."""
    if cy < GRID_Y / 3:
        side = "left"
    elif cy >= 2 * GRID_Y / 3:
        side = "right"
    else:
        side = "center"
    x_units = (cx + 0.5) / GRID_X * PITCH_W
    if x_units > 88.0 or x_units < 17.0:
        return "box"
    if 35.0 < x_units < 70.0 and side == "center":
        return "mid"
    return side


def run(state):
    """Attach per-window space maps to the shared state."""
    frames = state["frames"]
    window_frames = max(1, int(round(WINDOW_S * float(state["match"]["fps"]))))
    windows = []

    for start in range(0, len(frames), window_frames):
        chunk = frames[start:start + window_frames]
        counts = np.zeros((GRID_X, GRID_Y))
        for frame in chunk:
            _ids, xy = frame_positions(frame)
            gx = np.clip((xy[:, 0] / PITCH_W * GRID_X).astype(int), 0, GRID_X - 1)
            gy = np.clip((xy[:, 1] / PITCH_H * GRID_Y).astype(int), 0, GRID_Y - 1)
            for x, y in zip(gx, gy):
                counts[x, y] += 1
        openness = 1.0 - np.minimum(counts / (3.0 * len(chunk)), 1.0)
        best = np.unravel_index(int(np.argmax(openness)), openness.shape)
        windows.append(
            {
                "t0": chunk[0]["t"],
                "t1": chunk[-1]["t"],
                "open_zone": _zone_label(best[0], best[1]),
                "open_score": round(float(openness[best]), 2),
                "cells": [round(float(v), 2) for v in openness.flatten()],
            }
        )

    state["space"] = windows
    return f"{len(windows)} heat maps"
