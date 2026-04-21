import { addImportsDir, defineNuxtModule, createResolver } from '@nuxt/kit'

import type {} from './runtime/nitro-preset/hooks'

export type ModuleOptions = object

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: 'nuxt-jit-prerender'
  },
  defaults: {},
  setup(_options, nuxt) {
    const resolver = createResolver(import.meta.url)

    // Enable payload extraction
    nuxt.options.experimental.payloadExtraction = true

    // Use custom nitro preset that will generate static files on demand
    nuxt.options.nitro.preset = resolver.resolve('./runtime/nitro-preset')

    // Add runtime composables
    addImportsDir(resolver.resolve('./runtime/app/composables'))

    // Register Nitro hook type augmentation so consumers get autocomplete
    // for jit-prerender:* hooks in nitroApp.hooks.hook()
    nuxt.hook('prepare:types', ({ references }) => {
      references.push({ path: resolver.resolve('./runtime/nitro-preset/hooks') })
    })
  }
})
