# Nuxt Runtime Static Site Generation

<!-- [![npm version][npm-version-src]][npm-version-href] -->
<!-- [![npm downloads][npm-downloads-src]][npm-downloads-href] -->
[![License][license-src]][license-href]
[![Nuxt][nuxt-src]][nuxt-href]

A lightweight Nuxt 4 module for **REST API-based static site generation** that enables incremental and full SSG entirely through HTTP endpoints.

<span style="color:yellow">**WARNING: This repository is under heavy development and is not meant to be used yet.**</span>

<!-- - [✨ &nbsp;Release Notes](/CHANGELOG.md) -->
<!-- - [🏀 Online playground](https://stackblitz.com/github/your-org/my-module?file=playground%2Fapp.vue) -->
<!-- - [📖 &nbsp;Documentation](https://example.com) -->

## Features

- 🚀 **REST API-Based Generation** - Generate static pages entirely via HTTP endpoints
- ⚡ **Lightweight Runtime** - Uses Node.js HTTP server
- 🔄 **Incremental Static Regeneration (ISR)** - Update pages incrementally without full rebuild
- 📦 **Full SSG Support** - Generate complete static sites via API calls
- 📊 **Batch Processing** - Generate multiple pages simultaneously through API
- 💻 **Programmatic API** - Use in Node.js scripts and applications via HTTP
- 🏥 **Health Monitoring** - Built-in health checks via API endpoints

## Quick Setup

N/A

## Contribution

<details>
  <summary>Local development</summary>
  
  ```bash
  # Install dependencies
  npm install
  
  # Generate type stubs
  npm run dev:prepare
  
  # Develop with the playground
  npm run dev
  
  # Build the playground
  npm run dev:build
  
  # Run ESLint
  npm run lint
  
  # Run Vitest
  npm run test
  npm run test:watch
  
  # Release new version
  npm run release
  ```

</details>


<!-- Badges -->
[npm-version-src]: https://img.shields.io/npm/v/my-module/latest.svg?style=flat&colorA=020420&colorB=00DC82
[npm-version-href]: https://npmjs.com/package/my-module

[npm-downloads-src]: https://img.shields.io/npm/dm/my-module.svg?style=flat&colorA=020420&colorB=00DC82
[npm-downloads-href]: https://npm.chart.dev/my-module

[license-src]: https://img.shields.io/github/license/Spreizu/nuxt-runtime-ssg?style=flat&colorA=020420&colorB=00DC82
[license-href]: https://npmjs.com/package/my-module

[nuxt-src]: https://img.shields.io/badge/Nuxt-020420?logo=nuxt
[nuxt-href]: https://nuxt.com
