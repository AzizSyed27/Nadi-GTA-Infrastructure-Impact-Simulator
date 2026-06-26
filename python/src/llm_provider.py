"""Thin, provider-agnostic LLM layer for the agent reaction step.

A Protocol + two adapters — deliberately NOT a gateway/router/fallback framework:
- ``GeminiAdapter`` — Google's google-genai SDK (Gemini is NOT OpenAI-compatible).
- ``OpenAICompatAdapter`` — the `openai` SDK pointed at any OpenAI-compatible ``base_url``. ONE adapter
  covers Groq / DeepSeek / OpenAI / Cerebras / Mistral / Kimi: a provider is just a (base_url,
  default_model, key_env) preset.

Provider + model come from the env (``PROVIDER`` default ``gemini``, ``MODEL`` overrides the default).
``.env`` is loaded via python-dotenv (incl. ``python/.env``). Each adapter exposes one async method,
``generate_json``, returning a plain ``dict``; the CALLER owns contract validation/clamping (e.g.
validating against ``contract_models.Reaction``) — the layer knows nothing about the trajectory contract.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Protocol, runtime_checkable

from dotenv import load_dotenv
from pydantic import BaseModel

# Gemini's default model (its own SDK/branch). Override via MODEL.
GEMINI_DEFAULT_MODEL = "gemini-2.5-flash-lite"

# OpenAI-API-compatible providers → (base_url, default_model, api_key_env). One adapter serves all.
# Only `groq` is verified for STRICT structured output (model `openai/gpt-oss-20b`, docs-confirmed).
# The other presets are convenience defaults for later use — verify the model id before relying on them.
PROVIDER_PRESETS: dict[str, tuple[str, str, str]] = {
    "groq": ("https://api.groq.com/openai/v1", "openai/gpt-oss-20b", "GROQ_API_KEY"),
    "deepseek": ("https://api.deepseek.com", "deepseek-chat", "DEEPSEEK_API_KEY"),
    "openai": ("https://api.openai.com/v1", "gpt-4o-mini", "OPENAI_API_KEY"),
    "cerebras": ("https://api.cerebras.ai/v1", "gpt-oss-120b", "CEREBRAS_API_KEY"),
    "mistral": ("https://api.mistral.ai/v1", "ministral-3b-latest", "MISTRAL_API_KEY"),
    "kimi": ("https://api.moonshot.ai/v1", "kimi-k2.6", "MOONSHOT_API_KEY"),
}


@runtime_checkable
class LLMClient(Protocol):
    """One method: turn (system, user, schema) into a JSON object as a dict."""

    async def generate_json(self, *, system: str, user: str, schema: type[BaseModel]) -> dict:
        ...


def _strip_fences(text: str) -> str:
    """Strip a ```json ... ``` markdown fence if a model wrapped its JSON despite a JSON mime type."""
    t = (text or "").strip()
    if t.startswith("```"):
        t = t[3:]
        if t[:4].lower() == "json":
            t = t[4:]
        if t.endswith("```"):
            t = t[:-3]
    return t.strip()


def _strict_schema(model: type[BaseModel]) -> dict:
    """Build an OpenAI/Groq STRICT json_schema from a pydantic model.

    Strict mode requires ``additionalProperties:false`` and EVERY property in ``required`` — the
    opposite of Gemini, which rejects ``additionalProperties``. (Numeric ``minimum``/``maximum`` aren't
    enforced by strict decoding, so the caller still clamps ``sentiment`` and validates the contract.)
    """
    schema = model.model_json_schema()
    schema["additionalProperties"] = False
    if "properties" in schema:
        schema["required"] = list(schema["properties"].keys())
    return schema


class GeminiAdapter:
    """google-genai adapter. Uses native structured output (response_schema = a pydantic class)."""

    def __init__(self, model: str) -> None:
        from google import genai  # imported lazily so the module loads without the SDK present

        self._client = genai.Client()  # reads GEMINI_API_KEY / GOOGLE_API_KEY
        self._model = model

    async def generate_json(self, *, system: str, user: str, schema: type[BaseModel]) -> dict:
        from google.genai import types

        resp = await self._client.aio.models.generate_content(
            model=self._model,
            contents=user,
            config=types.GenerateContentConfig(
                system_instruction=system,
                response_mime_type="application/json",
                response_schema=schema,  # Gemini wants the LOOSE schema (no additionalProperties)
                temperature=0.8,
            ),
        )
        parsed = getattr(resp, "parsed", None)
        if isinstance(parsed, BaseModel):
            return parsed.model_dump()
        if isinstance(parsed, dict):
            return parsed
        return json.loads(_strip_fences(resp.text))


class OpenAICompatAdapter:
    """The `openai` SDK pointed at any OpenAI-compatible base_url. Uses strict json_schema output."""

    def __init__(self, *, base_url: str, model: str, api_key: str) -> None:
        from openai import AsyncOpenAI  # lazy import

        self._client = AsyncOpenAI(base_url=base_url, api_key=api_key)
        self._model = model

    async def generate_json(self, *, system: str, user: str, schema: type[BaseModel]) -> dict:
        resp = await self._client.chat.completions.create(
            model=self._model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            response_format={
                "type": "json_schema",
                "json_schema": {"name": "reaction", "strict": True, "schema": _strict_schema(schema)},
            },
            temperature=0.8,
        )
        return json.loads(_strip_fences(resp.choices[0].message.content))


def _load_env() -> None:
    # find_dotenv only walks UP from cwd, so load python/.env and the repo-root .env explicitly too.
    load_dotenv()
    for candidate in (Path(__file__).resolve().parents[1] / ".env", Path(__file__).resolve().parents[2] / ".env"):
        if candidate.is_file():
            load_dotenv(candidate)


def get_client() -> tuple[LLMClient, str, str]:
    """Resolve (client, provider, model) from the environment. Loads .env first.

    PROVIDER (default "gemini") selects the adapter; MODEL overrides the per-provider default. Raises a
    clear error if the chosen provider's API key is missing or the provider is unknown.
    """
    _load_env()
    provider = (os.environ.get("PROVIDER") or "gemini").strip().lower()

    if provider == "gemini":
        model = os.environ.get("MODEL") or GEMINI_DEFAULT_MODEL
        if not (os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")):
            raise RuntimeError(
                "GEMINI_API_KEY is not set. Put `GEMINI_API_KEY=...` in a .env (repo root or python/), "
                "then re-run."
            )
        return GeminiAdapter(model), provider, model

    if provider in PROVIDER_PRESETS:
        base_url, default_model, key_env = PROVIDER_PRESETS[provider]
        model = os.environ.get("MODEL") or default_model
        api_key = os.environ.get(key_env)
        if not api_key:
            raise RuntimeError(
                f"{key_env} is not set. Put `{key_env}=...` in a .env (repo root or python/), then re-run."
            )
        return OpenAICompatAdapter(base_url=base_url, model=model, api_key=api_key), provider, model

    known = ["gemini", *PROVIDER_PRESETS]
    raise ValueError(f"unknown PROVIDER {provider!r}; known: {known}")
