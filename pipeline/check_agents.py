#!/usr/bin/env python3
"""Check that the Microsoft Agent Framework crew can reach a live model.

Run this once after you put your credentials in ``.env``:

    python pipeline/check_agents.py

It reports which backend would be used, then runs one tiny real turn
through a Narrator agent so you know the endpoint, key, deployment name
and API version all line up before you spend time on a full ``--use-llm``
run. Exit codes: 0 ok, 1 call failed, 2 no credentials, 3 framework missing.
"""

import asyncio
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from jobs.common import load_dotenv  # noqa: E402

PROMPT = "Connectivity test. Reply with the single word READY."


def _missing_framework():
    print("agent-framework is not installed. Run one of:")
    print("  pip install -r pipeline/requirements-agents.txt")
    print("  pip install --only-binary=:all: agent-framework-core agent-framework-openai")
    return 3


def main():
    load_dotenv()

    try:
        import agent_framework  # noqa: F401
    except ImportError:
        return _missing_framework()

    from agents import agents_available, build_chat_client, describe_backend

    backend = describe_backend()
    print(f"backend: {backend}")

    if not agents_available():
        print("")
        print("No live backend configured. Set one of these in .env and retry:")
        print("  AZURE_OPENAI_ENDPOINT / AZURE_OPENAI_API_KEY / AZURE_OPENAI_CHAT_MODEL")
        print("  ...or OPENAI_API_KEY (with optional OPENAI_BASE_URL).")
        print("Without credentials the pipeline still runs offline on templates.")
        return 2

    client = build_chat_client()
    if client is None:
        return _missing_framework()

    print("agent-framework imported, chat client built.")
    print("running one live turn through the Narrator agent ...")

    from agent_framework import Agent

    agent = Agent(
        client=client,
        name="Narrator",
        instructions="You are a connectivity probe. Reply with the single word READY.",
    )

    started = time.time()
    try:
        reply = asyncio.run(agent.run(PROMPT))
    except Exception as error:  # surface the real error instead of a fallback
        elapsed = time.time() - started
        print(f"FAILED after {elapsed:.1f}s: {type(error).__name__}: {error}")
        print("Check the endpoint, key, deployment name and API version,")
        print("and confirm the model supports chat completions.")
        return 1

    elapsed = time.time() - started
    text = (reply.text or "").strip()
    print(f"OK in {elapsed:.1f}s -> {text!r}")
    print(f"backend confirmed: {backend}")
    print("next: python pipeline/run_pipeline.py --match syn-001 --use-llm")
    return 0


if __name__ == "__main__":
    sys.exit(main())
