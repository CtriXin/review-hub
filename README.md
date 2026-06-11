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

Local clone:

```bash
npm link
review-hub --help
```

Direct from a clone without linking:

```bash
node ./bin/review-hub.js --help
```

## Runner-first workflow

Review Hub now supports two distinct flows:

1. **authoring mode**: create a new request root
2. **reviewer mode**: open an existing request root or reviewer slot from a fresh runner/model session

The reviewer-mode path is the main handoff surface when you want to manually start different MMS runners without copying a long prompt.

## Quick start

### Authoring mode

```bash
review-hub init --root . --write
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
  --write
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
review-hub reviewer ./.review-hub/requests/<request-id> --write
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
- `request`: create a durable review request root and optional reviewer slots
- `slot`: create a model-specific reviewer slot from an existing request
- `reviewer`: resolve a request root or slot root into the current model reviewer slot
- `aggregate`: summarize reviewer completion and verdict snippets
- `install-commands`: install `/review-hub` command files and skill symlinks for supported local runners
- `recommend`: recommend `phase` and `read_policy`

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
  --write
```

This places the request under the Mission Control artifact tree instead of `./.review-hub/`.

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
