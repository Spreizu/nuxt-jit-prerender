<template>
  <div>
    <h1>Category: {{ route.params.slug }}</h1>
  </div>
</template>

<script setup lang="ts">
const route = useRoute()
useCacheTags([`category:${route.params.slug}`])
</script>
