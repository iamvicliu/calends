# AI access

Everything that lets an AI read or change the ledger lives here. The MCP server and the built-in assistant share one set of tools, so a capability added once works in Claude Code, Codex, Cursor and the in-app assistant alike.

| File           | Role                                                                                                                                                                                                                                               |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mcp.ts`       | MCP server at `/mcp`: Streamable HTTP in stateless mode (each POST is one JSON-RPC request, plain JSON response, no SSE or sessions). Bearer tokens are created on the AI access page, stored as SHA-256 only, and scoped read-only or read-write. |
| `mcp-tools.ts` | The tool catalogue: names, English descriptions, JSON schemas, permissions and handlers.                                                                                                                                                           |
| `assistant.ts` | Built-in assistant: streams a DeepSeek-compatible chat, calls the same tools, and turns every write into a draft the user confirms first. Request/response helpers shared with the browser are in `shared/deepseek.ts`.                            |

## Tools

- **Read**: `get_overview`, `list_categories`, `list_subscriptions`, `get_subscription`, `list_charges`, `spending_stats`, `get_trends`, `list_payment_methods`, `list_people`, `get_receivables`, `get_insights`, `list_events`, `get_carpool`, `search_app_store`.
- **Write**: `create_subscription`, `update_subscription`, `change_price`, `change_plan`, `set_status`, `record_payment`, `delete_payment`, `delete_subscription`, `set_share`, `save_share_member`, `remove_share_member`, `record_receivable`, `update_payment_method`.

Write tools are hidden from read-only tokens and rejected if called anyway. Most accept `dry_run: true`, which returns a preview without saving; the assistant always uses it before asking for confirmation. MCP clients with a read-write token write directly unless they pass `dry_run`.

## Adding or changing a tool

1. Define it in `mcp-tools.ts`: a clear English description (it is the model's only documentation), a strict schema, `write`/`destructive`/`idempotent` flags, and a `dry_run` preview for writes.
2. Validate inputs with the shared helpers and throw errors with `t('mcp.error.*')`. Add new error keys to all 14 locales in `shared/locales/<lang>/mcp.json`.
3. Reuse domain logic from `shared/` (billing, phases, carpool, metrics) instead of re-implementing it, so the app, the MCP server and the assistant agree.
4. Add tests under `shared/*.test.ts`, run `npm run i18n:check` and `npm test`, and update the MCP page in the documentation site.
