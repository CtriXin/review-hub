# review-hub

`review-hub` is a phase-based review orchestrator for independent model reviews.

It keeps the top-level taxonomy flat:

- `phase`: `pre | mid | post`
- `read_policy`: `fresh_required | artifact_first_optional_refresh | verify_only`
- `adapter`: `figma | image | doc | mixed | live-site`
- `focus`: `source | design | acceptance | regression | factuality`

## Why

Most review systems become too vertical (`figma review`, `qa review`, `design review`, `prod review`, and so on). Review Hub avoids that by treating Figma, screenshots, docs, and live sites as adapters, not top-level lanes.

## Install

Registry package name:

```text
@ctrixin/review-hub
```

Recommended install:

```bash
npx @ctrixin/review-hub --help
```

Or:

```bash
npm install -g @ctrixin/review-hub
review-hub --help
```

This is the primary public install path.

If you want the latest GitHub state before the next npm release, use the GitHub fallback:

```bash
npx --yes github:CtriXin/review-hub --help
```

Or:

```bash
npm install -g github:CtriXin/review-hub
review-hub --help
```

Local clone:

```bash
npm link
review-hub --help
```

Direct from a clone without linking:

```bash
node ./bin/review-hub.js --help
```

Default behavior writes real artifacts. Use `--dry-run` only when you explicitly want preview/no-write behavior.
Interactive `init` / `install-commands` print short human summaries by default; add `--json` when you explicitly want machine-readable output.

## Init

`review-hub init` now has two behaviors:

1. bare `review-hub init`
   - onboarding/bootstrap mode
   - auto-detect local runner surfaces
   - opens a Space-select picker for installable runners
   - hides already-installed runners from the picker and summarizes them separately
   - installs `/review-hub` command files plus skill links for the selected runners
   - for Codex, also installs a custom prompt alias at `~/.codex/prompts/review-hub.md`
   - interactive TTY output is concise text, not a raw JSON blob
2. `review-hub init --root <path>`
   - legacy/project mode
   - initializes a local `.review-hub/` root for that workspace

Example bootstrap flow:

```bash
review-hub init
```

After Codex install, use one of these:

```text
/prompts:review-hub <request-root>
$review-hub
```

Example project-local init:

```bash
review-hub init --root .
```

## Runner-first workflow

Review Hub now supports two distinct flows:

1. **authoring mode**: create a new request root
2. **reviewer mode**: open an existing request root or reviewer slot from a fresh runner/model session

The reviewer-mode path is the main handoff surface when you want to manually start different MMS runners without copying a long prompt.

Dispatcher-facing rule:

- the dispatcher should create the request internally
- the user-facing output should normally be only:
  - `/review-hub <request-root>`
  - optional fallback: `review-hub reviewer '<request-root>' --model '<MODEL_NAME>'`
- when the reviewer is already running under `MMS/mmf`, prefer the short slash-command only

## Quick start

### Authoring mode

```bash
review-hub init --root .
review-hub request \
  --root . \
  --title "Second opinion on Figma audit" \
  --summary "Independent source reread before trusting the current audit." \
  --phase pre \
  --adapter figma \
  --focus source \
  --focus design \
  --model gpt-5 \
  --model claude-sonnet-4-5 \
```

This writes:

- `request.json`
- `REQUEST.md`
- `PROMPT.template.md`
- `LAUNCH.md`
- `launch.json`
- `reviewers/<model-slug>/...`

### Reviewer mode

In a fresh runner/model session, use the request root directly:

```bash
review-hub reviewer ./.review-hub/requests/<request-id>
```

Or, if the runner has the installed slash-command surface, use the shorter entry:

```text
/review-hub ./.review-hub/requests/<request-id>
```

Behavior:

- resolve the current model from MMS env when possible
- hydrate or reuse the current model slot
- point the reviewer at the on-disk `PROMPT.md` / `manifest.json`
- preserve output order via `LAUNCH.md` and `launch.json`

If the runner does not support `/review-hub`, `LAUNCH.md` also includes a short fallback prompt so you still do not need to paste the full prompt template.

## Commands

- `init`: initialize a local review-hub root
- `init` without `--root`: interactive runner bootstrap
- `request`: create a durable review request root and optional reviewer slots
- `slot`: create a model-specific reviewer slot from an existing request
- `reviewer`: resolve a request root or slot root into the current model reviewer slot
- `worker-plan`: create a per-model toolful worker launch plan for hosts such as MMS/OpenCode
- `aggregate`: summarize reviewer completion and verdict snippets
- `install-commands`: install `/review-hub` command files and skill symlinks for supported local runners
- `recommend`: recommend `phase` and `read_policy`

## Dry run

Add `--dry-run` when you want preview-only behavior without writing files:

```bash
review-hub request --root . --title "Preview only" --phase post --adapter mixed --dry-run
review-hub reviewer ./.review-hub/requests/<request-id> --dry-run
```

## Mission Control compatibility

Use:

```bash
review-hub request \
  --root <implementation-root> \
  --artifact-mode mission-control \
  --artifact-root <artifact-root> \
  --phase post \
  --adapter live-site \
  --focus acceptance \
  --focus regression \
```

This places the request under the Mission Control artifact tree instead of `./.review-hub/`.

## Toolful worker host

When the original dispatcher is not the execution host, generate a worker plan after model selection:

```bash
review-hub worker-plan \
  --request ./.review-hub/requests/<request-id> \
  --runner opencode \
  --model qwen3.7-max \
  --model kimi-k2.6 \
  --parallel 2
```

This writes:

- `runner/opencode-worker-plan.json`
- `runner/opencode-worker-plan.md`

The plan gives MMS/OpenCode a stable contract: every worker receives the same request root, model identity is supplied through `REVIEW_HUB_MODEL` / `MULTI_REVIEW_REVIEWER`, and the worker hydrates its own slot before reading `PROMPT.md`. MCP and skills are not assumed globally; the runner host must inject them into the worker session.

## Environment preflight

Generated reviewer prompts always start with environment preflight. Reviewers must verify required tools, auth/capability, and required paths before deeper work.

## Runner surfaces

Auto-install is currently wired for command/skill locations that have stable evidence on this machine:

- `~/.agents`
- `~/.claude`
- `~/.codex`
- `~/.config/opencode`
- `~/.opencode`

`mimocode` is treated as experimental for now. `pi` and `agy` can still use request-root reviewer mode through `LAUNCH.md` even when automatic slash-command installation is not guaranteed.

Interactive bootstrap only shows detected installable runners by default. `agy` and `pi` are reported as manual-only when they are detected, because Review Hub can still hand them the short path-based reviewer command even though automatic slash-command installation is not yet guaranteed.
