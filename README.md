# Nuxt JIT Prerender

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![License][license-src]][license-href]
[![Nuxt][nuxt-src]][nuxt-href]

A Nuxt 4 module that replaces the standard Nitro SSG preset with a **custom runtime that pre-renders pages on demand** via a lightweight HTTP API. Instead of generating all static files at build time, pages are rendered and written to disk at runtime by calling a REST endpoint — enabling JIT (just-in-time) pre-rendering.

> **NOTE: The current implementation does not work properly behind CDNs (unless the cache is purged manually), as the build ID is not updated in the static files.**

> **⚠️ WARNING: This repository is under heavy development.**

<!-- - [✨ &nbsp;Release Notes](/CHANGELOG.md) -->
<!-- - [🏀 Online playground](https://stackblitz.com/github/your-org/my-module?file=playground%2Fapp.vue) -->
<!-- - [📖 &nbsp;Documentation](https://example.com) -->

## How It Works

When added as a Nuxt module, `nuxt-jit-prerender`:

1. **Injects a custom Nitro preset** (`src/nitro-preset`) that extends the standard `node-server` preset.
2. **Replaces the default server entry** with a minimal Node.js HTTP server exposing a REST API.
3. **Renders pages on demand** by calling Nitro's internal `localFetch` and writing the HTML (and payload JSON) to `.output/public`.
4. **Tracks dependencies** via a tag-based `CacheRegistry` persisted to `.output/.cache-manifest.json`, allowing for targeted re-renders.

Routes are processed in configurable-concurrency batches. Any additional routes discovered via the `x-nitro-prerender` response header are automatically queued and rendered too.

## API Endpoints

| Method   | Path              | Description                                                               |
| -------- | ----------------- | ------------------------------------------------------------------------- |
| `GET`    | `/api/health`     | Health check — returns `{ status: "ok", timestamp }`                      |
| `POST`   | `/api/generate`   | Pre-render a list of routes and write them to disk                        |
| `POST`   | `/api/invalidate` | Re-render routes based on their associated cache tags                     |
| `DELETE` | `/api/route`      | Purge a list of routes from the registry and delete their files from disk |

### `POST /api/generate`

Triggers on-demand generation for a specific list of routes.

**Request body:**

```json
{
  "routes": ["/", "/about"]
}
```

**Response:**

```json
{
  "success": true,
  "summary": {
    "requested": 2,
    "generated": 2,
    "discovered": 2,
    "total": 4,
    "deduped": 0
  },
  "results": [
    {
      "route": "/",
      "success": true,
      "cacheTags": ["page:index"],
      "discoveredRoutes": ["/_payload.json"]
    }
  ]
}
```

### `POST /api/invalidate`

Triggers re-generation for all routes associated with one or more tags, or for every route known to the registry.

**Request body (tag-based):**

```json
{
  "tags": ["product:123", "category:electronics"]
}
```

**Request body (all):**

```json
{
  "all": true
}
```

### `DELETE /api/route`

Permanently remove a list of routes from the cache manifest and physically delete their corresponding `.html` and `_payload.json` files from disk.

**Request body:**

```json
{
  "routes": ["/old-page", "/temporary-promo"]
}
```

**Security Guards:**

- **Path Traversal Protection**: Rejects any route that attempts to escape the public output directory using `..`.
- **`_nuxt` Protection**: Rejects any route targeting or containing the `/_nuxt` directory to prevent deletion of core assets.
- **Cleanup Safety**: When removing empty folders, the base output directory is always preserved.

## Features

- ⚡ **JIT Pre-rendering** — Render pages at runtime, not at build time
- 🏷️ **Tag-based Invalidation** — Precision re-rendering of specific pages when data changes
- 🔄 **Auto-discovery** — Automatically follows the `x-nitro-prerender` response header to render linked assets like `_payload.json`
- 📦 **Payload extraction** — Co-renders metadata alongside each HTML page for SPA hydration/navigation
- 🏎️ **Concurrent batch processing** — Configurable concurrency for parallel route generation
- 🎯 **Route-level dedup** — Concurrent requests for overlapping routes are deduplicated; generates are skipped when an invalidate is already re-rendering the same route
- 🔒 **Atomic file writes** — Static files and the cache manifest are written via temp-file + rename, preventing partial/corrupt output on crash or concurrent access
- 💾 **Persistent Registry** — Tracks route-to-tag mappings in a `.cache-manifest.json` file
- 🪝 **Lifecycle hooks** — Register `before`/`after` hooks for generate, invalidate, and delete operations via Nitro plugins
- 🏥 **Health check endpoint** — Built-in liveness probe at `GET /api/health`
- 🪵 **Structured logging** — Request-scoped logging with `consola`; emits JSON logs in CI environments

## Declaring Cache Tags

To use tag-based invalidation, your pages must be associated with one or more tags.

### Using the `useCacheTags` composable (Recommended)

In your Nuxt pages or components, use the auto-imported `useCacheTags` composable to associate the current page with specific tags.

```vue
<script setup>
// Tags can be a string or an array of strings
useCacheTags(['product:123', 'category:electronics'])
</script>
```

### Manual Header (Advanced)

If you are not using the composable (e.g., in a Nitro server route or plugin), you can manually set or append the `x-jit-prerender-cache-tags` header.

```ts
// server/plugins/cache-tags.ts
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('render:response', (response, { event }) => {
    if (event.path.startsWith('/products/')) {
      appendHeader(event, 'x-jit-prerender-cache-tags', 'all-products, product:123')
    }
  })
})
```

## Lifecycle Hooks

Register hooks to run before or after generate, invalidate, and delete operations. Hooks are registered via Nitro plugins using `nitroApp.hooks.hook()`.

### Available Hooks

| Hook                             | Context                                                      | Mutability                                  |
| -------------------------------- | ------------------------------------------------------------ | ------------------------------------------- |
| `jit-prerender:beforeGenerate`   | `{ routes: string[] }`                                       | Mutable — add/remove/filter routes          |
| `jit-prerender:afterGenerate`    | `{ routes, results, totalGenerated, totalDiscovered }`       | Read-only                                   |
| `jit-prerender:beforeInvalidate` | `{ tags: string[] \| null, all: boolean, routes: string[] }` | Mutable — add/remove/filter routes          |
| `jit-prerender:afterInvalidate`  | `{ tags, all, routes, results, failed }`                     | Read-only                                   |
| `jit-prerender:beforeDelete`     | `{ routes: string[] }`                                       | Mutable — filter routes to prevent deletion |
| `jit-prerender:afterDelete`      | `{ routes: string[] }`                                       | Read-only                                   |

- **Before-hooks** receive a mutable `routes` array — push, splice, or replace it to change what gets processed.
- **After-hooks** receive a read-only snapshot — use them for logging, metrics, or webhooks.
- All hooks are async. Hook errors are caught and logged; they never abort the operation.

### Usage

```ts
// server/plugins/jit-prerender-hooks.ts
export default defineNitroPlugin((nitroApp) => {
  // Add extra routes before generation
  nitroApp.hooks.hook('jit-prerender:beforeGenerate', (ctx) => {
    if (ctx.routes.includes('/')) {
      ctx.routes.push('/sitemap.xml')
    }
  })

  // Send metrics after generation
  nitroApp.hooks.hook('jit-prerender:afterGenerate', (ctx) => {
    console.log(`Generated ${ctx.totalGenerated} routes`)
  })

  // Protect routes from deletion
  nitroApp.hooks.hook('jit-prerender:beforeDelete', (ctx) => {
    ctx.routes = ctx.routes.filter((r) => !['/about', '/contact'].includes(r))
  })

  // Webhook notification after invalidation
  nitroApp.hooks.hook('jit-prerender:afterInvalidate', async (ctx) => {
    await fetch('https://example.com/webhook', {
      method: 'POST',
      body: JSON.stringify({ event: 'invalidated', routes: ctx.routes })
    })
  })
})
```

## Environment Variables

| Variable                         | Default   | Description                                                                                        |
| -------------------------------- | --------- | -------------------------------------------------------------------------------------------------- |
| `PORT`                           | `3000`    | Port the HTTP server listens on                                                                    |
| `HOST`                           | `0.0.0.0` | Host the HTTP server binds to                                                                      |
| `NUXT_JIT_PRERENDER_CONCURRENCY` | `10`      | Max routes rendered in parallel per batch                                                          |
| `NUXT_JIT_PRERENDER_OUTPUT_DIR`  | `.output` | Root directory for output (contains `/server`, `/public`, `nitro.json` and `.cache-manifest.json`) |
| `NUXT_JIT_PRERENDER_CI`          | —         | Set to `"true"` for structured JSON log output                                                     |

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
node .output/server/index.mjs

# Trigger pre-rendering for specific routes
curl -X POST http://localhost:3000/api/generate \
  -H 'Content-Type: application/json' \
  -d '{"routes": ["/", "/about"]}'

# Invalidate a specific product tag
curl -X POST http://localhost:3000/api/invalidate \
  -H 'Content-Type: application/json' \
  -d '{"tags": ["product:123"]}'

# Permanently delete a route from disk and registry
curl -X DELETE http://localhost:3000/api/route \
  -H 'Content-Type: application/json' \
  -d '{"routes": ["/old-page"]}'
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
pnpm dev:server

# Lint
pnpm lint

# Run tests
pnpm test
pnpm test:watch

# Type-check
pnpm test:types
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
