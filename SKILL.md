---
name: review-hub
description: "Phase-based review orchestration for independent pre/mid/post reviews, model-specific reviewer slots, durable prompt packs, and aggregate outputs."
---

# Review Hub

Use Review Hub when the user wants independent review or model fanout without hard-coding the review lane to one domain like Figma, QA, or production.

Review Hub is deliberately flat:

- `phase` decides **when** the review happens:
  - `pre`
  - `mid`
  - `post`
- `read_policy` decides **how** the reviewer should consume source:
  - `fresh_required`
  - `artifact_first_optional_refresh`
  - `verify_only`
- `adapter` decides **where** source comes from:
  - `figma`
  - `image`
  - `doc`
  - `mixed`
  - `live-site`
- `focus` decides **what** the reviewer is mainly checking:
  - `source`
  - `design`
  - `acceptance`
  - `regression`
  - `factuality`

Do not create separate top-level skills for every adapter. Figma, screenshots, docs, and live sites are inputs, not taxonomy roots.

## Core commands

```bash
review-hub init --root . --write
review-hub request --root . --title "<title>" --summary "<summary>" --phase pre --adapter figma --focus source --focus design --write
review-hub slot --request <request-root> --model <model-name> --write
review-hub aggregate --request <request-root> --write
review-hub install-commands --write
```

## Defaults

- `pre` -> `read_policy=fresh_required`
- `mid` -> `read_policy=artifact_first_optional_refresh`
- `post` -> `read_policy=verify_only`

## Output roots

Standalone default:

```text
<root>/.review-hub/requests/<request-id>/
```

Mission Control managed mode:

```text
<artifact-root>/.mission/reviews/requests/<request-id>/
```

Use `--artifact-mode mission-control --artifact-root <artifact-root>` when Mission Control should own placement.

## Reviewer slot rule

Each reviewer slot is model-specific and contains:

```text
reviewers/<model-slug>/PROMPT.md
reviewers/<model-slug>/manifest.json
reviewers/<model-slug>/raw/
```

If the current session exposes MMS model identity, `review-hub slot` may omit `--model` and resolve it from `MMS_SESSION_PACKET_JSON` or `MMS_MODEL_NAME`.

## Environment preflight rule

Every generated reviewer prompt must start by checking:

1. current root and output root
2. required tools/capabilities (for example `figma-mcp`, browser, lark-cli)
3. required paths and source artifacts
4. whether the declared review can proceed without hidden auth/tool gaps

If prerequisites are missing, the reviewer must write a blocked preflight artifact and stop instead of wasting time.

## Phase guidance

### `pre`

Use for:
- source reread
- Figma reread
- annotation coverage
- requirement contradiction
- decomposition challenge

### `mid`

Use for:
- challenge the current plan/audit/patch
- ask what is missing from the current artifact
- optional source refresh only if the current artifact is weak or conflicting

### `post`

Use for:
- acceptance verification
- regression review
- done-state challenge
- live / screenshot / evidence audit without default source reread

## Command surface

If the user invokes `/review-hub` and phase is unclear, ask one short clarification question and recommend the phase instead of forcing a full taxonomy discussion.

Use this helper when phase is unclear and you want a fast machine recommendation before asking:

```bash
review-hub recommend --title "<title>" --summary "<summary>" --adapter <adapter>
```
