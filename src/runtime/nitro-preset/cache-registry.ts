import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

import { logger } from './logger'

/**
 * Tag-based cache registry.
 *
 * Tracks bidirectional mappings between routes and content tags:
 *   tag   → Set<route>   (which routes depend on this tag)
 *   route → Set<tag>     (which tags this route depends on)
 *
 * Persisted to a JSON file for durability across restarts.
 */
export class CacheRegistry {
  /** tag → routes that depend on it */
  private tagToRoutes = new Map<string, Set<string>>()
  /** route → tags it depends on */
  private routeToTags = new Map<string, Set<string>>()
  /** File path for persistence */
  private persistPath: string
  private saveTimer: ReturnType<typeof setTimeout> | null = null

  constructor(persistPath: string) {
    this.persistPath = persistPath
  }

  /**
   * Register a route's dependency on a set of tags.
   * Replaces any existing tags for the route.
   */
  register(route: string, tags: string[]): void {
    // Remove old associations for this route
    this.removeRoute(route)

    if (tags.length === 0) return

    // Create new associations
    const tagSet = new Set(tags)
    this.routeToTags.set(route, tagSet)

    for (const tag of tags) {
      let routes = this.tagToRoutes.get(tag)
      if (!routes) {
        routes = new Set()
        this.tagToRoutes.set(tag, routes)
      }
      routes.add(route)
    }

    this.scheduleSave()
  }

  /**
   * Get all routes that depend on any of the given tags.
   */
  getRoutesForTags(tags: string[]): string[] {
    const routes = new Set<string>()
    for (const tag of tags) {
      const tagRoutes = this.tagToRoutes.get(tag)
      if (tagRoutes) {
        for (const route of tagRoutes) {
          routes.add(route)
        }
      }
    }
    return [...routes]
  }

  /**
   * Get all tags that a route depends on.
   */
  getTagsForRoute(route: string): string[] {
    return [...(this.routeToTags.get(route) || [])]
  }

  /**
   * Remove a route and all its tag associations.
   */
  removeRoute(route: string): void {
    const tags = this.routeToTags.get(route)
    if (tags) {
      for (const tag of tags) {
        const routes = this.tagToRoutes.get(tag)
        if (routes) {
          routes.delete(route)
          if (routes.size === 0) {
            this.tagToRoutes.delete(tag)
          }
        }
      }
      this.routeToTags.delete(route)
      this.scheduleSave()
    }
  }

  /**
   * Remove multiple routes.
   */
  removeRoutes(routes: string[]): void {
    for (const route of routes) {
      this.removeRoute(route)
    }
  }

  /**
   * Get every route currently tracked in the registry.
   */
  getAllRoutes(): string[] {
    return [...this.routeToTags.keys()]
  }

  /**
   * Get the full cache manifest for debugging.
   */
  toJson(): {
    tagToRoutes: Record<string, string[]>
    routeToTags: Record<string, string[]>
    stats: { totalRoutes: number; totalTags: number }
  } {
    const tagToRoutes: Record<string, string[]> = {}
    for (const [tag, routes] of this.tagToRoutes) {
      tagToRoutes[tag] = [...routes]
    }

    const routeToTags: Record<string, string[]> = {}
    for (const [route, tags] of this.routeToTags) {
      routeToTags[route] = [...tags]
    }

    return {
      tagToRoutes,
      routeToTags,
      stats: {
        totalRoutes: this.routeToTags.size,
        totalTags: this.tagToRoutes.size
      }
    }
  }

  /**
   * Load the registry from its persisted JSON file.
   */
  async load(): Promise<void> {
    try {
      const content = await readFile(this.persistPath, 'utf-8')
      const data = JSON.parse(content)

      this.tagToRoutes.clear()
      this.routeToTags.clear()

      if (data.tagToRoutes) {
        for (const [tag, routes] of Object.entries(data.tagToRoutes)) {
          this.tagToRoutes.set(tag, new Set(routes as string[]))
        }
      }
      if (data.routeToTags) {
        for (const [route, tags] of Object.entries(data.routeToTags)) {
          this.routeToTags.set(route, new Set(tags as string[]))
        }
      }

      logger.info(`Loaded cache manifest: ${this.routeToTags.size} routes, ${this.tagToRoutes.size} tags`)
    } catch {
      // File doesn't exist yet — start fresh
    }
  }

  /**
   * Save the registry to its JSON file immediately.
   */
  async save(): Promise<void> {
    try {
      await mkdir(dirname(this.persistPath), { recursive: true })
      await writeFile(this.persistPath, JSON.stringify(this.toJson(), null, 2), 'utf-8')
    } catch (error) {
      logger.error('Failed to persist cache manifest: %s', error instanceof Error ? error.message : String(error))
    }
  }

  /**
   * Schedule a debounced save (500ms) to avoid excessive writes.
   */
  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.save(), 500)
  }
}
