'use client';

import { useState } from 'react';
import { palette } from '../lib/colors';
import type { TraceFile } from '../lib/data';

const STEPS: Record<string, { title: string; how: string }> = {
  director: {
    title: 'Keeps it in sync',
    how: 'Starts each step of the story, waits for the work to land, and quietly re-runs anything that stalls — so the whole thing always finishes.',
  },
  ingest: {
    title: 'Reads the match',
    how: 'Opens the match file and turns it into a play-by-play: 3,000 frames, plus every shot, pass and goal.',
  },
  tracker: {
    title: 'Follows all 22 players',
    how: 'Gives every player a speed and a direction on each frame, so you can follow anyone on the pitch.',
  },
  pressure: {
    title: 'Reads the pressure',
    how: 'Watches whoever is on the ball and measures how crowded they are, frame by frame.',
  },
  lanes: {
    title: 'Finds the open pass',
    how: 'Checks every pass option and marks the ones that are actually on.',
  },
  space: {
    title: 'Finds the space',
    how: 'Maps the empty grass, so you can see where a team could break through.',
  },
  charts: {
    title: 'Draws the picture',
    how: 'Turns the numbers into the pass map, the momentum line and the goal-chance race.',
  },
  explain: {
    title: 'Writes the story',
    how: 'Puts it into plain words and points to the exact moment behind every line. If one call falls over, it tries again.',
  },
  verify: {
    title: 'Checks every line',
    how: 'Re-reads each line and holds back anything it cannot prove. Nothing unchecked reaches you.',
  },
  personalize: {
    title: 'Makes it yours',
    how: 'Reshapes the same story for a fan, a coach, a scout or a player — in three languages.',
  },
};

function dot(status: string): string {
  if (status === 'ok') return palette.safe;
  if (status.startsWith('retry')) return palette.warn;
  return palette.danger;
}

function statusTag(row: { status: string; attempts: number }): string {
  if (row.status === 'ok') return '';
  if (row.status === 'failed') return 'did not finish';
  return row.attempts > 2 ? `self-corrected ${row.attempts - 1}×` : 'self-corrected';
}

/** How the story got made: ten steps passing the work down the line, explained in plain product words. */
export default function PipelinePanel({ trace, trust }: { trace: TraceFile; trust: { checked: number; failed: number; retries: number } }) {
  const jobs = trace.jobs;
  const defaultJob = jobs.find((j) => j.job === 'explain')?.job ?? jobs[0]?.job ?? '';
  const [sel, setSel] = useState(defaultJob);
  const selected = jobs.find((j) => j.job === sel) ?? jobs[0];
  const step = STEPS[selected?.job ?? ''];

  return (
    <div className="story-wrap">
      <h3 className="display sec-h">How the story got made</h3>
      <div className="subhead">
        Ten steps turn a match into a story. Each one does a single thing and passes its work to the next — so every
        line is checked before it reaches you.
      </div>

      <div className="mono trust-line">
        <span style={{ color: palette.safe }}>{trust.checked} facts checked</span>
        <span style={{ color: palette.textDim }}>·</span>
        <span style={{ color: trust.failed > 0 ? palette.danger : palette.textDim }}>{trust.failed} held back</span>
        <span style={{ color: palette.textDim }}>·</span>
        <span style={{ color: trust.retries > 0 ? palette.warn : palette.textDim }}>{trust.retries} self-corrected</span>
      </div>

      <ol className="job-chain mono">
        {jobs.map((row, i) => (
          <li key={row.job}>
            <button
              type="button"
              className={sel === row.job ? 'job-row active' : 'job-row'}
              onClick={() => setSel(row.job)}
              aria-pressed={sel === row.job}
            >
              <span className="job-dot" style={{ color: dot(row.status) }}>
                ●
              </span>
              <span className="job-num">{String(i + 1).padStart(2, '0')}</span>
              <span className="job-name">{STEPS[row.job]?.title ?? row.job}</span>
              <span className="job-out">{row.detail}</span>
              {statusTag(row) && (
                <span className="job-tag" style={{ color: palette.warn }}>
                  {statusTag(row)}
                </span>
              )}
            </button>
          </li>
        ))}
      </ol>

      <div className="job-detail">
        <div className="label">{step?.title ?? selected?.job}</div>
        <p>{step?.how ?? selected?.detail ?? ''}</p>
      </div>
    </div>
  );
}
