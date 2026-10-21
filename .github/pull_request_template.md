## What & why

Describe the trigger and observable before/after behavior. Link the affected architecture section and note changes to data, permissions, compatibility or failure behavior; say when a refactor preserves them.

## Verification

List commands and runtime checks, their results and anything not run. For a logic fix, identify the regression case that fails without the change.

## Checklist

- [ ] `npm run typecheck && npm run lint && npm run format:check && npm run i18n:check && npm test && npm run build`
- [ ] New strings added to `en` and `zh-CN` (other locales drafted or listed as missing)
- [ ] Checked mobile and desktop, light and dark (UI changes)
- [ ] Old data still works / backup round-trips (data model changes)
- [ ] Affected architecture contracts updated, or confirmed unchanged
