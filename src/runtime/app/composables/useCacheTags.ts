/**
 * Composable to declare cache tags for the current page.
 * These tags are used by the cache registry to know which pages
 * need to be regenerated when content changes.
 *
 * Usage:
 *   useCacheTags(['article:42', 'articles:list'])
 *   useCacheTags('article:42')
 */
import { getResponseHeader, setResponseHeader } from 'h3'
import { useRequestEvent } from 'nuxt/app'

export function useCacheTags(tags: string | string[]) {
  if (!import.meta.server) return

  const tagArray = Array.isArray(tags) ? tags : [tags]
  const event = useRequestEvent()
  if (!event) return

  // Get existing tags and merge
  const existing = getResponseHeader(event, 'x-jit-prerender-cache-tags')
  const existingTags = existing
    ? String(existing)
        .split(',')
        .map((t) => decodeURIComponent(t.trim()))
        .filter(Boolean)
    : []

  const allTags = [...new Set([...existingTags, ...tagArray])]
  setResponseHeader(event, 'x-jit-prerender-cache-tags', allTags.join(','))
}
