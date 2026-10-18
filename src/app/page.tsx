'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ChartPanel from '../components/ChartPanel';
import CommandBar from '../components/CommandBar';
import CrewTrace from '../components/CrewTrace';
import LanguageSwitcher from '../components/LanguageSwitcher';
import MatchSwitcher from '../components/MatchSwitcher';
import PipelinePanel from '../components/PipelinePanel';
import Pitch from '../components/Pitch';
import PlayerCard from '../components/PlayerCard';
import RoleSwitcher from '../components/RoleSwitcher';
import Scoreboard from '../components/Scoreboard';
import Timeline from '../components/Timeline';
import { palette } from '../lib/colors';
import type {
  Annotation,
  ChartsFile,
  IndexFile,
  MatchEvent,
  MatchFile,
  PersonalizedFile,
  TraceFile,
} from '../lib/data';
import { loadJson } from '../lib/data';
import { importMatch, type ImportBundle } from '../lib/import';
import { formatT } from '../lib/format';
import { heatForTime, lanesForTime } from '../lib/geometry';
import { playerName } from '../lib/names';

type Lang = 'en' | 'es' | 'fr';

const ROLE_BLURBS: Record<string, string> = {
  analyst: 'Everything: every overlay, raw numbers, and the proof behind each claim.',
  coach: 'Tactics only: pressure, lanes and space — plus a one-click report export.',
  fan: 'Just the story: big moments, momentum and danger. Start here.',
  player: 'Follow one player: their touches, heat and influence on the match.',
};

const LAYER_LABELS: Record<string, string> = {
  pressure: 'Pressure',
  lanes: 'Passing lanes',
  space: 'Open space',
  trails: 'Player trails',
  momentum: 'Momentum',
  danger: 'Danger zone',
};

const HOME_ROLES = ['Goalkeeper', 'Defender', 'Defender', 'Defender', 'Defender', 'Midfielder', 'Midfielder', 'Midfielder', 'Forward', 'Forward', 'Forward'];
const AWAY_ROLES = ['Goalkeeper', 'Defender', 'Defender', 'Defender', 'Defender', 'Midfielder', 'Midfielder', 'Midfielder', 'Midfielder', 'Midfielder', 'Forward'];

function roleOf(roster: string[], playerId: string): string {
  const i = roster.indexOf(playerId);
  if (i < 0) return 'Player';
  if (i < 11) return HOME_ROLES[i];
  return AWAY_ROLES[i - 11];
}

function readParams(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const out: Record<string, string> = {};
  new URLSearchParams(window.location.search).forEach((v, k) => {
    out[k] = v;
  });
  return out;
}

