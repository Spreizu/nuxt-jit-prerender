<template>
  <div>
    <h1>Home</h1>
    <p data-testid="rendered-at">{{ renderedAt }}</p>
    <nav>
      <NuxtLink to="/news">News</NuxtLink>
    </nav>
  </div>
</template>

<script setup lang="ts">
const { data: renderedAt } = await useAsyncData<number>(
  'renderedAt',
  () => new Promise((resolve) => resolve(Date.now()))
)
useCacheTags(['page:home', 'global:footer'])
</script>
