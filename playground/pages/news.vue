<template>
  <div>
    <h1>News</h1>
    <p data-testid="rendered-at">{{ renderedAt }}</p>
    <ul>
      <li v-for="article in articles" :key="article.id">
        <NuxtLink :to="`/article/${article.id}`">{{ article.title }}</NuxtLink>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
const { data: renderedAt } = await useAsyncData<number>(
  'renderedAt',
  () => new Promise((resolve) => resolve(Date.now()))
)
const { articles } = useNewsApi()

// This page will be re-rendered if:
// * global:news tag is invalidated (set via useNewsApi)
// * tag for an article returned by the useNewsApi composable is invalidated
// * tag for this page (page:news) is invalidated
useCacheTags(['page:news', ...articles.map((a) => `article:${a.id}`)])
</script>
