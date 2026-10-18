import type {
  Annotation,
  ChartsFile,
  Frame,
  MatchEvent,
  MatchFile,
  PersonalizedFile,
  TraceFile,
} from './data';
import { playerName } from './names';

/**
 * Bring-your-own-data, in the browser.
 *
 * This is a *lean preview*: given a raw match file with the same shape the
 * pipeline consumes ({ match, frames, events }), it validates it and derives
 * just enough client-side to make the pitch, timeline, scoreboard, moments,
 * signals and player views work. It is not a second copy of the pipeline —
 * the heavy tactical jobs (passing lanes, open-space maps) are left empty
 * here and only produced by `python pipeline/run_pipeline.py --input …`.
 */

export interface ImportBundle {
  match: MatchFile;
  annotations: Annotation[];
  charts: ChartsFile;
  personalized: PersonalizedFile;
  trace: TraceFile;
}

export type ImportResult =
  | { ok: true; bundle: ImportBundle }
  | { ok: false; error: string };

const WINDOW_S = 5;
const PRESSURE_RADIUS = 8;
const LANGUAGES = ['en', 'es', 'fr'];

function teamOf(playerId: string): string {
  return playerId.split('-')[0];
}

function validate(raw: unknown): { error: string } | { match: MatchFile } {
  if (!raw || typeof raw !== 'object') return { error: 'That file is not a JSON object.' };
  const r = raw as Partial<MatchFile> & Record<string, unknown>;
  const m = r.match as MatchFile['match'] | undefined;
  if (!m || typeof m !== 'object') return { error: 'Missing "match" section.' };
  if (!m.home?.id || !m.away?.id) return { error: '"match.home.id" and "match.away.id" are required.' };
  if (!(typeof m.fps === 'number') || m.fps <= 0) return { error: '"match.fps" must be a positive number.' };
  if (!(typeof m.duration === 'number') || m.duration <= 0) return { error: '"match.duration" must be a positive number of seconds.' };
  if (!Array.isArray(r.frames) || r.frames.length === 0) return { error: '"frames" must be a non-empty array.' };
  if (!Array.isArray(r.events)) return { error: '"events" must be an array.' };

  const first = r.frames[0] as Frame | undefined;
  if (!first || !Array.isArray(first.players) || first.players.length === 0) {
    return { error: 'Each frame needs a non-empty "players" array.' };
  }
  const count = first.players.length;
  for (let i = 0; i < r.frames.length; i += 1) {
    const f = r.frames[i] as Frame;
    if (!Array.isArray(f.players) || f.players.length !== count) {
      return { error: `Frame ${i} has ${f.players?.length ?? 0} players, expected ${count}.` };
    }
    if (!f.ball || typeof f.ball.x !== 'number' || typeof f.ball.y !== 'number') {
      return { error: `Frame ${i} is missing a valid "ball" position.` };
    }
  }

  m.id = m.id || 'custom';
  m.score = m.score ?? { home: 0, away: 0 };
  m.matchday = m.matchday ?? 'Custom match';
  m.home.color = m.home.color ?? '#E8ECEF';
  m.away.color = m.away.color ?? '#C8FF3D';
  m.home.name = m.home.name ?? m.home.id;
  m.away.name = m.away.name ?? m.away.id;
  return { match: { match: m, frames: r.frames as Frame[], events: r.events as MatchEvent[] } };
}

function xgOf(e: MatchEvent): number {
  return typeof e.xg === 'number' ? e.xg : 0;
}

function buildPressureFrames(frames: Frame[]): ChartsFile['pressure_frames'] {
  return frames.map((f) => {
    const owner = f.ball.owner ?? null;
    if (!owner) return { t: f.t, owner: null, score: 0, n: 0 };
    const carrier = f.players.find((p) => p.id === owner);
    if (!carrier) return { t: f.t, owner, score: 0, n: 0 };
    const carrierTeam = teamOf(owner);
    let score = 0;
    let n = 0;
    for (const p of f.players) {
      if (teamOf(p.id) === carrierTeam) continue;
      const d = Math.hypot(p.x - carrier.x, p.y - carrier.y);
      if (d < PRESSURE_RADIUS) {
        score += 1 - d / PRESSURE_RADIUS;
        n += 1;
      }
    }
    return { t: f.t, owner, score, n };
  });
}

function buildPossession(frames: Frame[], homeId: string, awayId: string): Record<string, number> {
  let home = 0;
  let away = 0;
  for (const f of frames) {
    const owner = f.ball.owner;
    if (!owner) continue;
    if (teamOf(owner) === homeId) home += 1;
    else away += 1;
  }
  const total = home + away;
  if (total === 0) return { [homeId]: 0, [awayId]: 0 };
  return { [homeId]: home / total, [awayId]: away / total };
}

