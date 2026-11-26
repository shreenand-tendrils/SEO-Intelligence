"""Groq LLM service: the only LLM integration in Tendrils SEO Crawler.

Everything that talks to a language model goes through `GroqService`. Nothing
else in the codebase imports an LLM SDK or calls an LLM endpoint.

Design rules (see docs/GROQ_SETUP.md):
  * Credentials come only from the backend environment (GROQ_API_KEY) and the
    model only from GROQ_MODEL. Nothing here ever returns, logs or serialises
    the key; every error string is passed through `redact()` first.
  * No mock output. If Groq is unreachable or misconfigured the caller gets a
    typed `GroqError` with a clear, user-safe message and an HTTP status hint.
  * Talks to Groq's OpenAI-compatible endpoint with `requests` (already a
    dependency), so there is no extra package to install.

Environment (all read at call time, so a restart after editing .env is enough):
  GROQ_API_KEY              required
  GROQ_MODEL                required, any chat model id from console.groq.com/docs/models
  GROQ_TIMEOUT_SECONDS      optional, per attempt           (default 45)
  GROQ_MAX_RETRIES          optional, retries after the 1st (default 2)
  GROQ_MAX_OUTPUT_TOKENS    optional, reply cap             (default 1800)
  GROQ_CONTEXT_TOKEN_BUDGET optional, report-context cap    (default 5000)
  GROQ_MAX_RETRY_WAIT_SECONDS optional, longest rate-limit wait we will sit
                            through before returning the error (default 20)
"""
import json
import logging
import math
import os
import random
import re
import threading
import time

import requests

GROQ_BASE_URL = 'https://api.groq.com/openai/v1'
USER_AGENT = 'TendrilsSEOCrawler/1.0 (+groq-service)'

log = logging.getLogger('groq')

_PLACEHOLDERS = {
    '', 'your_groq_api_key', 'your_groq_api_key_here', 'your-groq-api-key', 'changeme',
    'your_supported_groq_model', 'your_groq_model', 'your-groq-model',
}
_KEY_SHAPE = re.compile(r'gsk_[A-Za-z0-9_\-]{8,}')


# --------------------------------------------------------------------------
# Errors. Each carries a stable `code`, an HTTP status the web layer can use,
# and a message that is safe to show to the user (never contains the key).
# --------------------------------------------------------------------------
class GroqError(Exception):
    code = 'groq_error'
    http_status = 502
    retryable = False

    def __init__(self, message, *, status=None, retry_after=None):
        super().__init__(message)
        self.message = message
        self.upstream_status = status
        self.retry_after = retry_after

    def to_dict(self):
        out = {'code': self.code, 'message': self.message}
        if self.retry_after is not None:
            out['retry_after'] = self.retry_after
        return out


class GroqConfigError(GroqError):
    code = 'groq_not_configured'
    http_status = 503


class GroqAuthError(GroqError):
    code = 'groq_invalid_key'
    http_status = 502


class GroqModelError(GroqError):
    code = 'groq_model_unavailable'
    http_status = 502


class GroqRateLimitError(GroqError):
    code = 'groq_rate_limited'
    http_status = 429
    retryable = True


class GroqContextTooLargeError(GroqError):
    code = 'groq_context_too_large'
    http_status = 413


class GroqTimeoutError(GroqError):
    code = 'groq_timeout'
    http_status = 504
    retryable = True


class GroqNetworkError(GroqError):
    code = 'groq_network_error'
    http_status = 502
    retryable = True


class GroqAPIError(GroqError):
    code = 'groq_api_error'
    http_status = 502
    retryable = True


class GroqRequestError(GroqError):
    code = 'groq_bad_request'
    http_status = 502


class GroqResponseFormatError(GroqError):
    code = 'groq_bad_response'
    http_status = 502


# --------------------------------------------------------------------------
# Config
# --------------------------------------------------------------------------
def _clean(value):
    return (value or '').strip().strip('"').strip("'")


def _env_number(name, default, cast=float, minimum=None):
    raw = _clean(os.environ.get(name))
    if not raw:
        return default
    try:
        val = cast(raw)
    except ValueError:
        return default
    if minimum is not None and val < minimum:
        return default
    return val