export default function Page() {
  const [index, setIndex] = useState<IndexFile | null>(null);
  const [matchId, setMatchId] = useState('syn-001');
  const [data, setData] = useState<MatchFile | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [charts, setCharts] = useState<ChartsFile | null>(null);
  const [personalized, setPersonalized] = useState<PersonalizedFile | null>(null);
  const [trace, setTrace] = useState<TraceFile | null>(null);
  const [frameIdx, setFrameIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [role, setRole] = useState('fan');
  const [lang, setLang] = useState<Lang>('en');
  const [focus, setFocus] = useState<string | null>(null);
  const [layers, setLayers] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [welcomed, setWelcomed] = useState(true);
  const [tab, setTab] = useState<'moments' | 'signals' | 'players' | 'direct' | 'story' | 'crew'>('moments');
  const [custom, setCustom] = useState<ImportBundle | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  // Initial URL params: ?match=&role=&lang=&player=&t=
  useEffect(() => {
    const p = readParams();
    if (p.match) setMatchId(p.match);
    if (p.role && ['analyst', 'coach', 'fan', 'player'].includes(p.role)) setRole(p.role);
    if (p.lang && ['en', 'es', 'fr'].includes(p.lang)) setLang(p.lang as Lang);
    if (p.player) setFocus(p.player);
    if (p.t) setFrameIdx(Math.max(0, Math.round(Number(p.t) * 5)));
    try {
      if (!window.localStorage.getItem('mm-welcomed')) setWelcomed(false);
    } catch {
      setWelcomed(false);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    loadJson<IndexFile>('index.json').then(setIndex).catch((e) => setError(String(e)));
  }, []);

  const fps = data?.match.fps ?? 5;
  const duration = data?.match.duration ?? 600;

  const displayIndex = useMemo<IndexFile | null>(() => {
    if (!index) return custom ? { matches: [] } : null;
    if (!custom) return index;
    const entry = {
      ...custom.match.match,
      frames: custom.match.frames.length,
      events: custom.match.events.length,
    };
    return { matches: [...index.matches.filter((m) => m.id !== entry.id), entry] };
  }, [index, custom]);

  useEffect(() => {
    if (!ready) return;
    if (custom && matchId === custom.match.match.id) {
      setError(null);
      setData(custom.match);
      setAnnotations(custom.annotations);
      setCharts(custom.charts);
      setPersonalized(custom.personalized);
      setTrace(custom.trace);
      setFrameIdx((i) => Math.min(i, custom.match.frames.length - 1));
      return;
    }
    setError(null);
    setData(null);
    let cancelled = false;
    (async () => {
      try {
        const [m, a, c, p, t] = await Promise.all([
          loadJson<MatchFile>(`match-${matchId}.json`),
          loadJson<{ annotations: Annotation[] }>(`annotations-${matchId}.json`),
          loadJson<ChartsFile>(`charts-${matchId}.json`),
          loadJson<PersonalizedFile>(`personalized-${matchId}.json`),
          loadJson<TraceFile>(`trace-${matchId}.json`),
        ]);
        if (cancelled) return;
        setData(m);
        setAnnotations(a.annotations);
        setCharts(c);
        setPersonalized(p);
        setTrace(t);
        setFrameIdx((i) => Math.min(i, m.frames.length - 1));
      } catch (e) {
        if (cancelled) return;
        // A browser-imported match lives only in memory; a stale/shared link
        // to it won't resolve on disk. Fall back to the first real match
        // instead of surfacing a 404.
        const known = index?.matches ?? [];
        if (known.length > 0 && !known.some((m) => m.id === matchId)) {
          setError(null);
          setMatchId(known[0].id);
          setFrameIdx(0);
          return;
        }
        setError(`failed to load ${matchId}: ${e}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [matchId, ready, custom, index]);

  // Role -> default layers. Manual toggles override until the role changes.
  useEffect(() => {
    if (!personalized) return;
    setLayers(personalized.roles[role]?.layers ?? []);
  }, [role, personalized]);

  // Pick a player automatically only when the role first becomes "player" —
  // never re-pick after that, so the user can release a player.
  const prevRoleRef = useRef(role);
  useEffect(() => {
    if (!personalized) return;
    if (role === 'player' && prevRoleRef.current !== 'player') {
      const entries = Object.entries(personalized.players).sort((a, b) => b[1].involvement - a[1].involvement);
      setFocus((cur) => cur ?? entries[0]?.[0] ?? null);
    }
    prevRoleRef.current = role;
  }, [role, personalized]);

  // Shareable personalization link: match + role + lang + player + time.
  useEffect(() => {
    if (!ready || !data) return;
    const q = new URLSearchParams({
      match: matchId,
      role,
      lang,
      t: String(Math.round((frameIdx / fps) * 10) / 10),
    });
    if (focus) q.set('player', focus);
    window.history.replaceState(null, '', `?${q.toString()}`);
  }, [matchId, role, lang, focus, frameIdx, ready, data, fps]);

  // Playback at ~2x: one frame every (1000/fps)/2 ms.
  useEffect(() => {
    if (!playing || !data) return;
    const id = window.setInterval(() => {
      setFrameIdx((i) => {
        if (i >= data.frames.length - 1) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, Math.max(20, Math.round((1000 / fps) / 2)));
    return () => window.clearInterval(id);
  }, [playing, data, fps]);

  // Keyboard: space = play/pause, arrows = step (outside inputs).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.code === 'Space') {
        e.preventDefault();
        setPlaying((v) => !v);
      } else if (e.key === 'ArrowRight') {
        setFrameIdx((i) => Math.min((data?.frames.length ?? 1) - 1, i + 1));
      } else if (e.key === 'ArrowLeft') {
        setFrameIdx((i) => Math.max(0, i - 1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [data]);

  const eventsById = useMemo(() => {
    const m = new Map<string, MatchEvent>();
    for (const e of data?.events ?? []) m.set(e.id, e);
    return m;
  }, [data]);

  const frame = data?.frames[frameIdx];
  const frameT = frame?.t ?? 0;
  const roster: string[] = data ? data.frames[0].players.map((p) => p.id) : [];

  const roleAnns = useMemo(() => {
    if (!personalized) return annotations;
    const allowed = new Set(personalized.roles[role]?.annotations ?? []);
    let list = annotations.filter((a) => allowed.has(a.id));
    if (role === 'player' && focus) {
      list = list.filter(
        (a) =>
          a.kind === 'goal' ||
          a.evidence.some((id) => {
            const e = eventsById.get(id);
            return e && (e.by === focus || e.to === focus);
          }),
      );
    }
    return [...list].sort((a, b) => a.t - b.t);
  }, [annotations, personalized, role, focus, eventsById]);

  const pitchAnns = useMemo(() => {
    return roleAnns
      .filter((a) => Math.abs(a.t - frameT) < 3)
      .map((ann) => {
        const ev = ann.evidence.map((id) => eventsById.get(id)).find((e) => e);
        if (ev) return { ann, x: ev.x, y: ev.y };
        if (frame?.ball) return { ann, x: frame.ball.x, y: frame.ball.y };
        return { ann, x: 52.5, y: 34 };
      });
  }, [roleAnns, frameT, eventsById, frame]);

  const laneSet = useMemo(
    () => (charts ? lanesForTime(charts.lanes, frameT) : null),
    [charts, frameT],
  );
  const heat = useMemo(() => (charts ? heatForTime(charts.space, frameT) : null), [charts, frameT]);
  const pressureEntry = charts?.pressure_frames[frameIdx];

  const danger = useMemo(() => {
    if (!data) return { home: 0, away: 0 };
    const homeId = data.match.home.id;
    let home = 0;
    let away = 0;
    for (const e of data.events) {
      if (e.type !== 'shot' || e.t < frameT - 60 || e.t > frameT) continue;
      if (e.team === homeId) home += e.xg ?? 0;
      else away += e.xg ?? 0;
    }
    return { home: Math.min(home, 1), away: Math.min(away, 1) };
  }, [data, frameT]);

  const totals = useMemo(() => {
    if (!data) return { goals: 0, shots: 0, xg: 0 };
    const shots = data.events.filter((e) => e.type === 'shot');
    return {
      goals: data.events.filter((e) => e.type === 'goal').length,
      shots: shots.length,
      xg: shots.reduce((sum, e) => sum + (e.xg ?? 0), 0),
    };
  }, [data]);

  const xgNow = useMemo(() => {
    let home = 0;
    let away = 0;
    for (const s of charts?.xg_cum ?? []) {
      if (s.t > frameT) break;
      if (s.team === data?.match.home.id) home = s.home;
      else away = s.away;
    }
    return { home, away };
  }, [charts, frameT, data]);

  const leader = useMemo(() => {
    if (!charts || !data) return 'level';
    let h = 0;
    let a = 0;
    for (const m of charts.momentum) {
      if (m.t > frameT) break;
      h = m.home;
      a = m.away;
    }
    if (h === a) return 'level';
    return h > a ? data.match.home.id : data.match.away.id;
  }, [charts, frameT, data]);

  const goalFlash = useMemo(() => {
    if (!data) return null;
    const goal = data.events.find((e) => e.type === 'goal' && Math.abs(e.t - frameT) < 3);
    return goal ? { x: goal.x, y: goal.y, by: goal.by } : null;
  }, [data, frameT]);

  const featuredIdx = useMemo(() => {
    if (roleAnns.length === 0) return -1;
    let idx = 0;
    for (let i = 0; i < roleAnns.length; i += 1) {
      if (roleAnns[i].t <= frameT + 0.5) idx = i;
      else break;
    }
    return idx;
  }, [roleAnns, frameT]);
  const featured = featuredIdx >= 0 ? roleAnns[featuredIdx] : null;
  const stepMoment = (dir: number) => {
    const next = featuredIdx + dir;
    if (next >= 0 && next < roleAnns.length) seek(Math.round(roleAnns[next].t * fps));
  };
  const prevMoment = featuredIdx > 0 ? roleAnns[featuredIdx - 1] : null;
  const nextMoment = featuredIdx >= 0 && featuredIdx < roleAnns.length - 1 ? roleAnns[featuredIdx + 1] : null;
  const trust = useMemo(() => {
    const checked = annotations.filter((a) => a.verified !== false).length;
    return {
      checked,
      failed: annotations.length - checked,
      retries: (trace?.jobs ?? []).reduce((sum, j) => sum + Math.max(0, j.attempts - 1), 0),
    };
  }, [annotations, trace]);

  const matchday = index?.matches.find((m) => m.id === matchId)?.matchday ?? matchId;

  const railPlayers = useMemo(() => {
    if (!personalized || !data) return [];
    return roster
      .map((id) => {
        const isHome = id.startsWith(data.match.home.id);
        return {
          id,
          teamId: isHome ? data.match.home.id : data.match.away.id,
          teamName: isHome ? data.match.home.name : data.match.away.name,
          role: roleOf(roster, id),
          involvements: personalized.players[id]?.involvement ?? 0,
          touches: personalized.players[id]?.timeline.length ?? 0,
          isHome,
        };
      })
      .sort((a, b) => b.involvements - a.involvements);
  }, [roster, personalized, data]);

  const toggleLayer = useCallback((layer: string) => {
    setLayers((prev) => (prev.includes(layer) ? prev.filter((l) => l !== layer) : [...prev, layer]));
  }, []);

  const seek = useCallback(
    (i: number) => {
      const max = (data?.frames.length ?? 1) - 1;
      setFrameIdx(Math.max(0, Math.min(max, Math.round(i))));
    },
    [data],
  );

  const exportReport = useCallback(() => {
    if (!data) return;
    const lines = [
      `MATCH REPORT -- ${data.match.home.name} ${data.match.score.home}-${data.match.score.away} ${data.match.away.name} (${data.match.id})`,
      `Made for: ${role} watchers - Language: ${lang} - Paused at ${formatT(frameT)}`,
      'How to read: each line is one moment, how sure the system is, and the proof.',
      '',
      ...roleAnns.map(
        (a) =>
          `[${formatT(a.t)}] ${a.text[lang]} (sure ${Math.round(a.confidence * 100)}%, proof ${a.evidence.join(', ')}, checked: ${a.verified === false ? `no - ${a.reason ?? 'no reason'}` : 'yes'})`,
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `report-${data.match.id}-${role}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  }, [data, role, lang, frameT, roleAnns]);

  const showCoords = personalized?.roles[role]?.show_coords ?? false;
  const showConfidence = personalized?.roles[role]?.show_confidence ?? false;
  const showEventIds = personalized?.roles[role]?.show_event_ids ?? false;
  const canExport = personalized?.roles[role]?.export ?? false;
  const focusInfo = role === 'player' && focus && personalized?.players[focus] ? personalized.players[focus] : null;

  const dismissWelcome = useCallback(() => {
    try {
      window.localStorage.setItem('mm-welcomed', '1');
    } catch {
      /* private mode — overlay simply returns next visit */
    }
    setWelcomed(true);
  }, []);

  const handleFiles = useCallback(async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    let text: string;
    try {
      text = await file.text();
    } catch (e) {
      setImportError(`${file.name}: could not be read (${String(e)}).`);
      return;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      setImportError(`${file.name}: that file is not valid JSON.`);
      return;
    }
    const result = importMatch(raw);
    if (!result.ok) {
      setImportError(`${file.name}: ${result.error}`);
      return;
    }
    setImportError(null);
    setCustom(result.bundle);
    setMatchId(result.bundle.match.match.id);
    setFrameIdx(0);
  }, []);

  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <main
      className={dragging ? 'app-shell dragging' : 'app-shell'}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        handleFiles(e.dataTransfer.files);
      }}
    >
        {!welcomed && data && (
          <div className="welcome-overlay" role="dialog" aria-label="quick start guide">
            <div className="welcome-card">
              <h2 className="display welcome-title">Watch a match like an analyst</h2>
              <p className="blurb">
                Match Microscope turns a 10-minute synthetic game into moments you can see — and check. No
                account, no jargon.
              </p>
              <ol className="welcome-steps">
                <li>
                  <strong>Press Play</strong> or drag the timeline. The clock runs 00:00 → 10:00.
                </li>
                <li>
                  <strong>White dots are {data.match.home.name}, lime dots are {data.match.away.name}.</strong>{' '}
                  A red glow means the player on the ball is under pressure. Click any dot to follow that player.
                </li>
                <li>
                  <strong>Pick how to watch:</strong> Fan for the story, Coach for tactics, Analyst for
                  everything — or follow one player.
                </li>
              </ol>
              <div className="welcome-gloss mono">
                <span>
                  <strong>Goal chance (xG)</strong> — 0.30 means they’d score about 3 times in 10 from there.
                </span>
                <span>
                  <strong>Checked</strong> — the moment was found in the match data. If not, we say so.
                </span>
              </div>
              <button type="button" onClick={dismissWelcome}>
                Start watching
              </button>
            </div>
          </div>
        )}
        <header className="mm-header">
          <div className="brand">
            <span className="display brand-mark">Match Microscope</span>
            <span className="tag">{matchday}</span>
            <span className="mono live-clock" aria-live="polite">
              {data ? formatT(frameT) : '--:--'}
            </span>
          </div>
          <div className="controls">
            {displayIndex && <MatchSwitcher index={displayIndex} matchId={matchId} onChange={(id) => { setMatchId(id); setFrameIdx(0); }} />}
            <RoleSwitcher role={role} onChange={setRole} />
            <LanguageSwitcher lang={lang} onChange={(l) => setLang(l as Lang)} />
            <button
              type="button"
              className="import-btn"
              onClick={() => fileInputRef.current?.click()}
              title="Analyze your own match JSON — the same shape the pipeline consumes"
            >
              Analyze your own data
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                handleFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </div>
        </header>

        {dragging && (
          <div className="drop-hint mono" aria-hidden="true">
            Drop a match JSON to analyze your own data
          </div>
        )}

        {importError && (
          <div className="import-error mono" role="alert">
            <span>{importError}</span>
            <button type="button" onClick={() => setImportError(null)} aria-label="dismiss">
              dismiss
            </button>
          </div>
        )}

        {!data || !charts || !personalized || !trace ? (
          <div>
            <div className="loading-line" />
            {error ? (
              <div className="mono" style={{ padding: 16, borderLeft: `2px solid ${palette.danger}`, color: palette.danger }}>
                {error}
              </div>
            ) : (
              <div className="mono" style={{ padding: 16, color: palette.textDim }}>
                Loading the match…
              </div>
            )}
          </div>
        ) : (
          <>
          <Scoreboard
            homeName={data.match.home.name}
            awayName={data.match.away.name}
            homeScore={data.match.score.home}
            awayScore={data.match.score.away}
            clock={frameT}
            homeXg={xgNow.home}
            awayXg={xgNow.away}
            pressure={pressureEntry?.score ?? 0}
            leader={leader}
            totalGoals={totals.goals}
            totalShots={totals.shots}
            totalXg={totals.xg}
          />
          <div className="app-main">
            <div className="col-left">
              <section className="pitch-flex">
                <div className="pitch-wrap">
                  <Pitch
                  frames={data.frames}
                  frameIdx={frameIdx}
                  fps={fps}
                  layers={layers}
                  annotations={pitchAnns}
                  lang={lang}
                  laneSet={laneSet}
                  heat={layers.includes('space') ? heat : null}
                  pressureScore={pressureEntry?.score ?? 0}
                  focusPlayer={role === 'player' ? focus : focus}
                  showCoords={showCoords}
                  homeId={data.match.home.id}
                  eventsById={eventsById}
                  danger={layers.includes('danger') ? danger : null}
                  goalFlash={goalFlash}
                  onSelectPlayer={(id) => {
                    setFocus(id);
                    if (id) setRole('player');
                  }}
                />
                <div className="layer-dock" role="group" aria-label="pitch overlays">
                  {['pressure', 'lanes', 'space', 'trails', 'momentum', 'danger'].map((l) => (
                    <button
                      key={l}
                      type="button"
                      aria-pressed={layers.includes(l)}
                      onClick={() => toggleLayer(l)}
                    >
                      {LAYER_LABELS[l]}
                    </button>
                  ))}
                </div>
                </div>
              </section>
              <section className="panel mm-timeline-panel">
                <Timeline
                  frameIdx={frameIdx}
                  frameCount={data.frames.length}
                  fps={fps}
                  duration={duration}
                  charts={charts}
                  events={data.events}
                  annotationTimes={roleAnns.map((a) => a.t)}
                  onSeek={seek}
                  playing={playing}
                  onTogglePlay={() => setPlaying((v) => !v)}
                />
              </section>
            </div>

            <div className="col-right">
              <div className="tabs" role="tablist" aria-label="analysis panels">
                {(['moments', 'signals', 'players', 'direct', 'story', 'crew'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="tab"
                    aria-selected={tab === t}
                    className={tab === t ? 'tab active' : 'tab'}
                    onClick={() => setTab(t)}
                  >
                    {t === 'moments'
                      ? 'Moment'
                      : t === 'signals'
                        ? 'Signals'
                        : t === 'players'
                          ? 'Players'
                          : t === 'direct'
                            ? 'Direct'
                            : t === 'story'
                              ? 'Story'
                              : 'Crew'}
                  </button>
                ))}
              </div>
              <div className="tab-body">
                {tab === 'moments' && (
                  <>
                    <div className="blurb" style={{ marginTop: 0 }}>{ROLE_BLURBS[role]}</div>
                    {featured ? (
                      <div className="now-moment">
                        <div className="mono now-kicker">
                          now · {featuredIdx + 1} of {roleAnns.length}
                        </div>
                        <div className="display now-time">{formatT(featured.t)}</div>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', margin: '6px 0' }}>
                          <span className="tag">{featured.kind}</span>
                          <span className={featured.verified === false ? 'moment-badge-unproven' : 'moment-badge-checked'}>
                            {featured.verified === false ? 'not proven' : 'checked'}
                          </span>
                        </div>
                        <p className="now-text">{featured.text[lang] ?? featured.text.en}</p>
                        <div className="mono moment-meta">
                          {showConfidence ? `sure ${Math.round(featured.confidence * 100)}%` : ''}
                          {showConfidence && showEventIds ? ' · ' : ''}
                          {showEventIds ? `proof: ${featured.evidence.join(', ')}` : ''}
                        </div>
                        {featured.verified === false && featured.reason && (
                          <div className="mono moment-reason">{featured.reason}</div>
                        )}
                        <div className="pager" role="group" aria-label="step through moments">
                          <button
                            type="button"
                            className="pager-step"
                            onClick={() => stepMoment(-1)}
                            disabled={featuredIdx <= 0}
                            aria-label="previous moment"
                          >
                            <span aria-hidden="true">←</span>
                            <span className="mono pager-time">{prevMoment ? formatT(prevMoment.t) : '--:--'}</span>
                          </button>
                          <button type="button" className="pager-play" onClick={() => seek(Math.round(featured.t * fps))}>
                            Rewatch this moment
                          </button>
                          <button
                            type="button"
                            className="pager-step"
                            onClick={() => stepMoment(1)}
                            disabled={featuredIdx >= roleAnns.length - 1}
                            aria-label="next moment"
                          >
                            <span className="mono pager-time">{nextMoment ? formatT(nextMoment.t) : '--:--'}</span>
                            <span aria-hidden="true">→</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="mono" style={{ color: palette.textDim }}>
                        No moment here yet — press Play.
                      </div>
                    )}
                    {canExport && (
                      <div style={{ marginTop: 10 }}>
                        <button type="button" onClick={exportReport} title="Download a plain-words text summary">
                          Export report
                        </button>
                      </div>
                    )}
                  </>
                )}
                {tab === 'signals' && (
                  <ChartPanel
                    charts={charts}
                    frames={data.frames}
                    homeId={data.match.home.id}
                    awayId={data.match.away.id}
                    homeName={data.match.home.name}
                    awayName={data.match.away.name}
                    currentT={frameT}
                    fps={fps}
                    duration={duration}
                    onSeek={seek}
                    compact
                  />
                )}
                {tab === 'players' && (
                  <>
                    {focusInfo && focus && (
                      <PlayerCard
                        playerId={focus}
                        teamId={focus.startsWith(data.match.home.id) ? data.match.home.id : data.match.away.id}
                        teamName={focus.startsWith(data.match.home.id) ? data.match.home.name : data.match.away.name}
                        role={roleOf(roster, focus)}
                        involvements={focusInfo.involvement}
                        touches={focusInfo.timeline.length}
                        moments={roleAnns.length}
                        isHome={focus.startsWith(data.match.home.id)}
                        onUnfollow={() => setFocus(null)}
                      />
                    )}
                    <div className="label" style={{ margin: '10px 0 8px' }}>most involved</div>
                    {railPlayers.slice(0, 3).map((p) => {
                      const active = focus === p.id;
                      return (
                        <div
                          key={p.id}
                          className="mini-follow"
                          style={{ borderLeft: `3px solid ${p.isHome ? '#E8ECEF' : '#C8FF3D'}` }}
                        >
                          <span className="display mini-num">{p.id.split('-')[1]}</span>
                          <span className="mini-who">
                            <strong>{playerName(p.id)}</strong>
                            <span className="tag">{p.role}</span>
                          </span>
                          <span className="mono mini-stat">{p.involvements} involved</span>
                          <button
                            type="button"
                            aria-pressed={active}
                            onClick={() => {
                              setFocus(active ? null : p.id);
                              if (!active) setRole('player');
                            }}
                            style={active ? { background: palette.accent, color: '#131a08', borderColor: palette.accent } : undefined}
                          >
                            {active ? 'Following' : 'Follow'}
                          </button>
                        </div>
                      );
                    })}
                    <p className="blurb">Or click any dot on the pitch to follow anyone.</p>
                  </>
                )}
                {tab === 'direct' && (
                  <CommandBar events={data.events} pressure={charts.pressure_frames} homeId={data.match.home.id} fps={fps} duration={duration} onSeek={seek} onSetRole={setRole} />
                )}
                {tab === 'story' && <PipelinePanel trace={trace} trust={trust} />}
                {tab === 'crew' && <CrewTrace trace={trace} />}
              </div>
            </div>
          </div>
          </>
        )}
    </main>
  );
}
