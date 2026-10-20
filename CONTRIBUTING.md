# Contributing to Calends

Thanks for helping! Bug reports, translations and pull requests are all welcome.

## Getting started

```bash
npm ci
npm run db:migrate:local
echo "DEV_BYPASS_AUTH=1" > .dev.vars
npm run dev   # http://127.0.0.1:5173/admin
```

Before opening a PR, make sure these pass:

```bash
npm run typecheck && npm run lint && npm run format:check && npm run i18n:check && npm test && npm run build
```

## Guidelines

- **Domain logic lives in `shared/`** and must run in both the browser and the Worker (no DOM or Node APIs). Add unit tests in `shared/*.test.ts` for billing, phase or metric changes.
- **Every user-visible string goes through `t()`** (`shared/i18n.ts`). Never call `t()` at module top level. Add new keys to `en` and `zh-CN` at least; `npm run i18n:check` lists missing keys in other locales — machine-drafted translations are fine, native-speaker review is even better.
- **Stored data is forever.** Keep old records working; schema changes go in a new file under `migrations/`; backups (`worker/backup.ts`) must round-trip new data.
- **Privacy**: anything that could identify a person or account must stay out of the public page (`shared/mask.ts` allow-lists what's shared).
- Keep the UI consistent with existing components (`src/components/ui.tsx`, `Picker.tsx`) and check mobile (390px), desktop, light and dark.

## Translations

`shared/locales/<locale>/<namespace>.json`, nested JSON, `{placeholders}` must be kept. Plurals use CLDR categories: `{ "one": "...", "other": "..." }` (Russian also `few`/`many`; Chinese/Japanese/Korean/Indonesian/Vietnamese only `other`).

To add a language: copy `shared/locales/en`, translate, add it to `LOCALES` in `shared/i18n.ts`, add `src/locales/<code>.ts` (copy an existing one), then run `npm run i18n`.
