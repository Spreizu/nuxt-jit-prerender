import { addImportsDir, defineNuxtModule, createResolver } from '@nuxt/kit'

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
    nuxt.options.nitro.preset = resolver.resolve('./nitro-preset')

    // Add runtime composables
    addImportsDir(resolver.resolve('./runtime/composables'))
  }
})
