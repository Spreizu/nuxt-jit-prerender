import { useStorage } from 'nitropack/runtime'

/**
 * Parse a comma-separated list into an array of decoded strings.
 * @param value - The raw comma-separated string
 * @returns string[] - The array of parsed strings
 */
export function parseCommaSeparatedList(value: string | null | undefined): string[] {
  if (!value) return []
  return value
    .split(',')
    .map((i) => decodeURIComponent(i.trim()))
    .filter(Boolean)
}

const payloadCache = useStorage('cache:nuxt:payload')

/**
 * Clear the Nuxt payload cache entry for a given route.
 *
 * Nuxt's SSR renderer caches `_payload.json` responses in an internal storage
 * (`cache:nuxt:payload`). When serving payload routes through `localFetch`,
 * the cached entry is returned instead of re-rendering. This function removes
 * the cached entry so the next `localFetch` triggers a fresh SSR render.
 */
export async function clearPayloadCache(route: string): Promise<void> {
  await payloadCache.removeItem(route).catch(() => {})
}
