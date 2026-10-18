"""Chat client factory for the Microsoft Agent Framework agents.

Two backends, chosen automatically from the environment:

* **Microsoft Foundry / Azure OpenAI** (primary) -- used when
  ``AZURE_OPENAI_ENDPOINT`` is set. The three agents then run against an
  Azure deployment, which is the competition's named stack.
* **Any OpenAI-compatible endpoint** (fallback) -- used when
  ``OPENAI_API_KEY`` is set, optionally with ``OPENAI_BASE_URL``.
"""

import os

DEFAULT_AZURE_API_VERSION = "2024-10-21"
DEFAULT_OPENAI_MODEL = "gpt-4o-mini"


def _first_env(*names):
    for name in names:
        value = os.environ.get(name)
        if value:
            return value
    return None


def describe_backend():
    """Human-readable description of which model backend would be used."""
    if _first_env("AZURE_OPENAI_ENDPOINT", "AZURE_OPENAI_BASE_URL"):
        model = _first_env(
            "AZURE_OPENAI_CHAT_MODEL", "AZURE_OPENAI_MODEL", "AZURE_OPENAI_DEPLOYMENT"
        ) or "(deployment)"
        return f"microsoft-foundry:{model}"
    if _first_env("OPENAI_API_KEY"):
        model = _first_env("OPENAI_CHAT_MODEL", "OPENAI_MODEL") or DEFAULT_OPENAI_MODEL
        return f"openai:{model}"
    return "offline"


def build_chat_client(timeout=None):
    """Build an ``OpenAIChatClient``, or ``None`` when unconfigured.

    Uses Microsoft Agent Framework's provider-agnostic client, so the same
    three agents run against Microsoft Foundry / Azure OpenAI or any
    OpenAI-compatible endpoint without changing pipeline code.
    """
    try:
        from agent_framework.openai import OpenAIChatClient
    except ImportError:  # agent-framework not installed -> templates only
        return None

    azure_endpoint = _first_env("AZURE_OPENAI_ENDPOINT", "AZURE_OPENAI_BASE_URL")
    if azure_endpoint:
        return OpenAIChatClient(
            azure_endpoint=azure_endpoint,
            api_key=_first_env("AZURE_OPENAI_API_KEY", "AZURE_OPENAI_KEY"),
            api_version=_first_env("AZURE_OPENAI_API_VERSION") or DEFAULT_AZURE_API_VERSION,
            model=_first_env(
                "AZURE_OPENAI_CHAT_MODEL", "AZURE_OPENAI_MODEL", "AZURE_OPENAI_DEPLOYMENT"
            ),
        )

    openai_key = _first_env("OPENAI_API_KEY")
    if not openai_key:
        return None
    kwargs = {
        "api_key": openai_key,
        "model": _first_env("OPENAI_CHAT_MODEL", "OPENAI_MODEL") or DEFAULT_OPENAI_MODEL,
    }
    base_url = _first_env("OPENAI_BASE_URL")
    if base_url:
        kwargs["base_url"] = base_url
    return OpenAIChatClient(**kwargs)


def agents_available():
    """True when a live model backend is configured."""
    try:
        import agent_framework  # noqa: F401
    except ImportError:
        return False
    if _first_env("AZURE_OPENAI_ENDPOINT", "AZURE_OPENAI_BASE_URL"):
        return bool(_first_env("AZURE_OPENAI_API_KEY", "AZURE_OPENAI_KEY"))
    return bool(_first_env("OPENAI_API_KEY"))
