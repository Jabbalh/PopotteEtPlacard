<script setup lang="ts">
import type { Ingredient, Recipe } from '~/utils/db'
import type { TasteOwner } from '~/composables/useHousehold'

/** Création / modification d'une recette : liste d'aliments et/ou texte libre */
const props = defineProps<{
  owner: TasteOwner
  recipe?: Recipe | null
  /** noms proposés pour les ingrédients (produits du foyer) */
  suggestions?: string[]
}>()
const open = defineModel<boolean>('open', { default: false })

const toast = useToast()
const { saveRecipe, deleteRecipe, restoreRecipe } = useHouseholdActions()

const form = reactive({ name: '', instructions: '', ingredients: [] as Ingredient[] })
const listId = `ingredients-${Math.random().toString(36).slice(2)}`

watch(open, (o) => {
  if (!o) return
  form.name = props.recipe?.name ?? ''
  form.instructions = props.recipe?.instructions ?? ''
  form.ingredients = props.recipe?.ingredients.map(i => ({ ...i })) ?? []
  if (!form.ingredients.length) addIngredient()
}, { immediate: true })

function addIngredient() {
  form.ingredients.push({ name: '', quantity: null, unit: '' })
}

async function save() {
  if (!form.name.trim()) return
  await saveRecipe(props.owner, { id: props.recipe?.id, name: form.name, ingredients: form.ingredients, instructions: form.instructions.trim() })
  open.value = false
  toast.add({ title: 'Recette enregistrée', icon: 'i-lucide-check', color: 'success', duration: 2000 })
}

async function remove() {
  const id = props.recipe!.id
  await deleteRecipe(id)
  open.value = false
  toast.add({
    title: 'Recette supprimée',
    actions: [{ label: 'Annuler', color: 'neutral', variant: 'outline', onClick: () => restoreRecipe(id) }]
  })
}
</script>

<template>
  <UModal v-model:open="open" :title="recipe ? 'Modifier la recette' : 'Nouvelle recette'" :ui="{ content: 'max-h-[92dvh]', body: 'overflow-y-auto' }">
    <template #body>
      <form :id="`${listId}-form`" class="space-y-4" @submit.prevent="save">
        <UFormField label="Nom de la recette" required>
          <UInput v-model="form.name" size="lg" class="w-full" required placeholder="ex. Gratin dauphinois" />
        </UFormField>

        <UFormField label="Aliments" help="Servent à proposer la recette selon le stock. Quantité et unité facultatives.">
          <div class="space-y-2">
            <div v-for="(ing, i) in form.ingredients" :key="i" class="flex gap-1.5">
              <UInput v-model="ing.name" placeholder="Aliment" class="flex-1 min-w-0" :list="listId" />
              <UInputNumber v-model="ing.quantity" placeholder="Qté" :min="0" :step-snapping="false" class="w-20" :increment="false" :decrement="false" />
              <UInput v-model="ing.unit" placeholder="Unité" class="w-20" />
              <UButton icon="i-lucide-x" color="neutral" variant="ghost" aria-label="Retirer" @click="form.ingredients.splice(i, 1)" />
            </div>
            <UButton size="sm" color="neutral" variant="soft" icon="i-lucide-plus" @click="addIngredient">
              Ajouter un aliment
            </UButton>
          </div>
          <datalist :id="listId">
            <option v-for="s in suggestions ?? []" :key="s" :value="s" />
          </datalist>
        </UFormField>

        <UFormField label="Préparation / notes">
          <UTextarea v-model="form.instructions" :rows="4" autoresize class="w-full" placeholder="Texte libre" />
        </UFormField>

        <UButton v-if="recipe" block color="error" variant="ghost" icon="i-lucide-trash-2" @click="remove">
          Supprimer la recette
        </UButton>
      </form>
    </template>
    <template #footer>
      <div class="flex gap-2 w-full">
        <UButton color="neutral" variant="ghost" class="flex-1 justify-center" @click="open = false">
          Annuler
        </UButton>
        <UButton type="submit" :form="`${listId}-form`" class="flex-1 justify-center" :disabled="!form.name.trim()">
          Enregistrer
        </UButton>
      </div>
    </template>
  </UModal>
</template>
