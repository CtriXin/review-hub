# /review-hub

Use Review Hub.

Treat `/review-hub` as a dual-mode entrypoint.

## Mode detection

1. If the text after `/review-hub` resolves to an existing Review Hub request root or reviewer slot root, enter **reviewer mode**.
2. Otherwise, treat the text after `/review-hub` as a new **authoring mode** review request.

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
6. Run environment preflight first; if required tools/paths are missing, write the blocked preflight artifact and stop.

Rules:

- Do not ask the user to paste the long reviewer prompt.
- Do not create a brand new request when the input already points at a request root.
- Prefer the `LAUNCH.md` ordering when multiple models are involved.
- `review-hub` defaults to real writes; only use `--dry-run` when the user explicitly wants preview/no-write behavior.
- If the runner does not support the `/review-hub` command surface, use the short fallback prompt from `LAUNCH.md` instead of pasting `PROMPT.md`.

## Toolful worker host mode

Use this when an execution host such as MMS/OpenCode asks the user to choose reviewer models after the dispatcher already created a request.

Steps:

1. The host runs `review-hub worker-plan --request <request-root> --runner opencode --model <MODEL>...`.
2. Each worker receives the same request-root command and a distinct model env (`REVIEW_HUB_MODEL` / `MULTI_REVIEW_REVIEWER`).
3. Each worker runs `review-hub reviewer <request-root>`, reads its own `PROMPT.md`, and writes only inside its assigned slot.
4. MCP/skills must come from the host runner's session-local config; do not assume the original dispatcher session has transferred them.

## Authoring mode

Use authoring mode when the user is asking you to prepare a new review request.

Behavior:

1. If `phase` is not clear, ask one short clarification question and recommend `pre` / `mid` / `post`.
   - You may use `review-hub recommend --title "<title>" --summary "<summary>" --adapter <adapter>` first.
2. Convert the task into a Review Hub request.
3. Prefer the local `review-hub` CLI if available.
4. Generate durable artifacts: `request.json`, `REQUEST.md`, `PROMPT.template.md`, `LAUNCH.md`, `launch.json`, and model-specific slot folders.
5. Reviewer prompts must start with environment preflight so missing MCP/tool/auth/path issues are caught before deeper work.

User-facing output contract:

- absorb the raw `review-hub request ...` creation command yourself; do not dump it to the user unless explicitly asked
- after authoring, return only:
  - primary short command: `/review-hub <request-root>`
  - optional manual-model fallback: `review-hub reviewer '<request-root>' --model '<MODEL_NAME>'`
- if the user is likely in `MMS/mmf`, lead with the short command and keep the fallback as an optional second line
- on official Codex surfaces, prefer `/prompts:review-hub <request-root>` or `$review-hub` because Codex prompt/skill entrypoints differ from Claude-style bare slash commands

Canonical runtime: repository `review-hub`, `SKILL.md`, and `review-hub` CLI.

## `review-hub init`

Interpret `review-hub init` like this:

1. bare `review-hub init`
   - onboarding/bootstrap mode
   - detect installed runner surfaces on the machine
   - show a Space-select installer for supported runners
   - interactive TTY output should stay concise and human-readable; use `--json` only when machine-readable output is needed
2. `review-hub init --root <path>`
   - local project mode
   - initialize `.review-hub/` under that root
