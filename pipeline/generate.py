#!/usr/bin/env python3
"""Match Microscope synthetic match generator.

Generates three deterministic, football-realistic 10-minute matches
(5 fps x 600 s = 3,000 frames each) into ``public/data/``.

Usage:
    python pipeline/generate.py

Constraints honoured:
- Pure Python standard library + numpy only. No network, no downloads.
- Deterministic: every match is seeded from its match id. Same seed
  always produces the same match. ``random`` is never used without a seed.
- Fast: well under 10 seconds per match on a laptop (vectorised numpy).
- Small: coordinates are rounded to 1 decimal and serialised with
  ``indent=1`` (proper indentation, human readable). Gzip compresses the
  repeated indentation extremely well, keeping each match under 400 KB
  gzipped. Never minified on purpose -- readability first.
- Pitch: 105 x 68 units, origin bottom-left. x = length, y = width.

Simulation model:
- Formations: home 4-3-3, away 4-2-3-1. Each player has an id, a role, a
  home spot, a top speed and a press aggression value.
- Ball state machine: possession -> pass / dribble / shot / turnover,
  loose ball -> nearest player picks it up.
- Player movement per tick:
      target = formation_home + ball_shift + role_offset + smooth_noise
      velocity = clamp(toward_target, 0, top_speed)
      position += velocity * dt
  The noise term is low-frequency sine-based (periods of 20-50 s), never
  white noise, so trails look like running, not jitter. Goalkeepers stay
  near their line and shuffle laterally with the ball.
- xG model (documented here, reused by the pipeline):
      dist       = euclidean distance from shot spot to goal centre
      central    = 1 - abs(y - 34) / 34          (1 = dead centre)
      n_press    = opponents within 4 units of the shooter
      z          = 1.5 - 0.16 * dist - 0.70 * n_press + 0.40 * central
      xg         = sigmoid(z) = 1 / (1 + exp(-z))
  So a central shot 8 units out with no pressure is ~0.65, while a wide
  shot 20+ units out under pressure is ~0.04. Goals are sampled from xg.
"""

import gzip
import hashlib
import json
import time
from pathlib import Path

import numpy as np


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

PITCH_W = 105.0
PITCH_H = 68.0
FPS = 5
DURATION_S = 600
N_FRAMES = FPS * DURATION_S
DT = 1.0 / FPS

OUT_DIR = Path(__file__).resolve().parent.parent / "public" / "data"

HOME_ID = "NOR"
AWAY_ID = "RIV"

# (role, home_x, home_y, top_speed, aggression)
HOME_SHAPE = [
    ("GK", 4.0, 34.0, 4.0, 0.10),
    ("DF", 20.0, 12.0, 6.4, 0.55),
    ("DF", 18.0, 26.0, 6.4, 0.60),
    ("DF", 18.0, 42.0, 6.4, 0.60),
    ("DF", 20.0, 56.0, 6.4, 0.55),
    ("MF", 36.0, 20.0, 7.1, 0.70),
    ("MF", 33.0, 34.0, 7.1, 0.75),
    ("MF", 36.0, 48.0, 7.1, 0.70),
    ("FW", 58.0, 14.0, 7.7, 0.80),
    ("FW", 60.0, 34.0, 7.7, 0.65),
    ("FW", 58.0, 54.0, 7.7, 0.80),
]

# Away 4-2-3-1, mirrored: away attacks towards x = 0.
AWAY_SHAPE = [
    ("GK", 101.0, 34.0, 4.0, 0.10),
    ("DF", 85.0, 12.0, 6.4, 0.55),
    ("DF", 87.0, 26.0, 6.4, 0.60),
    ("DF", 87.0, 42.0, 6.4, 0.60),
    ("DF", 85.0, 56.0, 6.4, 0.55),
    ("MF", 70.0, 26.0, 7.1, 0.70),
    ("MF", 70.0, 42.0, 7.1, 0.70),
    ("MF", 58.0, 16.0, 7.1, 0.80),
    ("MF", 56.0, 34.0, 7.2, 0.85),
    ("MF", 58.0, 52.0, 7.1, 0.80),
    ("FW", 46.0, 34.0, 7.8, 0.70),
]

