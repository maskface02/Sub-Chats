# Release notes — Sub-chats v1.0.0

v1.0.0 is the first production release. It ships everything from phases 0–5: an AI chat app where any reply can be branched into a focused sub-chat, navigated as a tree, powered by your own provider keys, and deployed on Vercel with a real database.

## Phase 0 — accounts & streaming chat

- Create an account with email + password; sign in and out whenever you like — sessions live server-side, so signing out really signs you out.
- Chat with an AI model and watch replies stream in token-by-token.
- Every message is saved — reload the page and your conversation is exactly where you left it.
- Works out of the box with an OpenAI key or a local Ollama install, with automatic fallback between them; if neither is configured, the app tells you clearly instead of failing silently.
- Your recent chats are listed on the home page, newest first.
- Security defaults from day one: hashed passwords, rate-limited sign-in, and cross-user access that looks exactly like a missing page.

## Phase 1 — sub-chats (branch a conversation anywhere)

- Highlight any text in an AI reply and click the floating **Ask about this** pill — a new sub-chat opens, focused on your selection, with the full parent conversation loaded as context.
- The AI understands references: ask "what's the best one for small teams?" about a highlighted phrase and it knows what "one" means.
- Sub-chats can spawn their own sub-chats — explore a tangent without losing your place.
- A breadcrumb at the top of every sub-chat shows the path back to the root.
- New conversations title themselves from your first message.

## Phase 2 — see and use the whole tree

- A tree-map sidebar shows every conversation in the current tree, top-down; click any node to jump there (opens as a drawer on mobile).
- Split view: read two conversations side-by-side, each with its own composer and streaming reply; drag the divider, or stack the panes vertically.
- Very large trees (over 500 nodes) are truncated gracefully, with an honest "showing 500 of N" count.

## Phase 3 — bring your own key & rich replies

- Add your own providers from the UI — OpenAI, Anthropic, Ollama, or any OpenAI-compatible endpoint. Your keys are encrypted at rest and never shown to anyone again (not even you — by design).
- Your default provider is used for all your chats; without one, the server's configured fallback chain applies.
- Assistant replies render real markdown: tables, task lists, and fenced code — raw HTML in AI output is never executed.

## Phase 4 — everyday polish

- Delete a conversation — and its whole subtree — with a 5-second **Undo** toast in case of regret.
- Export any conversation as Markdown (readable copy) or JSON (full raw data for backups/tooling).
- Search the tree by title or highlighted text with `/`; matches highlight live and stay reachable through their ancestors.
- Stop a reply that's going on too long — the partial answer is kept, and you can send a new message immediately.
- Edit a message you sent (the reply re-streams from there) or regenerate the last reply for a different take.
- Keyboard shortcuts (`Cmd/Ctrl+K`, `/`, `Cmd/Ctrl+\`, `Esc`, `?`) and syntax-highlighted code blocks in light and dark themes.

## Phase 5 — production ready

- Deployable on Vercel with a managed Postgres database: PRs get preview deploys, `main` deploys to production, and the build never needs a live database.
- `GET /api/health` verifies a deployment in one `curl` — database reachability, provider resolution, and migration state, with nothing sensitive in the response.
- Every API request is logged with a correlation id, echoed back to your browser as `X-Request-Id` — report that id and support can find the exact request in the logs.
- A written runbook covers deploy, backup/restore, rollback, and secret rotation, so incident response is never improvised.
- No new user-facing features — this phase was purely about operability and deployability.

## Known limitations (v1.0.0)

- **Rate limiting is in-memory and single-instance.** Sign-in and mutation rate limits reset when the server restarts and count per server instance; a shared store (e.g. Upstash Redis) is a documented future option.
- **Ollama-type user providers are admin-gated.** Adding an Ollama provider from Provider settings only works on deployments that set `ADMIN_ALLOW_OLLAMA_USERS=true` (default `false` — self-hosted Ollama URLs are usually unreachable from serverless hosting anyway).
- **E2E tests are a manual gate.** The Playwright suite is not run in CI (it needs a live AI provider); it is executed manually before each release.
- **Markdown renders after the stream completes.** While a reply is streaming you see plain text with a caret; tables, code blocks, and links appear when the reply finishes.
