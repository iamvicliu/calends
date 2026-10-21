# Notes for coding agents

Calends is a single-owner subscription ledger. Application pages live at `/` and require login; the optional read-only public page lives at `/public`. See [web requests and state](ARCHITECTURE.md#web-requests-and-state) for routes and login redirects. The same billing rules and Worker run on Cloudflare and in Docker.

## Before changing a subsystem

Read the relevant section of [ARCHITECTURE.md](ARCHITECTURE.md), then follow its source links and callers to verify the current implementation. Use [docs/code-standards.md](docs/code-standards.md) when writing or reviewing code and [CONTRIBUTING.md](CONTRIBUTING.md) for setup and commands.

Update the owning architecture section in the same change when responsibilities, interfaces, stored state, runtime paths, compatibility or failure behavior change. A refactor that preserves those contracts does not need a prose edit. Keep each fact in one document and link to it.

## Project boundaries

- Put billing, phases, exchange-rate calculations and financial metrics in `shared/`; browser and Worker must agree. Keep this layer independent of browser and server APIs.
- Preserve historical prices, currencies, plan periods and payments. Read failures or missing financial data must not silently become zero, an empty ledger or a replacement write.
- Keep private state behind authentication. Public responses must pass through `maskForPublic`; hiding a field in the UI is insufficient.
- Keep MCP permissions and `dry_run` behavior intact. The in-app assistant uses the same tools and requires confirmation for writes; external MCP clients have their own confirmation flow.
- Use an isolated database, data volume and fictional fixtures for tests, screenshots and demos. Do not migrate, seed, restore or reset a user's live ledger as part of verification.
- Inspect the worktree before editing. Preserve unrelated work and personal configuration under `local/`; never stage credentials, `.dev.vars`, database files or real backups.

## Verification and handoff

Choose checks using the [verification matrix](docs/code-standards.md#verification). For a behavior fix, reproduce the reported case and add a regression test where the existing harness can exercise it. Run relevant checks after the final edit; identify anything not run.

Describe the trigger and observable before/after behavior, affected contracts, checks and remaining limits. When reviewing, verify that description against callers and state transitions beyond the diff. A build is not runtime verification; a workflow file, tag or local image is not a published artifact. Commit, push, deploy and publish only within the user's authorized scope.
