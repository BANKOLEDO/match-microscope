'use client';

import { palette } from '../lib/colors';
import type { CrewExample, TraceFile } from '../lib/data';
import { formatT } from '../lib/format';

const AGENTS = [
  { name: 'Narrator', role: 'Drafts the broadcast line from the computed facts.' },
  { name: 'Verifier', role: 'Checks every cited event against the raw match with a tool.' },
  { name: 'Director', role: 'Keeps what passes, drops the rest.' },
];

function Beat({ agent, said, muted }: { agent: string; said: string; muted?: boolean }) {
  return (
    <div className="crew-beat">
      <span className="crew-agent">{agent}</span>
      <span className="crew-said" style={muted ? { color: palette.textDim, textDecoration: 'line-through' } : undefined}>
        {said}
      </span>
    </div>
  );
}

function Case({ ex }: { ex: CrewExample }) {
  const rejected = ex.outcome === 'rejected';
  return (
    <div className={rejected ? 'crew-case crew-case-bad' : 'crew-case'}>
      <div className="crew-case-head mono">
        <span className="tag">{ex.kind}</span>
        <span className="crew-case-id">
          {formatT(ex.t)} · {ex.id}
        </span>
        <span className="crew-case-verdict" style={{ color: rejected ? palette.danger : palette.safe }}>
          {rejected ? 'rejected' : 'kept'}
        </span>
      </div>
      <Beat agent="Narrator" said={`“${ex.draft}”`} />
      <Beat
        agent="Verifier"
        said={rejected ? ex.reason || `cited ${ex.evidence.join(', ')} — no such event` : 'every cited event checks out'}
      />
      <Beat
        agent="Director"
        said={rejected ? 'dropped from the final story' : 'kept in the final story'}
        muted={rejected}
      />
    </div>
  );
}

/** The agent crew, shown doing the work: Narrator drafts, Verifier checks, Director decides. */
export default function CrewTrace({ trace }: { trace: TraceFile }) {
  const crew = trace.crew;
  if (!crew) {
    return (
      <div className="story-wrap">
        <h3 className="display sec-h">Who wrote the story</h3>
        <div className="subhead">
          This match was narrated from templates — no model call. Run the pipeline with{' '}
          <span className="mono">--use-llm</span> to watch the agent crew work.
        </div>
      </div>
    );
  }

  return (
    <div className="story-wrap crew-wrap">
      <h3 className="display sec-h">Who wrote the story</h3>
      <div className="subhead">
        Three agents on one shared model ({crew.model}). The Narrator drafts; the Verifier checks every claim
        against the raw match events with a tool; the Director keeps only what survives.
      </div>

      <div className="agent-row mono">
        {AGENTS.map((a) => (
          <div key={a.name} className="agent-chip">
            <div className="agent-name display">{a.name}</div>
            <div className="agent-role">{a.role}</div>
          </div>
        ))}
      </div>

      <div className="crew-cases">
        {crew.examples.map((ex) => (
          <Case key={ex.id} ex={ex} />
        ))}
      </div>
    </div>
  );
}