class GroqConfig:
    """Snapshot of the backend environment. `api_key` is deliberately kept out
    of repr() so an accidental print or log line cannot leak it."""

    def __init__(self, api_key, model, timeout, max_retries, max_output_tokens,
                 context_budget, max_retry_wait):
        self.api_key = api_key
        self.model = model
        self.timeout = timeout
        self.max_retries = max_retries
        self.max_output_tokens = max_output_tokens
        self.context_budget = context_budget
        self.max_retry_wait = max_retry_wait

    def __repr__(self):
        return (f'GroqConfig(model={self.model!r}, api_key={"<set>" if self.api_key else "<missing>"})')

    @classmethod
    def from_env(cls):
        key = _clean(os.environ.get('GROQ_API_KEY'))
        model = _clean(os.environ.get('GROQ_MODEL'))
        return cls(
            api_key='' if key.lower() in _PLACEHOLDERS else key,
            model='' if model.lower() in _PLACEHOLDERS else model,
            timeout=_env_number('GROQ_TIMEOUT_SECONDS', 45.0, float, 5.0),
            max_retries=_env_number('GROQ_MAX_RETRIES', 2, int, 0),
            max_output_tokens=_env_number('GROQ_MAX_OUTPUT_TOKENS', 1800, int, 200),
            context_budget=_env_number('GROQ_CONTEXT_TOKEN_BUDGET', 5000, int, 1000),
            max_retry_wait=_env_number('GROQ_MAX_RETRY_WAIT_SECONDS', 20.0, float, 0.0),
        )

    def problems(self):
        """Human-readable setup problems, empty when ready. Never includes the key."""
        out = []
        raw_key = _clean(os.environ.get('GROQ_API_KEY'))
        raw_model = _clean(os.environ.get('GROQ_MODEL'))
        if not self.api_key:
            if raw_key:
                out.append('GROQ_API_KEY is still the placeholder from .env.example. '
                           'Paste your real key from console.groq.com/keys into the backend .env file.')
            else:
                out.append('GROQ_API_KEY is not set. Add it to the backend .env file '
                           '(see .env.example) and restart the app.')
        if not self.model:
            if raw_model:
                out.append('GROQ_MODEL is still the placeholder from .env.example. '
                           'Set it to a chat model id from console.groq.com/docs/models.')
            else:
                out.append('GROQ_MODEL is not set. Add a Groq chat model id to the backend .env '
                           'file (see .env.example) and restart the app.')
        return out


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------
def estimate_tokens(text):
    """Cheap token estimate (no tokenizer dependency). Deliberately a little
    pessimistic: JSON and URLs tokenise worse than prose."""
    if not text:
        return 0
    return int(math.ceil(len(text) / 3.4))


def estimate_messages_tokens(messages):
    return sum(estimate_tokens(m.get('content') or '') + 4 for m in messages)


_THINK_RE = re.compile(r'<think>.*?</think>', re.S | re.I)
_FENCE_RE = re.compile(r'^\s*```(?:json)?\s*|\s*```\s*$', re.I)


def parse_json_object(text):
    """Pull one JSON object out of a model reply. Tolerates <think> blocks and
    markdown fences. Raises ValueError if there is no valid JSON object."""
    if not isinstance(text, str) or not text.strip():
        raise ValueError('the reply was empty')
    cleaned = _THINK_RE.sub('', text).strip()
    cleaned = _FENCE_RE.sub('', cleaned).strip()
    try:
        obj = json.loads(cleaned)
    except ValueError:
        start, end = cleaned.find('{'), cleaned.rfind('}')
        if start == -1 or end <= start:
            raise ValueError('no JSON object found in the reply')
        try:
            obj = json.loads(cleaned[start:end + 1])
        except ValueError as exc:
            raise ValueError(f'invalid JSON: {exc}')
    if not isinstance(obj, dict):
        raise ValueError('the reply was JSON but not an object')
    return obj


class Completion:
    def __init__(self, content, model, usage, finish_reason, attempts, parsed=None):
        self.content = content
        self.model = model
        self.usage = usage or {}
        self.finish_reason = finish_reason
        self.attempts = attempts
        self.parsed = parsed

    @property
    def prompt_tokens(self):
        return int(self.usage.get('prompt_tokens') or 0)

    @property
    def completion_tokens(self):
        return int(self.usage.get('completion_tokens') or 0)


# At most two Groq calls in flight from this process, so a burst of UI actions
# cannot trip the account's tokens-per-minute limit by itself.
_INFLIGHT = threading.BoundedSemaphore(2)


