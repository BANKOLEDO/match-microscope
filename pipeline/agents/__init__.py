"""Microsoft Agent Framework crew for Match Microscope.

Optional: the pipeline runs offline without this. When Microsoft Foundry /
Azure OpenAI (or any OpenAI-compatible) credentials are present, the
``explain`` job upgrades to a real Narrator/Verifier/Director collaboration.
"""

from .client import agents_available, build_chat_client, describe_backend

__all__ = ["agents_available", "build_chat_client", "describe_backend"]
