<script setup lang="ts">
/**
 * Aliment générique d'un produit (« pâtes » pour « Coquillettes Panzani ») :
 * sert à reconnaître le produit dans les aliments des recettes.
 * Les catégories Open Food Facts du produit sont proposées en raccourcis.
 */
defineProps<{
  /** catégories Open Food Facts proposées (vide = aucune) */
  categories?: string[]
}>()
const model = defineModel<string>({ default: '' })
</script>

<template>
  <UFormField label="Aliment (pour les recettes)" help="Nom courant de l'aliment, s'il n'apparaît pas dans le nom du produit : « pâtes », « fromage », « sauce tomate »…">
    <UInput v-model="model" class="w-full" placeholder="ex. pâtes" />
    <div v-if="categories?.length" class="flex flex-wrap gap-1.5 mt-2">
      <UButton
        v-for="c in categories"
        :key="c"
        size="xs"
        :color="model === c ? 'primary' : 'neutral'"
        :variant="model === c ? 'subtle' : 'outline'"
        @click="model = c"
      >
        {{ c }}
      </UButton>
    </div>
  </UFormField>
</template>
