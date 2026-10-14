<script setup lang="ts">
import type { Preference, PreferenceLevel, Recipe } from '~/utils/db'
import type { TasteOwner } from '~/composables/useHousehold'

/**
 * Préférences d'aliments et recettes préférées.
 * Les éléments venant d'un compte (fromAccount) sont affichés mais modifiables
 * seulement par le titulaire du compte (editableAccount).
 */
const props = defineProps<{
  preferences: (Preference & { fromAccount?: boolean })[]
  recipes: (Recipe & { fromAccount?: boolean })[]
  /** propriétaire des nouveaux éléments */
  owner: TasteOwner
  /** les éléments du compte sont-ils modifiables ici ? */
  editableAccount?: boolean
  /** nom du compte d'origine (affichage) */
  accountLabel?: string
  suggestions?: string[]
}>()

const { addPreference, updatePreference } = useHouseholdActions()
const toast = useToast()

const canEdit = (row: { fromAccount?: boolean }) => !row.fromAccount || props.editableAccount

// --- Préférences ---
const newLabel = ref('')
const newLevel = ref<PreferenceLevel>('love')

const grouped = computed(() => PREFERENCE_LEVELS.map(level => ({
  level,
  items: props.preferences.filter(p => p.level === level.value).sort((a, b) => a.label.localeCompare(b.label))
})).filter(g => g.items.length))

async function add() {
  const label = newLabel.value.trim()
  if (!label) return
  const duplicate = props.preferences.find(p => p.label.toLowerCase() === label.toLowerCase() && canEdit(p))
  if (duplicate) await updatePreference(duplicate.id, { level: newLevel.value })
  else await addPreference(props.owner, label, newLevel.value)
  newLabel.value = ''
}

async function remove(p: Preference) {
  await updatePreference(p.id, { deleted_at: new Date().toISOString() })
  toast.add({
    title: `« ${p.label} » retiré`,
    actions: [{ label: 'Annuler', color: 'neutral', variant: 'outline', onClick: () => updatePreference(p.id, { deleted_at: null }) }]
  })
}

/** Toucher un aliment fait défiler son niveau */
async function cycle(p: Preference) {
  const i = PREFERENCE_LEVELS.findIndex(l => l.value === p.level)
  await updatePreference(p.id, { level: PREFERENCE_LEVELS[(i + 1) % PREFERENCE_LEVELS.length]!.value })
}

// --- Recettes ---
const recipeOpen = ref(false)
const editing = ref<Recipe | null>(null)
function openRecipe(r: Recipe | null) {
  editing.value = r
  recipeOpen.value = true
}
</script>

<template>
  <div class="space-y-5">
    <UCard>
      <template #header>
        <h2 class="font-semibold">
          Préférences d'aliments
        </h2>
        <p class="text-sm text-muted">
          Touchez un aliment pour changer d'avis, la croix pour le retirer.
        </p>
      </template>

      <div class="space-y-3">
        <div v-for="g in grouped" :key="g.level.value" class="space-y-1.5">
          <p class="text-xs font-medium flex items-center gap-1" :class="`text-${g.level.color}`">
            <UIcon :name="g.level.icon" class="size-3.5" /> {{ g.level.label }}
          </p>
          <div class="flex flex-wrap gap-1.5">
            <span
              v-for="p in g.items"
              :key="p.id"
              class="inline-flex items-center rounded-full border text-sm"
              :class="p.fromAccount ? 'border-dashed border-default' : 'border-default bg-elevated/50'"
            >
              <button
                type="button"
                class="pl-3 py-1 disabled:cursor-default"
                :class="canEdit(p) ? 'pr-1' : 'pr-3'"
                :disabled="!canEdit(p)"
                :title="p.fromAccount ? `Préférence du compte ${accountLabel ?? ''}` : undefined"
                @click="cycle(p)"
              >
                {{ p.label }}
                <UIcon v-if="p.fromAccount && !editableAccount" name="i-lucide-link" class="size-3 text-muted ml-0.5" />
              </button>
              <button v-if="canEdit(p)" type="button" class="pr-2 pl-0.5 py-1 text-muted hover:text-error" aria-label="Retirer" @click="remove(p)">
                <UIcon name="i-lucide-x" class="size-3.5" />
              </button>
            </span>
          </div>
        </div>
        <p v-if="!grouped.length" class="text-sm text-muted">
          Aucune préférence pour le moment.
        </p>

        <form class="space-y-2 pt-2 border-t border-default" @submit.prevent="add">
          <div class="flex gap-1.5 flex-wrap">
            <UButton
              v-for="l in PREFERENCE_LEVELS"
              :key="l.value"
              size="xs"
              :icon="l.icon"
              :color="newLevel === l.value ? l.color : 'neutral'"
              :variant="newLevel === l.value ? 'solid' : 'outline'"
              class="rounded-full"
              @click="newLevel = l.value"
            >
              {{ l.label }}
            </UButton>
          </div>
          <div class="flex gap-2">
            <UInput v-model="newLabel" placeholder="Un aliment (ex. brocoli)" class="flex-1" list="taste-suggestions" />
            <UButton type="submit" icon="i-lucide-plus" :disabled="!newLabel.trim()">
              Ajouter
            </UButton>
          </div>
          <datalist id="taste-suggestions">
            <option v-for="s in suggestions ?? []" :key="s" :value="s" />
          </datalist>
        </form>
      </div>
    </UCard>

    <UCard>
      <template #header>
        <div class="flex items-center justify-between gap-2">
          <h2 class="font-semibold">
            Recettes préférées
          </h2>
          <UButton icon="i-lucide-plus" size="sm" @click="openRecipe(null)">
            Recette
          </UButton>
        </div>
      </template>
      <p v-if="!recipes.length" class="text-sm text-muted">
        Aucune recette. Ajoutez-en avec leurs aliments pour recevoir des idées selon le stock.
      </p>
      <ul v-else class="divide-y divide-default -my-2">
        <li v-for="r in recipes" :key="r.id">
          <component
            :is="canEdit(r) ? 'button' : 'div'"
            type="button"
            class="w-full text-left py-2.5 flex items-center gap-2"
            @click="canEdit(r) && openRecipe(r)"
          >
            <div class="flex-1 min-w-0">
              <p class="font-medium truncate">
                {{ r.name }}
                <UIcon v-if="r.fromAccount && !editableAccount" name="i-lucide-link" class="size-3 text-muted" />
              </p>
              <p class="text-xs text-muted truncate">
                {{ r.ingredients.length ? r.ingredients.map(i => i.name).join(', ') : r.instructions || 'Texte libre' }}
              </p>
            </div>
            <UIcon v-if="canEdit(r)" name="i-lucide-chevron-right" class="size-4 text-muted" />
          </component>
        </li>
      </ul>
    </UCard>

    <RecipeModal v-model:open="recipeOpen" :owner="owner" :recipe="editing" :suggestions="suggestions" />
  </div>
</template>
