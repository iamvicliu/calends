# Code standards

[Architecture](../ARCHITECTURE.md) · [Contributing](../CONTRIBUTING.md) · [Agent instructions](../AGENTS.md)

These rules apply to human and AI-authored changes. They describe what an author should establish and what a reviewer should verify.

## Scope and behavior

- Give every behavior change a reason tied to the task. Keep unrelated refactors, features and deployment changes out of the patch.
- Trace the complete operation: input, validation, calculation, persistence, re-read and presentation. For a pricing fix, check the editor, detail page, reports and MCP callers that share that calculation.
- Search for sibling cases and derived values. A changed billing rule can affect forecasts, wallet runway, reminders, calendar feeds and public totals as well as the page in the report.
- Preserve explicit user settings when applying defaults or migrations. Optimistic UI updates must merge with current state and recover correctly when the request fails; use the existing patterns in `app/src/store.ts`.
- Distinguish an unavailable rate, failed request or invalid backup from an empty or zero-valued result. Do not turn a failed read into a destructive replacement or mark incomplete financial data as complete.

## Data and privacy

- Financial rules belong in `shared/`, with one implementation used by UI and Worker. Retain original amounts and currencies, phase boundaries and payment records; do not rewrite history just to simplify a display.
- Add schema changes as new files in `worker/migrations/`. Update serialization and backup compatibility when persisted fields change. Existing JSON records and older supported backups must still load.
- Treat public exposure as a server contract. Check the response produced by `shared/mask.ts`, including nested phases, payment methods, settings and identifying text. Do not rely on CSS, omitted components or a client-side filter.
- Check authorization on the actual request path. Include unauthenticated requests and read-only MCP tokens when they are affected.
- A tool preview must not persist the proposed ledger mutation. Read/write MCP permission does not imply mandatory server-side confirmation; the built-in assistant separately forces drafts and confirms them in its apply endpoint.
- Test with fictional data in temporary storage. Keep tokens, channel credentials and real ledger contents out of fixtures, screenshots, logs and Git. See [SECURITY.md](../SECURITY.md) for vulnerability reporting.

## UI and translations

- Reuse the existing components and visual system. App components live in `app/src/components/` and `app/src/views/`; the public page has its own components and styles under `app/src/public/`. Avoid broad CSS rules that leak between them.
- Use `CardTitle` for app title/hint pairs, `IconButton` for circular actions and the shared `icon-text`/row classes for icon/text alignment. Center with flex and `align-items: center`; do not compensate for font baselines with offsets, negative margins or transforms. Keep icon actions at least 32px (40px on narrow/coarse-pointer screens), with an accessible name and visible keyboard focus. Shrinking text needs `min-width: 0` and ellipsis; amount columns keep their width, right alignment and tabular numerals. Portal overlays and constrain them to the viewport. Keep equivalent rules in the separate public components.
- Parallel app metrics use `MetricCards` / `Metric` from `ui.tsx`: independent gray rounded cards following subscription-detail KPIs, with a muted small label, a semibold value and an optional muted note. Keep formatting, signs, semantic colors and missing-data states in the caller; do not repeat the same metric on a page. `ui.css` owns typography, equally sized columns (up to four) and container-based wrapping into two columns or a vertical stack. Shared-plan detail content may retain its direct label/value/note slots inside `MetricCards`.
- Sheet and embedded-form action groups use `.sheet-actions`, including the shared footer. Secondary actions precede the primary action in both JSX and visual order; the group aligns right and wraps without a scrollbar. Keep field controls, mode choices and table-row actions in their own layouts. Do not add local alignment overrides to action rows.
- Adjacent controls in one visual row must use the same height tier, including text/icon buttons, segmented controls (outer frame), dropdowns and search fields. Use the shared tokens in `app/src/control-sizes.css`: `--ctl-h-sm` (28px) for standalone compact filter/chip rows, `--ctl-h-md` (32px) for toolbars, card actions, form controls and dialog actions, and `--ctl-h-lg` (40px) for prominent actions. Do not mix tiers within a row or hard-code control heights in components; small text does not imply a smaller hit area. At 860px and below or with a coarse pointer, all tiers resolve to 40px so entire rows grow together. Keep multi-line textareas and content tiles at their natural content height. Measure composed controls at their outer boundary; their inset segments/clear actions must fit inside it. The optional `scripts/button-rows.mjs` ego-browser audit compares visible row controls within a 4px center tolerance and flags height differences over 1px.
- Never use the browser's `alert`, `confirm` or `prompt` (lint enforces `no-alert`). Ask for confirmation with `await ask(message)` from `app/src/components/ui.tsx`, which renders an in-app dialog.
- Route user-visible strings through `t()`. Do not evaluate translated text at module initialization. Keep source strings in English and Simplified Chinese, preserve placeholders and update the other supported locales.
- Check affected UI in English and Simplified Chinese, at desktop and 390px widths, and in light and dark themes. Check empty, loading and error states where the change affects them. For financial displays, include zero, negative and incomplete-data cases where meaningful.
- Reproduce the user's actual interaction: saving and reloading, switching currencies, navigating, keyboard use or opening a narrow layout. Type checking and screenshots alone do not prove those interactions.

## Tests

- Test observable behavior using realistic records and serialized inputs, including missing optional fields and older data shapes. Avoid tests that repeat the implementation or pin incidental markup.
- For a logic regression, the test should fail against the old behavior and pass with the fix. Use a separate temporary copy or another reversible method to establish that without overwriting unrelated work.
- Keep automated tests independent of live exchange-rate services, notification endpoints and AI providers. Supply explicit dates and time zones for billing tests; await observable state instead of fixed sleeps for UI checks.
- Stop any test server or process started by the task. Keep test storage separate from an existing development database and any shared instance.
- If a relevant check fails, investigate and report it. An unchanged failure is not a pass; do not silently relabel it as a flaky test or claim coverage from a run with no tests.

## Verification

Use the existing commands in [package.json](../package.json). Run checks appropriate to the risk, and avoid repeating an unchanged passing build without a reason.

| Change                                 | Evidence to collect                                                                                                                                                     |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Documentation                          | Format, local links, referenced commands and agreement with source.                                                                                                     |
| Billing, phases, metrics, FX or people | Affected `shared/*.test.ts` tests and TypeScript checks; cover the relevant boundary dates, currencies and missing-data cases.                                          |
| UI behavior or styles                  | TypeScript, lint and browser interaction checks for affected languages, widths and themes. Report the viewport and actions checked.                                     |
| API, auth, MCP, masking or backup      | Requests through the real Worker path in isolated storage; affected permission, failure and compatibility cases, plus available domain tests.                           |
| Docker or deployment                   | Configuration validation, then build/start/health/persistence checks when runtime behavior changes. Verify published artifacts separately if publication is authorized. |

Before a code PR is ready, run `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run i18n:check`, `npm test` and `npm run build`, or identify the checks that could not run and why. The current automated suite is Node's test runner over `shared/*.test.ts` and `scripts/*.test.mjs`; it does not establish browser or Worker integration coverage by itself.

## Describe and review a change

For each affected subsystem, state the trigger and observable before/after behavior. Include changes to stored state, permissions, compatibility and failures where relevant, link the owning architecture section, and record the commands and runtime checks used. A refactor may explicitly state that the documented behavior is preserved.

Review against the actual base and head, following callers and derived state beyond the changed lines. Check that regression evidence exercises the claimed behavior and that links still resolve. If the head changes, reassess the affected evidence before merging. Keep unrun checks and unverified delivery steps explicit.
