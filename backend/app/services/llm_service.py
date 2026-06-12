"""
LLM service — provider abstraction layer.

Providers:
  deepseek  — OpenAI-compatible /v1/chat/completions  (DEFAULT)
  openai    — OpenAI /v1/chat/completions
  anthropic — Native /v1/messages

Token minimisation:
  max_tokens=1024, temperature=0.3, no streaming.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Optional

import httpx

from app.core.logging import get_logger
from app.core.settings import get_settings
from app.models.schemas import LLMProvider, Message, MessageRole

log = get_logger("llm")

# ── Provider config ────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class ProviderConfig:
    name:        LLMProvider
    model:       str
    base_url:    str
    max_tokens:  int = 1024
    temperature: float = 0.3


_CONFIGS: dict[LLMProvider, ProviderConfig] = {
    LLMProvider.deepseek: ProviderConfig(
        name=LLMProvider.deepseek,
        model="deepseek-chat",
        base_url="https://api.deepseek.com/v1",
    ),
    LLMProvider.openai: ProviderConfig(
        name=LLMProvider.openai,
        model="gpt-4o-mini",
        base_url="https://api.openai.com/v1",
    ),
    LLMProvider.anthropic: ProviderConfig(
        name=LLMProvider.anthropic,
        model="claude-haiku-4-5-20251001",
        base_url="https://api.anthropic.com",
    ),
}

_TIMEOUT = httpx.Timeout(30.0, connect=5.0)


def get_default_provider() -> LLMProvider:
    cfg = get_settings()
    try:
        return LLMProvider(cfg.default_llm_provider)
    except ValueError:
        return LLMProvider.deepseek


def get_provider_config(provider: LLMProvider) -> ProviderConfig:
    return _CONFIGS[provider]


def _get_api_key(provider: LLMProvider) -> str:
    cfg = get_settings()
    key_map = {
        LLMProvider.deepseek:  cfg.deepseek_api_key,
        LLMProvider.anthropic: cfg.anthropic_api_key,
        LLMProvider.openai:    cfg.openai_api_key,
    }
    key = key_map.get(provider)
    if not key:
        raise ValueError(f"API key not configured for provider: {provider.value}")
    return key


# ── OpenAI-compatible (DeepSeek + OpenAI) ────────────────────────────────────

async def _call_openai_compatible(
    cfg:    ProviderConfig,
    api_key: str,
    messages: list[Message],
    system: str,
) -> tuple[str, int]:
    payload = {
        "model":       cfg.model,
        "max_tokens":  cfg.max_tokens,
        "temperature": cfg.temperature,
        "stream":      False,
        "messages": [
            {"role": "system", "content": system},
            *[
                {"role": m.role.value, "content": m.content}
                for m in messages
                if m.role != MessageRole.system
            ],
        ],
    }
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.post(
            f"{cfg.base_url}/chat/completions",
            json=payload,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type":  "application/json",
            },
        )

    if resp.status_code != 200:
        raise RuntimeError(
            f"{cfg.name.value} API error {resp.status_code}: {resp.text[:300]}"
        )

    data    = resp.json()
    content = data["choices"][0]["message"]["content"]
    tokens  = data.get("usage", {}).get("total_tokens", 0)
    return content, tokens


# ── Anthropic native ──────────────────────────────────────────────────────────

async def _call_anthropic(
    cfg:    ProviderConfig,
    api_key: str,
    messages: list[Message],
    system: str,
) -> tuple[str, int]:
    payload = {
        "model":       cfg.model,
        "max_tokens":  cfg.max_tokens,
        "temperature": cfg.temperature,
        "system":      system,
        "messages": [
            {"role": m.role.value, "content": m.content}
            for m in messages
            if m.role != MessageRole.system
        ],
    }
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.post(
            f"{cfg.base_url}/v1/messages",
            json=payload,
            headers={
                "x-api-key":         api_key,
                "anthropic-version": "2023-06-01",
                "Content-Type":      "application/json",
            },
        )

    if resp.status_code != 200:
        raise RuntimeError(
            f"Anthropic API error {resp.status_code}: {resp.text[:300]}"
        )

    data    = resp.json()
    content = next(b["text"] for b in data["content"] if b["type"] == "text")
    tokens  = data.get("usage", {}).get("input_tokens", 0) + \
              data.get("usage", {}).get("output_tokens", 0)
    return content, tokens


# ── Public API ────────────────────────────────────────────────────────────────

@dataclass
class LLMResult:
    content:     str
    tokens_used: int
    model:       str
    provider:    LLMProvider


async def call_llm(
    provider: LLMProvider,
    messages: list[Message],
    system_prompt: str,
) -> LLMResult:
    cfg     = _CONFIGS[provider]
    api_key = _get_api_key(provider)
    t0      = time.perf_counter()

    if provider == LLMProvider.anthropic:
        content, tokens = await _call_anthropic(cfg, api_key, messages, system_prompt)
    else:
        content, tokens = await _call_openai_compatible(cfg, api_key, messages, system_prompt)

    ms = int((time.perf_counter() - t0) * 1000)
    log.info(
        "llm_call_complete",
        provider=provider.value,
        model=cfg.model,
        tokens_used=tokens,
        latency_ms=ms,
    )
    return LLMResult(content=content, tokens_used=tokens, model=cfg.model, provider=provider)
