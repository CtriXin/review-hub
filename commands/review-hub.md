# /review-hub

Use Review Hub.

Treat the text after `/review-hub` as a review request. Review Hub is phase-based:

- `pre`: independent source reread before trusting current audit/plan
- `mid`: challenge the current artifact first, reread source only if needed
- `post`: verify the claimed result first, reread source only on conflict

Behavior:

1. If `phase` is not clear, ask a short question and recommend `pre` / `mid` / `post`.
   - You may use `review-hub recommend --title "<title>" --summary "<summary>" --adapter <adapter>` first.
2. Convert the task into a Review Hub request.
3. Prefer the local `review-hub` CLI if available.
4. If the current session exposes an MMS model id, model name can be omitted and resolved automatically.
5. Generate durable artifacts: `request.json`, `REQUEST.md`, reviewer `PROMPT.md`, and model-specific slot folders.
6. Reviewer prompts must start with environment preflight so missing MCP/tool/auth/path issues are caught before deeper work.

Canonical runtime: repository `review-hub`, `SKILL.md`, and `review-hub` CLI.