function buildMomentum(
  frames: Frame[],
  framesPressure: ChartsFile['pressure_frames'],
  events: MatchEvent[],
  homeId: string,
  duration: number,
): ChartsFile['momentum'] {
  const windows = Math.max(1, Math.ceil(duration / WINDOW_S));
  const home = new Array<number>(windows).fill(0);
  const away = new Array<number>(windows).fill(0);

  frames.forEach((f, i) => {
    const owner = f.ball.owner;
    if (!owner) return;
    const w = Math.min(windows - 1, Math.floor(f.t / WINDOW_S));
    const weight = 1 + (framesPressure[i]?.score ?? 0);
    if (teamOf(owner) === homeId) home[w] += weight;
    else away[w] += weight;
  });

  for (const e of events) {
    const w = Math.min(windows - 1, Math.max(0, Math.floor(e.t / WINDOW_S)));
    const weight = e.type === 'goal' ? 6 : e.type === 'shot' ? 2 + xgOf(e) * 4 : 0.2;
    if (e.team === homeId) home[w] += weight;
    else away[w] += weight;
  }

  return Array.from({ length: windows }, (_, i) => ({
    t: i * WINDOW_S,
    home: home[i],
    away: away[i],
  }));
}

function buildXg(events: MatchEvent[], homeId: string): ChartsFile['xg_cum'] {
  let home = 0;
  let away = 0;
  return events
    .filter((e) => e.type === 'shot')
    .sort((a, b) => a.t - b.t)
    .map((e) => {
      const xg = xgOf(e);
      if (e.team === homeId) home += xg;
      else away += xg;
      return { t: e.t, team: e.team, by: e.by, xg, home, away };
    });
}

