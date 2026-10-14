<script setup lang="ts">
const { preferences, recipes, owner } = useMyTastes()
</script>

<template>
  <div class="space-y-4">
    <div>
      <h1 class="text-2xl font-bold">
        Mes goûts et recettes
      </h1>
      <p class="text-sm text-muted">
        Liés à votre compte : ils sont repris automatiquement dans chaque foyer dont vous faites partie. Chaque foyer peut ensuite les compléter.
      </p>
    </div>
    <TastesEditor :preferences="preferences" :recipes="recipes" :owner="owner" editable-account />
  </div>
</template>
