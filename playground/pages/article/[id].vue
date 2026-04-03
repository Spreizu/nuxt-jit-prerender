<template>
  <div>
    <h1>Article {{ route.params.id }}</h1>
  </div>
</template>

<script setup lang="ts">
const route = useRoute()
useCacheTags(['page:article', `article:${route.params.id}`])
</script>
