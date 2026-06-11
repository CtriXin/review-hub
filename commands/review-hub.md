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

1. Run `review-hub reviewer <path> --write`.
2. Let the CLI resolve the current model from MMS env when possible.
3. Reuse the current model slot if it already exists; otherwise create it.
4. Read the returned `prompt_path` and `launch_path` from disk instead of asking the user to restate the task.
5. Write only inside the assigned slot root.
6. Run environment preflight first; if required tools/paths are missing, write the blocked preflight artifact and stop.

Rules:

- Do not ask the user to paste the long reviewer prompt.
- Do not create a brand new request when the input already points at a request root.
- Prefer the `LAUNCH.md` ordering when multiple models are involved.
- If the runner does not support the `/review-hub` command surface, use the short fallback prompt from `LAUNCH.md` instead of pasting `PROMPT.md`.

## Authoring mode

Use authoring mode when the user is asking you to prepare a new review request.

Behavior:

1. If `phase` is not clear, ask one short clarification question and recommend `pre` / `mid` / `post`.
   - You may use `review-hub recommend --title "<title>" --summary "<summary>" --adapter <adapter>` first.
2. Convert the task into a Review Hub request.
3. Prefer the local `review-hub` CLI if available.
4. Generate durable artifacts: `request.json`, `REQUEST.md`, `PROMPT.template.md`, `LAUNCH.md`, `launch.json`, and model-specific slot folders.
5. Reviewer prompts must start with environment preflight so missing MCP/tool/auth/path issues are caught before deeper work.

Canonical runtime: repository `review-hub`, `SKILL.md`, and `review-hub` CLI.