function buildPassNetwork(
  frames: Frame[],
  events: MatchEvent[],
): ChartsFile['pass_network'] {
  const counts = new Map<string, number>();
  const bump = (from: string, to: string) => {
    if (from === to) return;
    const key = `${from}|${to}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };

  const passes = events.filter((e) => e.type === 'pass' && e.to && e.by !== e.to);
  if (passes.length > 0) {
    for (const e of passes) bump(e.by, e.to as string);
  } else {
    // No pass events in the file — infer from changes of ball owner.
    for (let i = 1; i < frames.length; i += 1) {
      const a = frames[i - 1].ball.owner;
      const b = frames[i].ball.owner;
      if (a && b && a !== b) bump(a, b);
    }
  }

  const made = new Map<string, number>();
  const links = [...counts.entries()].map(([key, count]) => {
    const [source, dst] = key.split('|');
    made.set(source, (made.get(source) ?? 0) + count);
    made.set(dst, made.get(dst) ?? 0);
    return { source, dst, count };
  });

  const nodes = [...made.entries()]
    .map(([id, count]) => ({ id, team: teamOf(id), passes: count }))
    .filter((n) => n.passes > 0)
    .sort((a, b) => b.passes - a.passes);

  return { nodes, links: links.sort((a, b) => b.count - a.count) };
}

function goalText(e: MatchEvent, teamName: string) {
  const who = playerName(e.by);
  return {
    en: `Goal for ${teamName}: ${who} puts it away.`,
    es: `Gol de ${teamName}: ${who} la manda a la red.`,
    fr: `But pour ${teamName} : ${who} conclut.`,
  };
}

function chanceText(e: MatchEvent) {
  const who = playerName(e.by);
  const xg = xgOf(e).toFixed(2);
  return {
    en: `Big chance: ${who} gets a shot away (goal chance ${xg}).`,
    es: `Ocasion clara: ${who} dispara (xG ${xg}).`,
    fr: `Grosse occasion : ${who} frappe (xG ${xg}).`,
  };
}

function buildAnnotations(match: MatchFile): Annotation[] {
  const { home, away } = match.match;
  const annotations: Annotation[] = [];
  const events = [...match.events].sort((a, b) => a.t - b.t);
  let n = 0;

  for (const e of events) {
    const teamName = e.team === home.id ? home.name : away.name;
    if (e.type === 'goal') {
      n += 1;
      annotations.push({
        id: `ann-${String(n).padStart(4, '0')}`,
        t: e.t,
        kind: 'goal',
        text: goalText(e, teamName),
        evidence: [e.id],
        confidence: 0.99,
        job: 'explain',
        verified: true,
      });
    } else if (e.type === 'shot' && xgOf(e) >= 0.15) {
      n += 1;
      annotations.push({
        id: `ann-${String(n).padStart(4, '0')}`,
        t: e.t,
        kind: 'chance',
        text: chanceText(e),
        evidence: [e.id],
        confidence: Math.min(0.95, 0.4 + xgOf(e)),
        job: 'explain',
        verified: true,
      });
    }
  }
  return annotations;
}

function buildPersonalized(match: MatchFile, annotations: Annotation[]): PersonalizedFile {
  const allAnns = annotations.map((a) => a.id);
  const storyAnns = annotations.filter((a) => a.kind === 'goal' || a.kind === 'chance').map((a) => a.id);

  const roster = match.frames[0].players.map((p) => p.id);
  const players: PersonalizedFile['players'] = {};
  for (const id of roster) players[id] = { events: [], timeline: [], involvement: 0 };

  for (const e of match.events) {
    if (players[e.by]) players[e.by].events.push(e.id);
    if (e.to && players[e.to]) players[e.to].events.push(e.id);
  }
  match.frames.forEach((f, i) => {
    const owner = f.ball.owner;
    if (owner && players[owner]) players[owner].timeline.push(i);
  });
  for (const id of roster) {
    players[id].involvement = players[id].events.length + players[id].timeline.length;
  }

  return {
    match: match.match.id,
    roles: {
      fan: { layers: ['momentum'], annotations: storyAnns, show_coords: false, show_confidence: false, show_event_ids: false, export: false },
      coach: { layers: ['pressure', 'lanes', 'space'], annotations: allAnns, show_coords: false, show_confidence: false, show_event_ids: false, export: true },
      analyst: { layers: ['pressure', 'lanes', 'space', 'trails', 'momentum', 'danger'], annotations: allAnns, show_coords: true, show_confidence: true, show_event_ids: true, export: true },
      player: { layers: ['trails'], annotations: allAnns, show_coords: false, show_confidence: false, show_event_ids: false, export: false },
    },
    players,
    languages: LANGUAGES,
  };
}

function buildTrace(match: MatchFile, charts: ChartsFile, annotations: Annotation[]): TraceFile {
  const goals = match.events.filter((e) => e.type === 'goal').length;
  const shotCount = match.events.filter((e) => e.type === 'shot').length;
  const peak = charts.pressure_frames.reduce((m, p) => Math.max(m, p.score), 0);
  const homeId = match.match.home.id;
  const poss = Math.round((charts.possession[homeId] ?? 0) * 100);
  const grounded = annotations.filter((a) => a.verified !== false).length;
  const links = charts.pass_network.links.length;

  return {
    match: match.match.id,
    jobs: [
      { job: 'ingest', status: 'ok', detail: `${match.frames.length} frames, ${match.events.length} events`, attempts: 1 },
      { job: 'tracker', status: 'ok', detail: `${match.frames.length} frames tracked, ${homeId} ${poss}% possession`, attempts: 1 },
      { job: 'pressure', status: 'ok', detail: `${charts.pressure_frames.length} scores, peak ${peak.toFixed(2)}`, attempts: 1 },
      { job: 'lanes', status: 'ok', detail: 'skipped in browser preview — run the CLI for lanes', attempts: 1 },
      { job: 'space', status: 'ok', detail: 'skipped in browser preview — run the CLI for space', attempts: 1 },
      { job: 'charts', status: 'ok', detail: `${links} links, ${charts.momentum.length} momentum windows, ${shotCount} shots`, attempts: 1 },
      { job: 'explain', status: 'ok', detail: `${annotations.length} annotations (${grounded} grounded)`, attempts: 1 },
      { job: 'verify', status: 'ok', detail: `${grounded} verified, ${annotations.length - grounded} failed`, attempts: 1 },
      { job: 'personalize', status: 'ok', detail: `4 modes x ${LANGUAGES.length} langs, ${match.frames[0].players.length} player profiles`, attempts: 1 },
      { job: 'director', status: 'ok', detail: `computed in your browser (${goals} goals)`, attempts: 1 },
    ],
    handoffs: [],
  };
}

/** Validate a raw match and build the derived files the app needs to render it. */
export function importMatch(raw: unknown): ImportResult {
  const checked = validate(raw);
  if ('error' in checked) return { ok: false, error: checked.error };

  const match = checked.match;
  const { home, away } = match.match;
  const pressureFrames = buildPressureFrames(match.frames);
  const charts: ChartsFile = {
    match: match.match.id,
    pass_network: buildPassNetwork(match.frames, match.events),
    momentum: buildMomentum(match.frames, pressureFrames, match.events, home.id, match.match.duration),
    xg_cum: buildXg(match.events, home.id),
    pressure: pressureFrames
      .filter((_, i) => i % Math.max(1, Math.round(WINDOW_S * match.match.fps)) === 0)
      .map((p) => ({ t: p.t, v: p.score })),
    possession: buildPossession(match.frames, home.id, away.id),
    lanes: [],
    space: [],
    pressure_frames: pressureFrames,
  };
  const annotations = buildAnnotations(match);
  const personalized = buildPersonalized(match, annotations);
  const trace = buildTrace(match, charts, annotations);

  return { ok: true, bundle: { match, annotations, charts, personalized, trace } };
}