class GroqService:
    """Thin, well-behaved client for Groq's chat completions endpoint."""

    def __init__(self, config=None, *, base_url=GROQ_BASE_URL, session=None, sleep=time.sleep):
        self._config = config
        self.base_url = base_url.rstrip('/')
        self._session = session or requests.Session()
        self._sleep = sleep

    # ---- configuration -------------------------------------------------
    @property
    def config(self):
        return self._config or GroqConfig.from_env()

    def status(self):
        """Setup state without a network call. Safe to send to the browser:
        it reports whether the key is set, never the key itself."""
        cfg = self.config
        problems = cfg.problems()
        return {
            'provider': 'groq',
            'configured': not problems,
            'key_set': bool(cfg.api_key),
            'model': cfg.model or None,
            'problems': problems,
            'context_token_budget': cfg.context_budget,
        }

    def require_config(self):
        cfg = self.config
        problems = cfg.problems()
        if problems:
            raise GroqConfigError(' '.join(problems))
        return cfg

    def redact(self, text):
        text = '' if text is None else str(text)
        key = self.config.api_key
        if key:
            text = text.replace(key, '[redacted]')
        return _KEY_SHAPE.sub('[redacted]', text)

    # ---- connectivity check -------------------------------------------
    def verify(self):
        """Live check that the key is accepted and the model exists. Uses
        GET /models, which costs no tokens."""
        cfg = self.require_config()
        try:
            resp = self._session.get(
                f'{self.base_url}/models', headers=self._headers(cfg), timeout=min(cfg.timeout, 20))
        except requests.exceptions.Timeout:
            raise GroqTimeoutError('Groq did not answer in time. Check your connection and try again.')
        except requests.exceptions.RequestException as exc:
            raise GroqNetworkError(f'Could not reach Groq: {self.redact(type(exc).__name__)}. '
                                   'Check your internet connection or proxy.')
        if resp.status_code != 200:
            raise self._error_from_response(resp, cfg)
        try:
            ids = {m.get('id') for m in (resp.json().get('data') or [])}
        except ValueError:
            raise GroqAPIError('Groq returned an unreadable model list.')
        if ids and cfg.model not in ids:
            raise GroqModelError(
                f'GROQ_MODEL "{cfg.model}" is not available to your account. '
                'Pick a model id from console.groq.com/docs/models and update the backend .env file.')
        return {'ok': True, 'model': cfg.model, 'model_listed': bool(ids)}

    # ---- completions ---------------------------------------------------
    def complete(self, messages, *, temperature=0.3, max_tokens=None, json_mode=False):
        """One chat completion. Retries rate limits, 5xx, timeouts and network
        errors with backoff; raises a typed GroqError otherwise."""
        cfg = self.require_config()
        payload = {
            'model': cfg.model,
            'messages': messages,
            'temperature': temperature,
            'max_completion_tokens': int(max_tokens or cfg.max_output_tokens),
            'stream': False,
        }
        if json_mode:
            payload['response_format'] = {'type': 'json_object'}

        attempts = 0
        last_error = None
        dropped_format = False
        while True:
            attempts += 1
            try:
                with _INFLIGHT:
                    resp = self._session.post(
                        f'{self.base_url}/chat/completions', headers=self._headers(cfg),
                        json=payload, timeout=cfg.timeout)
                if resp.status_code == 200:
                    return self._completion_from_response(resp, cfg, attempts)
                err = self._error_from_response(resp, cfg)
                # Some models reject JSON mode; fall back to prompt-only JSON once.
                if (json_mode and not dropped_format and isinstance(err, GroqRequestError)
                        and re.search(r'response_format|json', err.message, re.I)):
                    payload.pop('response_format', None)
                    dropped_format = True
                    attempts -= 1
                    continue
            except requests.exceptions.ConnectTimeout as exc:
                err = GroqNetworkError(
                    f'Could not reach Groq ({type(exc).__name__}). '
                    'Check your internet connection, firewall or proxy.')
            except requests.exceptions.Timeout:
                err = GroqTimeoutError(
                    f'Groq did not answer within {int(cfg.timeout)} seconds. '
                    'Try again, or raise GROQ_TIMEOUT_SECONDS.')
            except requests.exceptions.RequestException as exc:
                err = GroqNetworkError(
                    f'Could not reach Groq ({type(exc).__name__}). '
                    'Check your internet connection, firewall or proxy.')

            last_error = err
            wait = self._retry_wait(err, attempts, cfg)
            log.warning('groq call failed: code=%s upstream=%s attempt=%d/%d',
                        err.code, err.upstream_status, attempts, cfg.max_retries + 1)
            if wait is None or attempts > cfg.max_retries:
                raise last_error
            self._sleep(wait)

    def complete_json(self, messages, *, validator=None, temperature=0.2, max_tokens=None):
        """Chat completion that must return a JSON object. `validator(obj)`
        may return a cleaned object or raise ValueError; one repair round is
        attempted before giving up. Never fabricates a result."""
        msgs = list(messages)
        last_problem = None
        for round_no in range(2):
            comp = self.complete(msgs, temperature=temperature, max_tokens=max_tokens, json_mode=True)
            try:
                obj = parse_json_object(comp.content)
                if validator:
                    obj = validator(obj)
                comp.parsed = obj
                return comp
            except ValueError as exc:
                last_problem = str(exc)
                if comp.finish_reason == 'length':
                    raise GroqResponseFormatError(
                        'The AI reply was cut off by the output limit before it finished. '
                        'Raise GROQ_MAX_OUTPUT_TOKENS or ask for a smaller scope.')
                log.warning('groq json invalid (round %d): %s', round_no + 1, self.redact(last_problem)[:200])
                msgs = msgs + [
                    {'role': 'assistant', 'content': (comp.content or '')[:4000]},
                    {'role': 'user', 'content': (
                        f'That reply could not be used ({last_problem}). Reply again with only the corrected '
                        'JSON object, matching the requested structure exactly, with no extra text.')},
                ]
        raise GroqResponseFormatError(
            'The AI returned a reply in the wrong format twice. Try again; if it keeps happening, '
            f'try a different GROQ_MODEL. ({self.redact(last_problem)[:160]})')

    # ---- internals -----------------------------------------------------
    def _headers(self, cfg):
        return {
            'Authorization': f'Bearer {cfg.api_key}',
            'Content-Type': 'application/json',
            'User-Agent': USER_AGENT,
        }

    def _retry_wait(self, err, attempts, cfg):
        """Seconds to wait before the next attempt, or None if retrying cannot help."""
        if isinstance(err, GroqRateLimitError):
            if err.retry_after is not None:
                if err.retry_after > cfg.max_retry_wait:
                    return None
                return err.retry_after + random.uniform(0.1, 0.5)
            return min(2 ** attempts, cfg.max_retry_wait) + random.uniform(0, 0.5)
        if err.retryable:
            return min(1.5 * (2 ** (attempts - 1)), 12) + random.uniform(0, 0.5)
        return None

    @staticmethod
    def _error_body(resp):
        try:
            body = resp.json()
        except ValueError:
            return '', ''
        err = body.get('error') if isinstance(body, dict) else None
        if isinstance(err, dict):
            return str(err.get('message') or ''), str(err.get('code') or err.get('type') or '')
        return '', ''

    @staticmethod
    def _retry_after_seconds(resp):
        raw = resp.headers.get('retry-after') or resp.headers.get('Retry-After')
        if raw:
            try:
                return max(0.0, float(raw))
            except ValueError:
                pass
        return None

    def _error_from_response(self, resp, cfg):
        status = resp.status_code
        message, code = self._error_body(resp)
        message = self.redact(message)[:400]
        low = f'{message} {code}'.lower()

        if status in (401, 403):
            return GroqAuthError(
                'Groq rejected the API key (it may be invalid, revoked or expired). Create a new key at '
                'console.groq.com/keys, put it in the backend .env file as GROQ_API_KEY and restart the app.',
                status=status)
        if status == 404 or 'model_not_found' in low or 'decommission' in low or 'does not exist' in low:
            return GroqModelError(
                f'Groq could not use the model "{cfg.model}": {message or "model not found"}. '
                'Set GROQ_MODEL in the backend .env file to a current model id from '
                'console.groq.com/docs/models.', status=status)
        if status == 413 or 'context_length' in low or 'reduce the length' in low \
                or ('too large' in low and 'token' in low):
            return GroqContextTooLargeError(
                'The report context is too large for this model or your Groq token limit. '
                'Lower GROQ_CONTEXT_TOKEN_BUDGET, pick a model with a larger limit, or ask about a '
                f'smaller part of the crawl. ({message})'.strip(), status=status)
        if status == 429:
            retry_after = self._retry_after_seconds(resp)
            when = f' Try again in about {int(math.ceil(retry_after))} seconds.' if retry_after else ''
            return GroqRateLimitError(
                f'Groq rate limit reached.{when} ({message})'.strip(), status=status, retry_after=retry_after)
        if status in (500, 502, 503, 504):
            return GroqAPIError(f'Groq is having trouble right now (HTTP {status}). Try again shortly.',
                                status=status)
        if status == 400:
            return GroqRequestError(f'Groq rejected the request: {message or "bad request"}', status=status)
        return GroqAPIError(f'Unexpected response from Groq (HTTP {status}). {message}'.strip(), status=status)

    def _completion_from_response(self, resp, cfg, attempts):
        try:
            body = resp.json()
            choice = (body.get('choices') or [])[0]
            content = (choice.get('message') or {}).get('content') or ''
        except (ValueError, IndexError, AttributeError, TypeError):
            raise GroqAPIError('Groq returned a reply this app could not read.', status=resp.status_code)
        content = _THINK_RE.sub('', content).strip()
        return Completion(content=content, model=body.get('model') or cfg.model,
                          usage=body.get('usage') or {}, finish_reason=choice.get('finish_reason'),
                          attempts=attempts)


_default_service = GroqService()


def get_service():
    """Process-wide service instance used by the web layer."""
    return _default_service