MATCHES = [
    {
        "id": "syn-001",
        "matchday": "Matchday 1",
        "seed": 1101,
        "home_name": "Northside FC",
        "away_name": "Riverside United",
        "tempo": 1.00,
        "press": 1.00,
    },
    {
        "id": "syn-002",
        "matchday": "Matchday 2",
        "seed": 2202,
        "home_name": "Northside FC",
        "away_name": "Harbour Athletic",
        "tempo": 1.12,
        "press": 0.85,
    },
    {
        "id": "syn-003",
        "matchday": "Matchday 3",
        "seed": 3303,
        "home_name": "Eastvale Town",
        "away_name": "Riverside United",
        "tempo": 0.94,
        "press": 1.15,
    },
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def sigmoid(z):
    """Logistic function used by the xG model."""
    return 1.0 / (1.0 + np.exp(-z))


def shot_xg(x, y, n_press, attacking_home):
    """Return expected-goals value for a shot from (x, y).

    See module docstring for the documented formula.
    """
    goal_x = PITCH_W if attacking_home else 0.0
    goal_y = PITCH_H / 2.0
    dist = float(np.hypot(goal_x - x, goal_y - y))
    central = 1.0 - abs(y - goal_y) / goal_y
    z = 1.5 - 0.16 * dist - 0.70 * n_press + 0.40 * central
    return float(sigmoid(z)), dist


def zone_of(x, y):
    """Coarse pitch zone label used for annotation text."""
    if y < 68.0 / 3.0:
        side = "left"
    elif y > 2.0 * 68.0 / 3.0:
        side = "right"
    else:
        side = "center"
    if x > 88.0 or x < 17.0:
        return "box", side
    if 35.0 < x < 70.0:
        return "mid", side
    return side, side


# ---------------------------------------------------------------------------
# Match simulation
# ---------------------------------------------------------------------------

def simulate(match_cfg):
    """Simulate one match. Returns (match_meta, frames, events)."""
    rng = np.random.default_rng(match_cfg["seed"])
    tempo = match_cfg["tempo"]
    press_factor = match_cfg["press"]

    n_players = 22
    roles = []
    home_spots = np.zeros((n_players, 2))
    top_speed = np.zeros(n_players)
    aggression = np.zeros(n_players)
    ids = []

    for i, (role, hx, hy, spd, agg) in enumerate(HOME_SHAPE):
        roles.append(role)
        home_spots[i] = (hx, hy)
        top_speed[i] = spd
        aggression[i] = agg
        ids.append(f"{HOME_ID}-{i + 1:02d}")

    for j, (role, hx, hy, spd, agg) in enumerate(AWAY_SHAPE):
        k = 11 + j
        roles.append(role)
        home_spots[k] = (hx, hy)
        top_speed[k] = spd
        aggression[k] = agg
        ids.append(f"{AWAY_ID}-{j + 1:02d}")

    team_of = np.array([HOME_ID] * 11 + [AWAY_ID] * 11)
    is_gk = np.array([r == "GK" for r in roles])

    # Per-player smooth-noise parameters (low frequency sines only).
    noise_amp = rng.uniform(1.2, 2.4, size=(n_players, 2))
    noise_freq = rng.uniform(1.0 / 50.0, 1.0 / 20.0, size=(n_players, 2))
    noise_phase = rng.uniform(0.0, 2.0 * np.pi, size=(n_players, 2))

    pos = home_spots.copy()
    # Kickoff: ball at centre, home possession (NOR-08).
    pos += rng.uniform(-1.0, 1.0, size=pos.shape)
    ball = np.array([PITCH_W / 2.0, PITCH_H / 2.0])
    owner = 7  # NOR-08 starts with the ball.
    ball_vel = np.zeros(2)
    travel = None  # active pass flight, if any.
    carry_dist = 0.0
    last_dribble_spot = pos[owner].copy()
    ticks_since_shot = 999
    cooldown = 0  # post-goal celebration freeze (frames left)
    reset_for_home = False  # which side concedes, i.e. kicks off next
    score_home = 0
    score_away = 0

    frames = []
    events = []
    evt_counter = 0

    def add_event(t, type_, team, by, x, y, **extra):
        nonlocal evt_counter
        evt_counter += 1
        event = {
            "id": f"evt-{evt_counter:04d}",
            "t": round(float(t), 1),
            "type": type_,
            "team": team,
            "by": by,
            "x": round(float(x), 1),
            "y": round(float(y), 1),
        }
        event.update(extra)
        events.append(event)
        return event["id"]

    def do_kickoff_reset(conceded_home):
        """Reset to formation after a goal. Conceding team kicks off."""
        nonlocal owner, ball, ball_vel, travel, carry_dist
        nonlocal last_dribble_spot, ticks_since_shot
        pos[:] = home_spots + rng.uniform(-1.0, 1.0, size=pos.shape)
        ball = np.array([PITCH_W / 2.0, PITCH_H / 2.0])
        travel = None
        ball_vel = np.zeros(2)
        carry_dist = 0.0
        ticks_since_shot = 0
        owner = 18 if conceded_home else 7  # RIV-08 or NOR-08.
        last_dribble_spot = pos[owner].copy()

    for frame_idx in range(N_FRAMES):
        t = frame_idx * DT

        # Post-goal freeze: the ball stays where it crossed the line while
        # players celebrate, then formations reset for the kickoff.
        if cooldown > 0:
            cooldown -= 1
            if cooldown == 0:
                do_kickoff_reset(reset_for_home)

        # -- 1. Ball state machine --------------------------------------
        if travel is not None:
            travel["left"] -= 1
            alpha = 1.0 - max(travel["left"], 0) / travel["ticks"]
            ball = (1.0 - alpha) * travel["from"] + alpha * travel["to"]
            if travel["left"] <= 0:
                if travel["outcome"] == "complete":
                    owner = travel["receiver"]
                    last_dribble_spot = pos[owner].copy()
                    carry_dist = 0.0
                else:
                    owner = -1
                    ball_vel = rng.uniform(-1.5, 1.5, size=2)
                travel = None
        elif owner >= 0:
            carrier_team = team_of[owner]
            attacking_home = carrier_team == HOME_ID
            ball = pos[owner].copy()
            ticks_since_shot += 1

            # Pressure on the carrier: opponents within 5 units.
            diffs = pos - pos[owner]
            dists = np.hypot(diffs[:, 0], diffs[:, 1])
            opp_mask = team_of != carrier_team
            n_press = int(np.sum(opp_mask & (dists < 5.0)))

            carrier_x = pos[owner, 0]
            in_third = carrier_x > 82.0 if attacking_home else carrier_x < 23.0

            roll = rng.random()
            frozen = cooldown > 0
            p_pass = 0.0 if frozen else 0.034 * tempo
            p_shot = 0.0 if frozen else (
                0.030 * tempo if (in_third and ticks_since_shot > 50) else 0.0
            )
            p_turn = 0.0 if frozen else (
                (0.003 + 0.008 * min(n_press, 3) / 3.0) * press_factor
            )

            if roll < p_shot:
                xg, _dist = shot_xg(ball[0], ball[1], n_press, attacking_home)
                is_goal = rng.random() < xg
                outcome = "goal" if is_goal else rng.choice(
                    ["saved", "blocked", "missed"], p=[0.4, 0.35, 0.25]
                )
                add_event(
                    t, "shot", carrier_team, ids[owner], ball[0], ball[1],
                    xg=round(xg, 2), outcome=outcome,
                )
                ticks_since_shot = 0
                if is_goal:
                    add_event(
                        t, "goal", carrier_team, ids[owner], ball[0], ball[1],
                        outcome="goal",
                    )
                    if attacking_home:
                        score_home += 1
                    else:
                        score_away += 1
                    # Freeze: the ball stays in the net for 12 frames of
                    # celebration so goal frames show the real ball spot.
                    # The formation reset happens when the freeze ends.
                    cooldown = 12
                    reset_for_home = not attacking_home
            elif roll < p_shot + p_pass:
                mates = np.where(
                    (team_of == carrier_team) & (np.arange(n_players) != owner)
                )[0]
                fwd = 1.0 if attacking_home else -1.0
                gain = (pos[mates, 0] - pos[owner, 0]) * fwd
                dist = np.hypot(
                    pos[mates, 0] - pos[owner, 0],
                    pos[mates, 1] - pos[owner, 1],
                )
                score = gain * 0.6 - np.abs(dist - 18.0) * 0.4
                score += rng.normal(0.0, 4.0, size=score.shape)
                score[dist < 4.0] = -1e9
                receiver = mates[int(np.argmax(score))]
                lead = np.clip(dist[int(np.argmax(score))] / 12.0, 0.0, 1.0)
                target = pos[receiver] + lead * np.array([fwd * 2.0, 0.0])
                flight_ticks = int(np.clip(dist[int(np.argmax(score))] / 6.0, 2, 8))
                p_incomplete = 0.10 + 0.25 * min(n_press, 3) / 3.0
                outcome = (
                    "incomplete"
                    if rng.random() < p_incomplete
                    else "complete"
                )
                add_event(
                    t, "pass", carrier_team, ids[owner],
                    pos[owner, 0], pos[owner, 1],
                    to=ids[receiver], outcome=outcome,
                )
                travel = {
                    "from": pos[owner].copy(),
                    "to": target.copy(),
                    "ticks": flight_ticks,
                    "left": flight_ticks,
                    "receiver": int(receiver),
                    "outcome": outcome,
                }
                owner = -1
            elif roll < p_shot + p_pass + p_turn:
                near_opp = np.where(opp_mask)[0]
                od = np.hypot(
                    pos[near_opp, 0] - pos[owner, 0],
                    pos[near_opp, 1] - pos[owner, 1],
                )
                tackler = near_opp[int(np.argmin(od))]
                if od.min() < 3.0 and rng.random() < 0.6:
                    add_event(
                        t, "tackle", team_of[tackler], ids[tackler],
                        pos[owner, 0], pos[owner, 1],
                        outcome="won",
                    )
                    add_event(
                        t, "turnover", team_of[tackler], ids[tackler],
                        pos[owner, 0], pos[owner, 1],
                        outcome="won",
                    )
                    owner = int(tackler)
                    last_dribble_spot = pos[owner].copy()
                    carry_dist = 0.0
                else:
                    add_event(
                        t, "turnover", carrier_team, ids[owner],
                        pos[owner, 0], pos[owner, 1],
                        outcome="lost",
                    )
                    owner = -1
                    ball_vel = rng.uniform(-2.0, 2.0, size=2)
            else:
                # Dribble: emit an event every ~14 units carried.
                carry_dist = float(
                    np.hypot(
                        pos[owner, 0] - last_dribble_spot[0],
                        pos[owner, 1] - last_dribble_spot[1],
                    )
                )
                if carry_dist > 14.0:
                    add_event(
                        t, "dribble", carrier_team, ids[owner],
                        pos[owner, 0], pos[owner, 1],
                        outcome="complete",
                    )
                    last_dribble_spot = pos[owner].copy()
        else:
            # Loose ball: friction, then nearest player claims it.
            ball = ball + ball_vel * DT
            ball_vel *= 0.92
            diffs = pos - ball
            dists = np.hypot(diffs[:, 0], diffs[:, 1])
            nearest = int(np.argmin(dists))
            if dists[nearest] < 2.2:
                was_travel = False
                owner = nearest
                last_dribble_spot = pos[owner].copy()
                carry_dist = 0.0

        # -- 2. Player movement -----------------------------------------
        ball_shift = (ball - np.array([PITCH_W / 2.0, PITCH_H / 2.0])) * 0.30
        shift_norm = float(np.hypot(ball_shift[0], ball_shift[1]))
        if shift_norm > 12.0:
            ball_shift *= 12.0 / shift_norm

        targets = home_spots + ball_shift
        s1 = np.sin(2.0 * np.pi * noise_freq[:, 0] * t + noise_phase[:, 0])
        s2 = np.sin(2.0 * np.pi * noise_freq[:, 1] * t + noise_phase[:, 1])
        targets[:, 0] += noise_amp[:, 0] * s1
        targets[:, 1] += noise_amp[:, 1] * s2

        if owner >= 0:
            # Two most aggressive nearby opponents press the carrier.
            opp = np.where(team_of != team_of[owner])[0]
            od = np.hypot(
                pos[opp, 0] - pos[owner, 0], pos[opp, 1] - pos[owner, 1]
            )
            press_rank = np.argsort(od + (1.0 - aggression[opp]) * 12.0)
            for k in press_rank[:2]:
                idx = opp[k]
                if not is_gk[idx]:
                    targets[idx] = pos[owner] + rng.uniform(-0.6, 0.6, size=2)
            # Carrier drives towards the opponent goal -- or stands still
            # during the post-goal celebration freeze.
            if cooldown > 0:
                targets[owner] = pos[owner]
            else:
                direction = 1.0 if team_of[owner] == HOME_ID else -1.0
                targets[owner, 0] = pos[owner, 0] + direction * 9.0 * tempo
                targets[owner, 1] = pos[owner, 1] + 3.0 * np.sin(t * 0.7 + owner)

        # Goalkeepers hold their line and shuffle with the ball.
        for gk_idx, line_x in ((0, 4.0), (11, 101.0)):
            targets[gk_idx, 0] = line_x + (ball[0] - line_x) * 0.06
            targets[gk_idx, 1] = 34.0 + (ball[1] - 34.0) * 0.35

        if owner < 0 and travel is None:
            # Loose ball: the three nearest outfield players hunt it down,
            # otherwise play would stall with nobody near the ball.
            loose_d = np.hypot(pos[:, 0] - ball[0], pos[:, 1] - ball[1])
            chase_order = np.argsort(loose_d + is_gk * 1e9)
            for idx in chase_order[:3]:
                targets[int(idx)] = ball

        to_target = targets - pos
        desired = to_target / DT
        speeds = np.hypot(desired[:, 0], desired[:, 1])
        max_spd = top_speed * tempo
        over = speeds > max_spd
        desired[over] *= (max_spd[over] / speeds[over])[:, None]
        vel = desired
        pos = pos + vel * DT
        pos[:, 0] = np.clip(pos[:, 0], 1.0, PITCH_W - 1.0)
        pos[:, 1] = np.clip(pos[:, 1], 1.0, PITCH_H - 1.0)

        # -- 3. Record frame --------------------------------------------
        # Frames store positions only (id, x, y). The team is derived from
        # the id prefix ("NOR-" / "RIV-"), and velocities are recomputed by
        # the tracker job from consecutive positions. This keeps each match
        # under the 400 KB gzipped budget while staying human readable.
        players = []
        for i in range(n_players):
            players.append(
                {
                    "id": ids[i],
                    "x": round(float(pos[i, 0]), 1),
                    "y": round(float(pos[i, 1]), 1),
                }
            )
        frames.append(
            {
                "t": round(float(t), 1),
                "ball": {
                    "x": round(float(ball[0]), 1),
                    "y": round(float(ball[1]), 1),
                    "z": 0.0,
                    "owner": ids[owner] if owner >= 0 else None,
                },
                "players": players,
            }
        )

    meta = {
        "id": match_cfg["id"],
        "matchday": match_cfg.get("matchday", match_cfg["id"]),
        "home": {"id": HOME_ID, "name": match_cfg.get("home_name", "Northside FC"), "color": "#E8ECEF"},
        "away": {"id": AWAY_ID, "name": match_cfg.get("away_name", "Riverside United"), "color": "#C8FF3D"},
        "duration": DURATION_S,
        "fps": FPS,
        "score": {"home": score_home, "away": score_away},
    }
    return meta, frames, events


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    started = time.time()
    index = []

    for cfg in MATCHES:
        match_started = time.time()
        meta, frames, events = simulate(cfg)
        payload = {"match": meta, "frames": frames, "events": events}
        out_path = OUT_DIR / f"match-{meta['id']}.json"
        # indent=1: proper human-readable indentation, never minified.
        # Gzip compresses the repeated indentation away, so files stay
        # well under the 400 KB gzipped budget.
        with open(out_path, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=1)
            handle.write("\n")

        raw_bytes = out_path.stat().st_size
        with open(out_path, "rb") as handle:
            gz_bytes = len(gzip.compress(handle.read()))
        elapsed = time.time() - match_started
        print(
            f"{meta['id']}: {len(frames)} frames, {len(events)} events, "
            f"score {meta['score']['home']}-{meta['score']['away']}, "
            f"{raw_bytes / 1024:.0f} KB raw, {gz_bytes / 1024:.0f} KB gz, "
            f"{elapsed:.1f}s"
        )
        index.append(
            {
                "id": meta["id"],
                "matchday": meta["matchday"],
                "home": meta["home"],
                "away": meta["away"],
                "score": meta["score"],
                "duration": meta["duration"],
                "fps": meta["fps"],
                "frames": len(frames),
                "events": len(events),
            }
        )

    with open(OUT_DIR / "index.json", "w", encoding="utf-8") as handle:
        json.dump({"matches": index}, handle, indent=1)
        handle.write("\n")

    print(f"done in {time.time() - started:.1f}s -> {OUT_DIR}")


if __name__ == "__main__":
    main()
