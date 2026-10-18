"""The multi-agent crew: Narrator, Verifier and Director.

Microsoft Agent Framework turns one deterministic pipeline job into a real
collaboration between three specialised agents:

* **Narrator** -- drafts short broadcast-style annotations (en/es/fr) from
  the *computed* evidence pack. It narrates; it never invents new players,
  scores or stats that are not in the pack it is handed.
* **Verifier** -- a tool-using agent. It is given ``lookup_event`` and
  ``events_near`` tools that query the real raw event store, so when it is
  handed a claim citing ``evt-9999`` it *actually* calls the tool, sees the
  miss, and rejects the claim. This is agentic tool use, not a hard-coded
  failure.
* **Director** -- adjudicates the verifier's verdicts, accepts the grounded
  annotations and returns a final, reviewable set.

The deterministic ``verify`` job still runs afterwards as a hard safety net.
Agents narrate and adjudicate; nothing reaches the site ungrounded.
"""

import asyncio
import json
import re

from .client import build_chat_client

SYSTEM_NARRATOR = (
    "You are a Premier League broadcast narrator. For each moment you are "
    "given an id and a plain text_template that states the already-computed "
    "facts. Rewrite each into ONE livelier broadcast line of at most 18 "
    "words in English, plus a Spanish and a French version, keeping the "
    "SAME facts (players, score, xG, zone). Never invent a player, score or "
    "statistic, and never copy the template verbatim. Echo each exact id. "
    "Reply with ONLY a JSON array of "
    "{\"id\",\"en\",\"es\",\"fr\",\"confidence\"} objects, one per input."
)

SYSTEM_VERIFIER = (
    "You are a fact-checker for football annotations. Each claim has an id "
    "and a list of cited evidence event ids. Use your lookup_event tool to "
    "check that EVERY cited event id really exists. Accept a claim "
    "(accept=true) when all its cited ids exist and are consistent with it. "
    "Reject a claim (accept=false) ONLY when a cited id does NOT exist, or "
    "when the cited event clearly contradicts the claim. Reply with ONLY a "
    "JSON array of {\"id\",\"accept\",\"reason\",\"confidence\"} objects, "
    "one per claim."
)

SYSTEM_DIRECTOR = (
    "You are the broadcast producer. You receive the narrator's drafts and "
    "the verifier's verdicts. Keep every draft the verifier accepted, "
    "preserving the narrator's text; lower the confidence of any draft the "
    "verifier questioned. Drop the drafts the verifier rejected. Reply with "
    "ONLY a JSON array of "
    "{\"id\",\"en\",\"es\",\"fr\",\"confidence\",\"verified\"} objects, one "
    "per accepted draft."
)


def _extract_json(text):
    """Pull the first JSON object/array out of an LLM reply."""
    if isinstance(text, str):
        stripped = text.strip()
        try:
            return json.loads(stripped)
        except ValueError:
            pass
        match = re.search(r"[\[{].*[\]}]", stripped, re.DOTALL)
        if match:
            return json.loads(match.group(0))
    return None


def make_verifier_tools(state):
    """Build real event-lookup tools bound to the raw event store."""
    event_by_id = state["event_by_id"]
    events = state["events"]

    def lookup_event(event_id: str) -> str:
        """Look up one raw event by its id (e.g. 'evt-0142')."""
        event = event_by_id.get(event_id)
        if event is None:
            return f"NOT FOUND: no event with id {event_id}"
        keep = {k: event[k] for k in ("id", "type", "by", "team", "t") if k in event}
        if "xg" in event:
            keep["xg"] = round(float(event["xg"]), 3)
        return json.dumps(keep)

    def events_near(t: float, radius: float = 5.0) -> str:
        """List raw events within ``radius`` seconds of time ``t``."""
        nearby = [e for e in events if abs(e["t"] - t) <= radius]
        if not nearby:
            return "no events in that window"
        return json.dumps(
            [{k: e[k] for k in ("id", "type", "by", "t") if k in e} for e in nearby[:12]]
        )

    return [lookup_event, events_near]


