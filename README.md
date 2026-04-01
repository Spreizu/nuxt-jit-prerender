# Nuxt JIT Prerender

<!-- [![npm version][npm-version-src]][npm-version-href] -->
<!-- [![npm downloads][npm-downloads-src]][npm-downloads-href] -->
[![License][license-src]][license-href]
[![Nuxt][nuxt-src]][nuxt-href]

A Nuxt 4 module that replaces the standard Nitro SSG preset with a **custom runtime that pre-renders pages on demand** via a lightweight HTTP API. Instead of generating all static files at build time, pages are rendered and written to disk at runtime by calling a REST endpoint — enabling JIT (just-in-time) pre-rendering.

> **⚠️ WARNING: This repository is under heavy development and is not meant to be used yet.**

<!-- - [✨ &nbsp;Release Notes](/CHANGELOG.md) -->
<!-- - [🏀 Online playground](https://stackblitz.com/github/your-org/my-module?file=playground%2Fapp.vue) -->
<!-- - [📖 &nbsp;Documentation](https://example.com) -->

## How It Works

When added as a Nuxt module, `nuxt-jit-prerender`:

1. **Injects a custom Nitro preset** (`src/nitro-preset`) that extends the standard `node-server` preset.
2. **Replaces the default server entry** with a minimal Node.js HTTP server exposing two API endpoints.
3. **Renders pages on demand** by calling Nitro's internal `localFetch` and writing the HTML (and payload JSON) to `.output/public`.

Routes are processed in configurable-concurrency batches. Any additional routes discovered via the `x-nitro-prerender` response header (e.g. `_payload.json`) are automatically queued and rendered too.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/health` | Health check — returns `{ status: "ok", timestamp }` |
| `POST` | `/api/generate` | Pre-render a list of routes and write them to disk |

### `POST /api/generate`

**Request body:**
```json
{
  "routes": ["/", "/about", "/blog/hello-world"]
}
```

**Response:**
```json
{
  "success": true,
  "summary": {
    "requested": 3,
    "generated": 3,
    "discovered": 3,
    "total": 6
  },
  "results": [
    { "route": "/", "success": true, "cacheTags": [], "discoveredRoutes": ["/_payload.json"] },
    ...
  ]
}
```

## Features

- ⚡ **JIT Pre-rendering** — Render pages at runtime, not at build time
- 🔄 **Auto-discovery** — Automatically follows the `x-nitro-prerender` response header to render linked assets
- 📦 **Payload extraction** — Co-renders `_payload.json` alongside each HTML page for SPA hydration
- 🏎️ **Concurrent batch processing** — Configurable concurrency for parallel route generation
- 🏷️ **Cache tag support** — Pages can declare cache tags via `x-jit-prerender-cache-tags` header (WIP)
- 🏥 **Health check endpoint** — Built-in liveness probe at `GET /api/health`
- 🪵 **Structured logging** — Request-scoped logging with `consola`; emits JSON logs in CI environments

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` / `NITRO_PORT` | `3000` | Port the HTTP server listens on |
| `HOST` / `NITRO_HOST` | `0.0.0.0` | Host the HTTP server binds to |
| `NITRO_JIT_PRERENDER_CONCURRENCY` | `10` | Max routes rendered in parallel per batch |
| `NITRO_JIT_PRERENDER_OUTPUT_DIR` | `.output/public` | Directory where static files are written |
| `NITRO_JIT_PRERENDER_CI` | — | Set to `"true"` for structured JSON log output |

## Quick Setup

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['nuxt-jit-prerender']
})
```

After building your app (`nuxi build`), start the server and trigger pre-rendering via the API:

```bash
# Start the pre-render server
NITRO_JIT_PRERENDER_OUTPUT_DIR=./.output/public node .output/server/index.mjs

# Trigger pre-rendering for specific routes
curl -X POST http://localhost:3000/api/generate \
  -H 'Content-Type: application/json' \
  -d '{"routes": ["/", "/about"]}'
```

## Contribution

<details>
  <summary>Local development</summary>

  ```bash
  # Install dependencies
  pnpm install

  # Generate type stubs and prepare the playground
  pnpm dev:prepare

  # Develop with the playground
  pnpm dev

  # Build the playground
  pnpm dev:build

  # Start the pre-render server against the built playground
  pnpm run-server

  # Lint
  pnpm lint

  # Run tests
  pnpm test
  pnpm test:watch

  # Type-check
  pnpm test:types

  # Release a new version
  pnpm release
  ```

</details>


<!-- Badges -->
[npm-version-src]: https://img.shields.io/npm/v/nuxt-jit-prerender/latest.svg?style=flat&colorA=020420&colorB=00DC82
[npm-version-href]: https://npmjs.com/package/nuxt-jit-prerender

[npm-downloads-src]: https://img.shields.io/npm/dm/nuxt-jit-prerender.svg?style=flat&colorA=020420&colorB=00DC82
[npm-downloads-href]: https://npm.chart.dev/nuxt-jit-prerender

[license-src]: https://img.shields.io/github/license/Spreizu/nuxt-jit-prerender?style=flat&colorA=020420&colorB=00DC82
[license-href]: https://github.com/Spreizu/nuxt-jit-prerender/blob/main/LICENSE

[nuxt-src]: https://img.shields.io/badge/Nuxt-020420?logo=nuxt
[nuxt-href]: https://nuxt.com
