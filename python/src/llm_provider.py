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

# OpenAI-API-compatible providers → (base_url, default_model, api_key_env, json_mode). One adapter serves all.
# json_mode: "json_schema" = OpenAI/Groq STRICT structured output; "json_object" = best-effort (DeepSeek —
# it does NOT support json_schema). The caller clamps + validates regardless, so best-effort is fine.
#   - groq: verified for strict json_schema (model `openai/gpt-oss-20b`, docs-confirmed).
#   - deepseek: `deepseek-v4-flash` (the successor to the retired `deepseek-chat`; json_object mode). V4 defaults
#     thinking ON — the adapter auto-sends `extra_body={"thinking":{"type":"disabled"}}` for any `v4`/`reasoner`
#     id (see below), which restores `temperature` and keeps latency + output-cost down. json_object stays on.
# The non-groq/deepseek presets are convenience defaults — verify the model id before relying on them.
PROVIDER_PRESETS: dict[str, tuple[str, str, str, str]] = {
    "groq": ("https://api.groq.com/openai/v1", "openai/gpt-oss-20b", "GROQ_API_KEY", "json_schema"),
    "deepseek": ("https://api.deepseek.com", "deepseek-v4-flash", "DEEPSEEK_API_KEY", "json_object"),
    "openai": ("https://api.openai.com/v1", "gpt-4o-mini", "OPENAI_API_KEY", "json_schema"),
    "cerebras": ("https://api.cerebras.ai/v1", "gpt-oss-120b", "CEREBRAS_API_KEY", "json_object"),
    "mistral": ("https://api.mistral.ai/v1", "ministral-3b-latest", "MISTRAL_API_KEY", "json_object"),
    "kimi": ("https://api.moonshot.ai/v1", "kimi-k2.6", "MOONSHOT_API_KEY", "json_object"),
}


@runtime_checkable
class LLMClient(Protocol):
    """One method: turn (system, user, schema) into a JSON object as a dict. ``temperature`` is per-CALL
    (default 0.8 for persona-variety reactions; the report/agent pipeline passes 0.3 for deterministic facts)."""

    async def generate_json(self, *, system: str, user: str, schema: type[BaseModel],
                            temperature: float = 0.8) -> dict:
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
        self.usage = {"prompt_cache_hit_tokens": 0, "prompt_cache_miss_tokens": 0, "completion_tokens": 0, "calls": 0}

    async def generate_json(self, *, system: str, user: str, schema: type[BaseModel],
                            temperature: float = 0.8) -> dict:
        from google.genai import types

        resp = await self._client.aio.models.generate_content(
            model=self._model,
            contents=user,
            config=types.GenerateContentConfig(
                system_instruction=system,
                response_mime_type="application/json",
                response_schema=schema,  # Gemini wants the LOOSE schema (no additionalProperties)
                temperature=temperature,
            ),
        )
        parsed = getattr(resp, "parsed", None)
        if isinstance(parsed, BaseModel):
            return parsed.model_dump()
        if isinstance(parsed, dict):
            return parsed
        return json.loads(_strip_fences(resp.text))


def _empty_usage() -> dict:
    return {"prompt_cache_hit_tokens": 0, "prompt_cache_miss_tokens": 0, "completion_tokens": 0, "calls": 0}


class OpenAICompatAdapter:
    """The `openai` SDK pointed at any OpenAI-compatible base_url.

    ``json_mode`` selects "json_schema" (OpenAI/Groq strict) or "json_object" (DeepSeek best-effort — no
    json_schema support). ``extra_body`` passes provider-specific params (e.g. DeepSeek V4 thinking-disabled).
    ``.usage`` accumulates token/cache counts across calls (DeepSeek reports ``prompt_cache_*``; others 0)
    for the caller's cost/cache-hit report.
    """

    def __init__(self, *, base_url: str, model: str, api_key: str, json_mode: str = "json_schema",
                 extra_body: dict | None = None, max_tokens: int = 300) -> None:
        from openai import AsyncOpenAI  # lazy import

        self._client = AsyncOpenAI(base_url=base_url, api_key=api_key)
        self._model = model
        self._json_mode = json_mode
        self._extra_body = extra_body
        self._max_tokens = max_tokens
        self.usage = _empty_usage()

    async def generate_json(self, *, system: str, user: str, schema: type[BaseModel],
                            temperature: float = 0.8) -> dict:
        if self._json_mode == "json_object":
            response_format: dict = {"type": "json_object"}  # best-effort; prompt carries "json" + example
        else:
            response_format = {
                "type": "json_schema",
                "json_schema": {"name": "reaction", "strict": True, "schema": _strict_schema(schema)},
            }
        resp = await self._client.chat.completions.create(
            model=self._model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            response_format=response_format,
            temperature=temperature,
            max_tokens=self._max_tokens,  # prevents mid-JSON truncation (DeepSeek json_object caveat)
            extra_body=self._extra_body,
        )
        u = getattr(resp, "usage", None)
        if u is not None:  # DeepSeek: prompt_cache_hit/miss_tokens; others: absent -> 0
            self.usage["prompt_cache_hit_tokens"] += getattr(u, "prompt_cache_hit_tokens", 0) or 0
            self.usage["prompt_cache_miss_tokens"] += getattr(u, "prompt_cache_miss_tokens", 0) or 0
            self.usage["completion_tokens"] += getattr(u, "completion_tokens", 0) or 0
            self.usage["calls"] += 1
        content = resp.choices[0].message.content
        if not content or not content.strip():  # DeepSeek json_object may return empty content
            raise ValueError("empty content from model")
        return json.loads(_strip_fences(content))


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
        base_url, default_model, key_env, json_mode = PROVIDER_PRESETS[provider]
        model = os.environ.get("MODEL") or default_model
        api_key = os.environ.get(key_env)
        if not api_key:
            raise RuntimeError(
                f"{key_env} is not set. Put `{key_env}=...` in a .env (repo root or python/), then re-run."
            )
        # DeepSeek V4 models default thinking ON (slow + reasoning billed as output) — force it off. A non-v4
        # id would need no toggle, so only send it for v4/reasoner model ids.
        extra_body = None
        if provider == "deepseek" and any(tag in model.lower() for tag in ("v4", "reasoner")):
            extra_body = {"thinking": {"type": "disabled"}}
        client = OpenAICompatAdapter(
            base_url=base_url, model=model, api_key=api_key, json_mode=json_mode, extra_body=extra_body
        )
        return client, provider, model

    known = ["gemini", *PROVIDER_PRESETS]
    raise ValueError(f"unknown PROVIDER {provider!r}; known: {known}")
