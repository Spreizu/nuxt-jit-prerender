<template>
  <div>
    <h1>Article {{ route.params.id }}</h1>
    <p data-testid="rendered-at">{{ renderedAt }}</p>
  </div>
</template>

<script setup lang="ts">
const route = useRoute()
const { data: renderedAt } = await useAsyncData<number>(
  'renderedAt_[id]',
  () => new Promise((resolve) => resolve(Date.now()))
)
useCacheTags(['page:article', `article:${route.params.id}`])
</script>
