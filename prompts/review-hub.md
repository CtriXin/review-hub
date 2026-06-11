---
description: Review Hub authoring or reviewer-mode handoff
argument-hint: [REQUEST_ROOT_OR_TASK]
---

Use Review Hub.

User input:

`$ARGUMENTS`

Treat Review Hub as a dual-mode entrypoint.

## Mode detection

1. If `$ARGUMENTS` resolves to an existing Review Hub request root or reviewer slot root, enter reviewer mode.
2. Otherwise, treat `$ARGUMENTS` as a new authoring-mode review request.

A request root usually contains `request.json`, `REQUEST.md`, `launch.json`, or `LAUNCH.md`.
A reviewer slot usually contains `PROMPT.md` and `manifest.json` under `reviewers/<model-slug>/`.

## Reviewer mode

Use reviewer mode when the user already has a prepared request and wants to launch a specific runner/model session without copying a long prompt.

Steps:

1. Run `review-hub reviewer <path>`.
2. Let the CLI resolve the current model from MMS env when possible.
3. Reuse the current model slot if it already exists; otherwise create it.
4. Read the returned `prompt_path` and `launch_path` from disk instead of asking the user to restate the task.
5. Write only inside the assigned slot root.
6. Run environment preflight first; if required tools or paths are missing, write the blocked preflight artifact and stop.

Rules:

- Do not ask the user to paste the long reviewer prompt.
- Do not create a brand new request when the input already points at a request root.
- Prefer the `LAUNCH.md` ordering when multiple models are involved.
- `review-hub` defaults to real writes; only use `--dry-run` when the user explicitly wants preview/no-write behavior.

## Authoring mode

Use authoring mode when the user is asking you to prepare a new review request.

Behavior:

1. If `phase` is not clear, ask one short clarification question and recommend `pre`, `mid`, or `post`.
2. Convert the task into a Review Hub request.
3. Prefer the local `review-hub` CLI if available.
4. Generate durable artifacts: `request.json`, `REQUEST.md`, `PROMPT.template.md`, `LAUNCH.md`, `launch.json`, and model-specific slot folders.
5. Reviewer prompts must start with environment preflight so missing MCP, tool, auth, or path issues are caught before deeper work.

User-facing output contract:

- absorb the raw `review-hub request ...` creation command yourself; do not dump it to the user unless explicitly asked
- after authoring, return only:
  - primary short command: `/prompts:review-hub <request-root>`
  - optional skill form: `$review-hub`
  - optional CLI fallback: `review-hub reviewer '<request-root>' --model '<MODEL_NAME>'`

Canonical runtime: repository `review-hub`, `SKILL.md`, and `review-hub` CLI.
