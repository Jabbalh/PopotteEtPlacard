<script setup lang="ts">
import type { Recipe } from '~/utils/db'

/**
 * Recettes communes du foyer (rattachées à aucune personne) : liste, ajout, modification.
 * Elles sont proposées dans les idées comme les recettes préférées des personnes.
 */
const props = defineProps<{ householdId: string }>()
const open = defineModel<boolean>('open', { default: false })

const householdId = computed(() => props.householdId)
const { householdRecipes, owner } = useHouseholdRecipes(householdId)
const { catalog } = useFoodCatalog(householdId)
const suggestions = computed(() => catalog.value.map(c => c.name))

const recipeOpen = ref(false)
const editing = ref<Recipe | null>(null)
function openRecipe(r: Recipe | null) {
  editing.value = r
  recipeOpen.value = true
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="Recettes du foyer"
    description="Recettes communes, sans personne particulière : elles sont proposées dans les idées selon le stock."
    :ui="{ content: 'max-h-[92dvh]', body: 'overflow-y-auto' }"
  >
    <template #body>
      <p v-if="!householdRecipes.length" class="text-sm text-muted py-2">
        Aucune recette commune pour l'instant. Ajoutez-en avec leurs aliments pour recevoir des idées selon le stock.
      </p>
      <ul v-else class="divide-y divide-default rounded-xl border border-default">
        <li v-for="r in householdRecipes" :key="r.id">
          <button type="button" class="w-full text-left px-3 py-2.5 flex items-center gap-2" @click="openRecipe(r)">
            <div class="flex-1 min-w-0">
              <p class="font-medium truncate">
                {{ r.name }}
                <StarRating v-if="r.rating" :model-value="Number(r.rating)" readonly size="sm" class="ml-1 align-middle" />
              </p>
              <p class="text-xs text-muted truncate">
                <template v-if="r.servings">{{ r.servings }} pers. · </template>{{ r.ingredients.length ? r.ingredients.map(i => i.name).join(', ') : r.instructions || 'Texte libre' }}
              </p>
            </div>
            <UIcon name="i-lucide-chevron-right" class="size-4 text-muted shrink-0" />
          </button>
        </li>
      </ul>
    </template>
    <template #footer>
      <div class="flex gap-2 w-full">
        <UButton color="neutral" variant="ghost" class="flex-1 justify-center" @click="open = false">
          Fermer
        </UButton>
        <UButton class="flex-1 justify-center" icon="i-lucide-plus" @click="openRecipe(null)">
          Nouvelle recette
        </UButton>
      </div>
    </template>
  </UModal>

  <RecipeModal v-model:open="recipeOpen" :owner="owner" :recipe="editing" :suggestions="suggestions" />
</template>
