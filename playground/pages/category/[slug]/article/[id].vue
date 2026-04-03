<template>
  <div>
    <h1>{{ route.params.slug }} — Article {{ route.params.id }}</h1>
  </div>
</template>

<script setup lang="ts">
const route = useRoute()
useCacheTags([`category:${route.params.slug}`, `article:${route.params.id}`])
</script>
