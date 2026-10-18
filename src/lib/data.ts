export interface TeamMeta {
  id: string;
  name: string;
  color: string;
}

export interface MatchMeta {
  id: string;
  matchday: string;
  home: TeamMeta;
  away: TeamMeta;
  duration: number;
  fps: number;
  score: { home: number; away: number };
}

export interface FramePlayer {
  id: string;
  x: number;
  y: number;
}

export interface Frame {
  t: number;
  ball: { x: number; y: number; z: number; owner: string | null };
  players: FramePlayer[];
}

export interface MatchEvent {
  id: string;
  t: number;
  type: string;
  team: string;
  by: string;
  to?: string;
  x: number;
  y: number;
  outcome?: string;
  xg?: number;
}

export interface MatchFile {
  match: MatchMeta;
  frames: Frame[];
  events: MatchEvent[];
}

export interface Annotation {
  id: string;
  t: number;
  kind: string;
  text: { en: string; es: string; fr: string };
  evidence: string[];
  confidence: number;
  job: string;
  verified?: boolean;
  reason?: string;
}

export interface LaneOption {
  to: string;
  risk: string;
  open: number;
  gain: number;
  blockers: number;
}

export interface LaneSet {
  t: number;
  by: string;
  options: LaneOption[];
}

export interface SpaceWindow {
  t0: number;
  t1: number;
  open_zone: string;
  open_score: number;
  cells: number[];
}

export interface PressureFrame {
  t: number;
  owner: string | null;
  score: number;
  n: number;
}

export interface ChartsFile {
  match: string;
  pass_network: {
    nodes: { id: string; team: string; passes: number }[];
    links: { source: string; dst: string; count: number }[];
  };
  momentum: { t: number; home: number; away: number }[];
  xg_cum: { t: number; team: string; by: string; xg: number; home: number; away: number }[];
  pressure: { t: number; v: number }[];
  possession: Record<string, number>;
  lanes: LaneSet[];
  space: SpaceWindow[];
  pressure_frames: PressureFrame[];
}

export interface PersonalizedFile {
  match: string;
  roles: Record<
    string,
    {
      layers: string[];
      annotations: string[];
      show_coords: boolean;
      show_confidence: boolean;
      show_event_ids: boolean;
      export: boolean;
    }
  >;
  players: Record<string, { events: string[]; timeline: number[]; involvement: number }>;
  languages: string[];
}

export interface TraceFile {
  match: string;
  jobs: { job: string; status: string; detail: string; attempts: number }[];
  handoffs: { from: string; to: string; timestamp: number; payload_size: number; status: string }[];
}

export interface IndexFile {
  matches: (MatchMeta & { frames: number; events: number })[];
}

/**
 * Base path for static data that works both locally ("/data/...") and on
 * GitHub Pages project sites ("/match-microscope/data/..."). Derived from
 * the served page path, so no build-time env var is needed.
 */
export function dataUrl(name: string): string {
  if (typeof window === 'undefined') return `/data/${name}`;
  const path = window.location.pathname;
  const base = path.endsWith('/') ? path : `${path.slice(0, path.lastIndexOf('/') + 1)}`;
  return `${base}data/${name}`;
}

export async function loadJson<T>(name: string): Promise<T> {
  const res = await fetch(dataUrl(name));
  if (!res.ok) throw new Error(`failed to load ${name}: ${res.status}`);
  return (await res.json()) as T;
}
