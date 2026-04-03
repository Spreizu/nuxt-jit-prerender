import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { NitroPreset } from 'nitropack'

export default <NitroPreset>{
  extends: 'node-server',
  entry: fileURLToPath(new URL('./entry', import.meta.url)),
  serveStatic: false,
  output: {
    serverDir: join(process.env.NUXT_JIT_PRERENDER_OUTPUT_DIR || '.output', 'server')
  },
  prerender: {
    routes: [],
    crawlLinks: false
  },
  routeRules: {
    '/**': { isr: true }
  }
}
