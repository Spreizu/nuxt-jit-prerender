<template>
  <div>
    <h1>Home</h1>
    <nav>
      <NuxtLink to="/news">News</NuxtLink>
    </nav>
  </div>
</template>

<script setup lang="ts">
useCacheTags(['page:home', 'global:footer'])
</script>
