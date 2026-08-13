# Vinted MCP Server

[![npm version](https://img.shields.io/npm/v/%40andrijdavid%2Fvinted-mcp.svg)](https://www.npmjs.com/package/@andrijdavid/vinted-mcp)
[![License: AGPL v3+](https://img.shields.io/badge/License-AGPL%20v3%2B-blue.svg)](./LICENSE.md)

An MCP server for Vinted search and analysis that provides tools to search listings, fetch item details, inspect seller profiles, compare prices across countries, and surface trending items.

It also exposes resources for supported countries and category data.

**Disclaimer**: This project is not affiliated, associated, authorized, endorsed by, or in any way officially connected with Vinted, or any of its subsidiaries or its affiliates. The official Vinted website can be found at [vinted.com](https://www.vinted.com).

## Client support

This server works with MCP clients that support local `stdio` servers.

Popular clients and setup docs:

- Claude Desktop (local): https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop
- Claude Desktop (remote): https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp
- ChatGPT (MCP developer mode): https://platform.openai.com/docs/guides/developer-mode
- ChatGPT (MCP and connectors): https://platform.openai.com/docs/guides/tools-remote-mcp
- Cursor: https://docs.cursor.com/context/model-context-protocol
- Windsurf: https://docs.windsurf.com/windsurf/cascade/mcp
- Cline: https://docs.cline.bot/mcp/configuring-mcp-servers
- Full MCP client directory: https://modelcontextprotocol.io/clients

## Quick start

### Option 1: npx

Add this to your MCP client config:

```json
{
  "mcpServers": {
    "vinted": {
      "command": "npx",
      "args": ["-y", "@andrijdavid/vinted-mcp"]
    }
  }
}
```

### Option 1b: bunx (canary)

```bash
bunx @andrijdavid/vinted-mcp@next
```

This starts the server in `stdio` mode and waits for an MCP client.

### Option 2: global install

```bash
npm install -g @andrijdavid/vinted-mcp
```

Then configure:

```json
{
  "mcpServers": {
    "vinted": {
      "command": "vinted-mcp"
    }
  }
}
```

### Run in network mode (Streamable HTTP over TCP)

If you need a network endpoint instead of stdio, run:

```bash
VINTED_MCP_TRANSPORT=http VINTED_MCP_HOST=127.0.0.1 VINTED_MCP_PORT=3001 bunx @andrijdavid/vinted-mcp@next
```

Optional:

- `VINTED_MCP_PATH` (default `/mcp`)
- `VINTED_MCP_ENABLE_LEGACY_SSE` (default `true`)
- `VINTED_MCP_LEGACY_SSE_PATH` (default `/sse`)
- `VINTED_MCP_LEGACY_MESSAGES_PATH` (default `/messages`)

Default endpoints:

- Streamable HTTP (recommended): `http://127.0.0.1:3001/mcp`
- Legacy SSE (older clients): `http://127.0.0.1:3001/sse`

## CLI usage and env variables

### Pass env vars inline (macOS/Linux)

```bash
VINTED_AUTH_MODE=env \
VINTED_AUTH_COOKIES='session_cookie=your_value; other_cookie=your_value' \
VINTED_AUTH_CSRF_TOKEN='your_csrf_token' \
bunx @andrijdavid/vinted-mcp@next
```

### Pass env vars inline (PowerShell)

```powershell
$env:VINTED_AUTH_MODE = "env"
$env:VINTED_AUTH_COOKIES = "session_cookie=your_value; other_cookie=your_value"
$env:VINTED_AUTH_CSRF_TOKEN = "your_csrf_token"
bunx @andrijdavid/vinted-mcp@next
```

### Pass env vars inline (Windows Command Prompt)

```bat
set VINTED_AUTH_MODE=env
set VINTED_AUTH_COOKIES=session_cookie=your_value; other_cookie=your_value
set VINTED_AUTH_CSRF_TOKEN=your_csrf_token
bunx @andrijdavid/vinted-mcp@next
```

### Use a local `.env` file

The server auto-loads `.env` from the current working directory.

```bash
cp .env.example .env
bunx @andrijdavid/vinted-mcp@next
```

### Run network mode from CLI with env

```bash
VINTED_MCP_TRANSPORT=http \
VINTED_MCP_HOST=127.0.0.1 \
VINTED_MCP_PORT=3001 \
bunx @andrijdavid/vinted-mcp@next
```

Windows Command Prompt:

```bat
set VINTED_MCP_TRANSPORT=http
set VINTED_MCP_HOST=127.0.0.1
set VINTED_MCP_PORT=3001
bunx @andrijdavid/vinted-mcp@next
```

## Authentication and environment

The server auto-loads `.env` from the working directory if present.

Start from the example file:

```bash
cp .env.example .env
```

Main variables:

- `VINTED_AUTH_MODE`: `http`, `playwright`, or `env`
- `VINTED_AUTH_COOKIES`: cookie header string or JSON object string
- `VINTED_AUTH_CSRF_TOKEN`: CSRF token
- `VINTED_AUTH_ACCESS_TOKEN`: optional bearer token
- `VINTED_AUTH_REFRESH_TOKEN`: optional refresh token, used to mint a new access token
- `VINTED_PROFILE_DIR`: optional root for browser profiles created by `login`, default `~/.vinted-mcp`
- `VINTED_PROXY_URL`: optional proxy URL
- `VINTED_MAX_CONCURRENCY`: optional tuning
- `VINTED_REQUEST_DELAY_MS`: optional tuning
- `VINTED_MAX_RETRIES`: optional tuning

Example client config with env auth:

```json
{
  "mcpServers": {
    "vinted": {
      "command": "npx",
      "args": ["-y", "@andrijdavid/vinted-mcp"],
      "env": {
        "VINTED_AUTH_MODE": "env",
        "VINTED_AUTH_COOKIES": "session_cookie=your_value; other_cookie=your_value",
        "VINTED_AUTH_CSRF_TOKEN": "your_csrf_token"
      }
    }
  }
}
```

## Signing in

Search and price tools work anonymously. Anything tied to your account (`like_item`) needs a
logged-in session. Run this once per country:

```bash
npx @andrijdavid/vinted-mcp login --country fr
```

A browser window opens on Vinted. Sign in the way you normally do (password, captcha, 2FA, Google
login all work). The window closes by itself once you are signed in, and the browser profile is
saved to `~/.vinted-mcp/profile-<country>`. The server reopens that profile headlessly when it needs
cookies, so the session refreshes itself and there is nothing to copy or paste.

Requirements: Playwright with Chromium (`npm i playwright && npx playwright install chromium`).
Set `VINTED_PROFILE_DIR` to move the profile root somewhere other than `~/.vinted-mcp`.

### Manual cookies (headless servers and CI)

Where no browser can be opened, use `VINTED_AUTH_MODE=env` and supply the credentials yourself:

1. Sign in to Vinted in your browser.
2. Open Developer Tools.
3. Open `Network` and refresh.
4. Open any `https://www.vinted.<country>/api/...` request.
5. Copy from `Request Headers`:
   - `cookie` -> `VINTED_AUTH_COOKIES`
   - `x-csrf-token` -> `VINTED_AUTH_CSRF_TOKEN`
6. Optional: copy `authorization: Bearer ...` token into `VINTED_AUTH_ACCESS_TOKEN`, and the
   `refresh_token_web` cookie value into `VINTED_AUTH_REFRESH_TOKEN`.

Security notes:

- treat these values as secrets
- never commit `.env`
- rotate tokens/cookies if exposed
- the saved browser profile holds a live session; it is stored with owner-only permissions

## Tools

### `search_items`

Search listings with filters like country, price range, brand IDs, category, condition, sort, and limit.

### `get_item`

Get item details by `itemId` or `url`.

### `get_seller`

Get seller profile data and optional recent items by `sellerId` or `url`.

### `compare_prices`

Compare average and median prices for a query across countries.

### `get_trending`

Return trending items by engagement score.

### `like_item`

Add an item to your favourites by `itemId` or `url`, or remove it with `unlike: true`. Needs a
logged-in session, see [Signing in](#signing-in). Already-liked items are left alone rather than
toggled off.

## Resources

- `vinted://countries`
- `vinted://categories`

### Resource templates

- `vinted://item/{country}/{itemId}`
- `vinted://seller/{country}/{sellerId}`
- `vinted://search/{country}/{query}`

These templates let clients create direct resource URIs quickly.

## Prompt templates

- `find_best_deal`
- `screen_seller`
- `search_item_with_filters`
- `trending_report`
- `buy_or_skip_decision`
- `resale_arbitrage_estimator`

These predefined prompts help clients bootstrap common Vinted workflows.

Supported countries: `fr`, `de`, `uk`, `it`, `es`, `nl`, `pl`, `pt`, `be`, `at`, `lt`, `cz`, `sk`, `hu`, `ro`, `hr`, `fi`, `dk`, `se`.

## Local development

```bash
npm install
npm run build
npm run bundle
npm start
```

## Testing

Run protocol-level tests:

```bash
npm test
```

Run live integration tests:

```bash
RUN_LIVE_MCP_TESTS=1 npm test
```

## License

Licensed under `AGPL-3.0-or-later`.

See `LICENSE.md`.
