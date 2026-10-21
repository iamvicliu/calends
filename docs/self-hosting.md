# Self-hosting Calends

[← README](../README.md) · [简体中文](self-hosting.zh-CN.md)

Start with the [Cloudflare or Docker quick start](../README.md#quick-start). This guide covers configuration and deployment options beyond the first launch.

## Docker from source

The repository includes a [Dockerfile](../docker/Dockerfile) and [Compose configuration](../docker/docker-compose.yml). From a source checkout:

```bash
cd docker
docker compose up -d --build
docker compose logs calends
```

Compose builds `calends:local`, starts the service on port 8787 and mounts the named volume `calends_calends-data` at `/data`. Open `http://localhost:8787/admin` and use the setup token from the logs. To update after obtaining newer source, run `docker compose up -d --build` in `docker/` again. `docker compose down` preserves the volume; `docker compose down -v` deletes the ledger volume.

To build and run without Compose, from the repository root:

```bash
docker build -f docker/Dockerfile -t calends:local .
docker run -d --name calends --restart unless-stopped -p 8787:8787 \
  -v calends-data:/data calends:local
docker logs calends
```

Choose one method for an installation: Compose uses the volume `calends_calends-data`, while the `docker run` example uses `calends-data`.

The image builds the frontend, then runs the same Worker through Wrangler's local workerd runtime with SQLite. The entrypoint applies migrations and triggers scheduled work every 15 minutes, matching the Cloudflare cron. No Cloudflare account is required. Persist all of `/data`, which includes the database state and generated setup token. The frontend is built without personal files from `local/`.

### Image registries

Dockerfile builds do not require publishing the Calends image to any registry. They still download base images and build dependencies. Docker Hub and GitHub Container Registry (GHCR) are alternative distribution services, not prerequisites for running the source build.

[The image workflow](../.github/workflows/docker.yml) is configured to build `linux/amd64` and `linux/arm64` and push to `ghcr.io/<owner>/<repository>` on main-branch pushes and version tags. Docker Hub publishing is optional and requires both `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` repository secrets; its target is `<username>/calends`.

The workflow file alone does not establish that an image has been uploaded. Before documenting a prebuilt image as ready to use, verify a successful publishing run, the registry tag/digest and anonymous pull access. The source-build instructions above work independently of a published Calends image.

## Configuration

For Cloudflare, set variables and bindings in your Wrangler configuration and use secrets for credentials. For Docker, pass supported environment variables with `-e` or through Compose.

| Setting                                | Cloudflare                  | Docker                                   | Purpose                                                                                                                                                  |
| -------------------------------------- | --------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SETUP_TOKEN`                          | Secret                      | Environment variable; generated if unset | Used to set the owner password on a fresh install.                                                                                                       |
| `SITE_URL`                             | Variable                    | Environment variable                     | Public URL used in reminders and calendar links; auto-detected if unset.                                                                                 |
| `TRUST_PROXY`                          | Variable                    | Environment variable                     | Set to `1` behind a trusted reverse proxy so login rate limiting uses the visitor's forwarded IP.                                                        |
| `EMAIL`, `MAIL_FROM`, `MAIL_FROM_NAME` | Email binding and variables | Not configured by the image entrypoint   | Optional email delivery; see below. Other notification channels are configured in the app.                                                               |
| `OLD_HOSTS`                            | Variable                    | Not forwarded by the image entrypoint    | Comma-separated old domains. With `SITE_URL` set, pages on these hosts redirect there with HTTP 301; API, MCP and calendar feeds remain accessible.      |
| `BASE_PATH`                            | Variable                    | Build argument and environment variable  | Optional subpath without a trailing slash, e.g. `/calends`. Use the same value at build time and runtime; see [subpath deployment](#subpath-deployment). |
| `DATA_DIR`                             | —                           | Environment variable                     | SQLite data directory; default `/data`. Persist this directory in a volume.                                                                              |
| `PORT`                                 | —                           | Environment variable                     | Listening port; default `8787`.                                                                                                                          |

### Personal Cloudflare configuration

Keep deployment-specific settings in the git-ignored `local/` directory:

- `local/wrangler.jsonc`: your domain, database ID, sender address and other Wrangler settings. The npm scripts select this file automatically when it exists.
- `local/public/`: your own icons and other static assets. Files here override matching files in `app/public/` at build time.

When managing secrets for a deployment that uses `local/wrangler.jsonc`, use the same wrapper as the npm scripts:

```bash
node scripts/wrangler.mjs secret put SETUP_TOKEN
```

### Custom domains and HTTPS

For Cloudflare, add your domain to the active Wrangler configuration before deploying:

```jsonc
"routes": [{ "pattern": "calends.example.com", "custom_domain": true }],
"vars": { "SITE_URL": "https://calends.example.com" }
```

Merge `SITE_URL` into any existing `vars` object. For Docker, put the service behind Caddy, Nginx or Traefik with HTTPS, set `SITE_URL` to the external URL and set `TRUST_PROXY=1`. Passkeys require a secure context, so use HTTPS for public access.

### Email reminders

Cloudflare deployments can send email through the `EMAIL` binding. The repository's `wrangler.jsonc` contains commented examples for `send_email`, `MAIL_FROM` and `MAIL_FROM_NAME`; enable these with a verified sender. Then configure the notification channel in the app.

Telegram, Lark/Feishu, DingTalk, WeCom, Slack, Discord, Bark, ntfy, ServerChan and custom webhooks need no additional server configuration.

## Deploy with an AI agent

Copy this prompt into Claude Code, Codex, Cursor or another coding agent with terminal access:

```text
Deploy Calends (https://github.com/imetn/calends), a self-hosted subscription ledger, for me.
Read the README and docs/self-hosting.md first.
1. Ask whether I want Cloudflare Workers or Docker, and whether I have a custom domain.
2. Cloudflare: clone the repo, run npm ci, verify Wrangler login, generate a random SETUP_TOKEN,
   set it with node scripts/wrangler.mjs secret put SETUP_TOKEN, then run npm run deploy.
   Configure my custom domain in the active Wrangler configuration before deploying, if requested.
3. Docker: from the source checkout's docker/ directory, run docker compose up -d --build,
   then read the setup token with docker compose logs calends. Keep the /data volume persistent.
   For public access, configure HTTPS with my chosen proxy.
4. Verify the /admin URL is reachable. Give me the URL and setup token, then explain how to
   add a passkey and connect an assistant from the AI access page.
```

## Subpath deployment

To serve Calends under a path such as `https://example.com/calends/`, build and run with the same `BASE_PATH`, and make the reverse proxy keep the prefix when forwarding:

```bash
docker build -f docker/Dockerfile --build-arg BASE_PATH=/calends -t calends:local .
docker run -d --name calends -p 8787:8787 -v calends-data:/data \
  -e BASE_PATH=/calends -e SITE_URL=https://example.com/calends -e TRUST_PROXY=1 calends:local
```

Open `https://example.com/calends/admin`. For Cloudflare, set `BASE_PATH` in the environment when running `npm run deploy` and in the Worker's `vars`.
