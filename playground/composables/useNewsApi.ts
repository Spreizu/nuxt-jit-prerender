import { useCacheTags } from '#imports'

/**
 * Simulates a headless CMS client.
 * Injects global tags so any page that calls this composable
 * automatically declares a dependency on the news feed.
 */
export function useNewsApi() {
  useCacheTags(['global:news'])
  // alternative - tag each article individually:
  // useCacheTags(articles.map(article => `article:${article.id}`))

  return {
    articles: [
      { id: 1, title: 'Nuxt JIT Prerender goes v1' },
      { id: 2, title: 'Speed up your pages' },
      { id: 3, title: 'Static vs Server: Why not both?' }
    ]
  }
}
