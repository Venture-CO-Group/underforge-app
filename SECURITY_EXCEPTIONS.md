# Security Exceptions

Vulnerable dependencies that are knowingly **not** upgraded yet, with justification and a
remediation path. Reviewed as part of the `hardening/phase-1` work (task T-07).

Each entry must state: the package + advisory, why it can't be safely fixed now, the
residual-risk assessment, and the tracked follow-up.

---

## pydantic-ai / pydantic-ai-slim — SSRF (CVE-2026-25580 + follow-ups)

- **Advisory:** [GHSA-2jrp-274c-jhv3](https://github.com/pydantic/pydantic-ai/security/advisories/GHSA-2jrp-274c-jhv3) (CVE-2026-25580), plus incomplete-fix follow-ups CVE-2026-46678 and CVE-2026-48782.
- **Current version:** `0.4.7` (direct dependency in `backend/pyproject.toml`: `pydantic-ai[logfire]>=0.4.7`).
- **Affected range:** `>= 0.0.26, < 1.56.0` for the original CVE; fully patched only at **2.0.0** after the two incomplete-fix follow-ups.

### Why not fixed now
There is **no fix within the 0.x line**. Remediation requires a major-version jump
(`0.4.7` → `2.0.0`), which changes the model-construction API used in
`backend/send_notifications/llm.py` (`Agent`, `OpenAIModel`, `AnthropicModel`,
`FallbackModel`). That is a breaking migration that must be done and tested on its own,
not bundled into a dependency-bump pass. Per the Phase-1 decision, the major upgrade is
**deferred**.

### Residual risk: LOW
The SSRF is in pydantic-ai's **URL-download / untrusted-message-history** handling
(fetching attacker-supplied `ImageUrl` / `DocumentUrl` / `force_download` content). The
backend's only use of pydantic-ai is **text-prompt notification agents** — it does not
download user- or model-supplied URLs and does not feed untrusted message history into an
agent. The vulnerable code path is therefore not reached in normal operation.

> Note: `pip-audit` against the backend environment did **not** flag this (its OSV/PyPI
> advisory index does not yet carry the 2026 pydantic-ai advisory at the time of writing).
> This exception is based on the upstream GitHub Security Advisory, not on `pip-audit`.

### Remediation path (tracked follow-up)
Dedicated task: upgrade `pydantic-ai` to `>= 2.0.0`, migrate `llm.py` to the new model
API, and re-run the backend test suite (`tests/backend/...`). Re-check that no other
backend dependency requires the old pydantic-ai major.

---

## Resolved in T-07 (for reference — NOT exceptions)

These were remediated in the same pass and are listed only so this file reflects the full
picture:

- **aiohttp** (CVE-2025-69223 zip-bomb DoS): `3.12.14` → **`3.14.1`** via `uv lock --upgrade-package aiohttp`. Transitive (huggingface-hub[inference], modal).
- **tmp** (`<0.2.6` path traversal): pinned to **`^0.2.6`** (resolved `0.2.7`) via `overrides`. Transitive, dev-only (patch-package).
- **jsondiffpatch** (`<0.7.2`): pinned to **`0.7.2`** via `overrides`. Transitive (ai@4.x, RSC path unused by this Expo app). Verified API-compatible (`diff`/`patch`/`clone`) — no exception needed.
- **h2 (4.2.0) / filelock (3.18.0) / requests (2.32.4):** already at non-vulnerable versions; confirmed clean by `pip-audit`. No change needed.