def build_crew(state):
    """Create the three agents on one shared chat client."""
    from agent_framework import Agent

    chat_client = build_chat_client()
    tools = make_verifier_tools(state)
    return {
        "narrator": Agent(client=chat_client, name="Narrator", instructions=SYSTEM_NARRATOR),
        "verifier": Agent(
            client=chat_client,
            name="Verifier",
            instructions=SYSTEM_VERIFIER,
            tools=tools,
        ),
        "director": Agent(client=chat_client, name="Director", instructions=SYSTEM_DIRECTOR),
    }


def _pack_for(annotation, match):
    """Compact evidence pack handed to the Narrator."""
    return {
        "id": annotation["id"],
        "t": annotation["t"],
        "kind": annotation["kind"],
        "evidence": annotation.get("evidence", []),
        "score": match["score"],
        "text_template": annotation["text"]["en"],
    }


async def _interview(crew, packs, emit):
    """Drive the agent graph: (Narrator || Verifier) -> Director.

    The Verifier checks the evidence packs, not the Narrator's wording, so
    the first two agents run concurrently with ``asyncio.gather`` and the
    Director fans them back in. Same three agents, ~1/3 less wall-clock.
    """
    pack_json = json.dumps(packs, indent=1)

    narrator_task = crew["narrator"].run(
        "Draft one annotation per moment in this pack:\n" + pack_json
    )
    verifier_task = crew["verifier"].run(
        "Verify each of these claims against the raw events using your "
        "tools:\n" + pack_json
    )
    narrator_reply, verifier_reply = await asyncio.gather(narrator_task, verifier_task)

    drafts = _extract_json(narrator_reply.text) or []
    emit({"type": "agent_step", "agent": "narrator", "drafts": len(drafts)})
    verdicts = _extract_json(verifier_reply.text) or []
    emit({"type": "agent_step", "agent": "verifier", "verdicts": len(verdicts)})

    director_reply = await crew["director"].run(
        "Narrator drafts:\n"
        + json.dumps(drafts, indent=1)
        + "\n\nVerifier verdicts:\n"
        + json.dumps(verdicts, indent=1)
    )
    decided = _extract_json(director_reply.text) or []
    emit({"type": "agent_step", "agent": "director", "decided": len(decided)})

    return drafts, verdicts, decided


def refine(annotations, state, on_event=None):
    """Run Narrator -> Verifier -> Director over the draft annotations.

    Returns the revised annotation list. Any exception is raised so the
    caller can fall back to deterministic templates.
    """
    def emit(event):
        if on_event is not None:
            on_event(event)

    crew = build_crew(state)
    emit({"type": "agent_start", "crew": ["narrator", "verifier", "director"]})

    packs = [_pack_for(a, state["match"]) for a in annotations]
    drafts, verdicts, decided = asyncio.run(_interview(crew, packs, emit))

    rejected = [v for v in verdicts if not v.get("accept", True)]
    return _merge(annotations, decided, rejected)


def _merge(annotations, decided, rejected):
    """Fold agent narration back onto the pipeline-computed annotations.

    Matching is strictly by ``id``. Two ways an annotation is marked
    ``agent_rejected``: the Verifier explicitly rejected it, or the crew's
    final output simply omitted it (the Director drops rejected drafts).
    Nothing is ever matched positionally, so a reordered reply can't
    overwrite a grounded annotation with the wrong moment's text.
    """
    by_id = {}
    for item in decided or []:
        if isinstance(item, dict) and item.get("id"):
            by_id[str(item["id"])] = item
    if not by_id:
        return annotations
    rejected_ids = {v.get("id") for v in rejected or [] if isinstance(v, dict)}

    for annotation in annotations:
        item = by_id.get(annotation["id"])
        if item is None:
            annotation["agent_rejected"] = True
            continue
        text = item.get("text") or item
        for lang in ("en", "es", "fr"):
            if isinstance(text.get(lang), str) and text[lang].strip():
                annotation["text"][lang] = text[lang].strip()
        if item.get("confidence") is not None:
            annotation["confidence"] = round(float(item["confidence"]), 2)
        if annotation["id"] in rejected_ids:
            annotation["agent_rejected"] = True
    return annotations
