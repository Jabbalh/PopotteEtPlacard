<script setup lang="ts">
import type { Lot, TakeLine } from '~/composables/useStock'
import type { RecipeSuggestion } from '~/composables/useSuggestions'

const route = useRoute()
const householdId = computed(() => route.params.id as string)

const { locationById } = useHouseholdOptions(householdId)
const { byStock, byExpiry, foods } = useSuggestions(householdId)

const tab = useState<'stock' | 'expiry' | 'foods'>('pep:ideas-tab', () => 'stock')
const tabs = computed(() => [
  { label: 'Avec le stock', value: 'stock', icon: 'i-lucide-chef-hat' },
  { label: 'Anti-gaspi', value: 'expiry', icon: 'i-lucide-timer' },
  { label: 'À consommer', value: 'foods', icon: 'i-lucide-calendar-clock' }
])
const recipes = computed(() => (tab.value === 'expiry' ? byExpiry.value : byStock.value))
const expanded = ref<string | null>(null)

// --- Sortie de stock ---
const takeOpen = ref(false)
const takeLines = ref<TakeLine[]>([])
const takeRecipe = ref<string | null>(null)

/** Quantité de l'ingrédient, si elle est exprimée dans l'unité du produit */
function suggestedFor(quantity: number | null, unit: string, lot: Lot) {
  if (!quantity) return null
  const u = unit.trim().toLowerCase()
  if (!u || u === lot.product.unit.toLowerCase()) return quantity
  return null
}

function cook(s: RecipeSuggestion) {
  takeRecipe.value = s.recipe.name
  takeLines.value = s.matches.flatMap(m => m.lots.map((lot, i) => ({
    lot,
    ingredient: [m.ingredient.quantity, m.ingredient.unit, m.ingredient.name].filter(Boolean).join(' '),
    suggested: suggestedFor(m.ingredient.quantity, m.ingredient.unit, lot),
    // un seul lot coché par ingrédient : le plus urgent
    selected: i === 0
  })))
  takeOpen.value = true
}

function takeFood(lot: Lot) {
  takeRecipe.value = null
  takeLines.value = [{ lot }]
  takeOpen.value = true
}

function names(people: { name: string }[]) {
  return people.map(p => p.name).join(', ')
}
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-2xl font-bold">
      Idées
    </h1>

    <UTabs v-model="tab" :items="tabs" :content="false" class="w-full" :ui="{ trigger: 'flex-1 text-xs sm:text-sm' }" />

    <!-- Recettes -->
    <template v-if="tab !== 'foods'">
      <p class="text-sm text-muted">
        {{ tab === 'stock'
          ? 'Les recettes préférées des personnes du foyer, des plus faciles à réaliser avec le stock aux moins complètes.'
          : 'Les recettes qui utilisent les aliments qui périment bientôt.' }}
      </p>

      <UEmpty
        v-if="!recipes.length"
        icon="i-lucide-book-open"
        title="Aucune recette à proposer"
        :description="tab === 'stock'
          ? 'Ajoutez des recettes préférées (avec leurs ingrédients) aux personnes du foyer, et des aliments au stock.'
          : 'Aucune recette n\'utilise d\'aliment qui périme dans les 15 prochains jours.'"
        :actions="[{ label: 'Personnes du foyer', icon: 'i-lucide-users', to: `/foyer/${householdId}/personnes` }]"
      />

      <div v-for="s in recipes" :key="s.recipe.id" class="rounded-xl border border-default bg-elevated/40">
        <button type="button" class="w-full text-left p-3 space-y-1.5" @click="expanded = expanded === s.recipe.id ? null : s.recipe.id">
          <div class="flex items-center gap-2">
            <p class="font-semibold flex-1 min-w-0 truncate">
              {{ s.recipe.name }}
            </p>
            <UBadge :color="s.coverage === 1 ? 'success' : s.coverage >= 0.5 ? 'primary' : 'neutral'" variant="subtle" size="sm">
              {{ s.matches.length }}/{{ s.recipe.ingredients.length }} ingrédients
            </UBadge>
          </div>
          <UProgress :model-value="Math.round(s.coverage * 100)" size="xs" :color="s.coverage === 1 ? 'success' : 'primary'" />
          <p class="text-xs text-muted flex items-center gap-1">
            <UIcon name="i-lucide-heart" class="size-3 text-pink-500" /> {{ names(s.favoredBy) }}
          </p>
          <p v-if="tab === 'expiry'" class="text-xs flex flex-wrap gap-1">
            <UBadge
              v-for="m in s.matches.filter(x => x.lots[0]!.item.expires_on)"
              :key="m.ingredient.name"
              :color="expiryInfo(m.lots[0]!.item.expires_on).color"
              variant="soft"
              size="sm"
            >
              {{ m.lots[0]!.product.name }} · {{ expiryInfo(m.lots[0]!.item.expires_on).label }}
            </UBadge>
          </p>
          <p
            v-for="c in s.conflicts"
            :key="c.person.id + c.label"
            class="text-xs flex items-center gap-1"
            :class="c.level === 'allergy' ? 'text-error' : 'text-warning'"
          >
            <UIcon :name="preferenceLevel(c.level).icon" class="size-3" />
            {{ c.person.name }} : {{ preferenceLevel(c.level).label.toLowerCase() }} « {{ c.label }} »
          </p>
        </button>

        <div v-if="expanded === s.recipe.id" class="px-3 pb-3 space-y-3 border-t border-default pt-3">
          <ul class="text-sm space-y-1">
            <li v-for="m in s.matches" :key="`ok-${m.ingredient.name}`" class="flex items-start gap-2">
              <UIcon name="i-lucide-check" class="size-4 text-success mt-0.5 shrink-0" />
              <span>
                {{ [m.ingredient.quantity, m.ingredient.unit, m.ingredient.name].filter(Boolean).join(' ') }}
                <span class="text-muted">→ {{ m.lots[0]!.product.name }} ({{ formatQuantity(m.lots[0]!.remaining, m.lots[0]!.product.unit) }})</span>
              </span>
            </li>
            <li v-for="i in s.missing" :key="`ko-${i.name}`" class="flex items-start gap-2 text-muted">
              <UIcon name="i-lucide-x" class="size-4 text-error mt-0.5 shrink-0" />
              <span>{{ [i.quantity, i.unit, i.name].filter(Boolean).join(' ') }} — à acheter</span>
            </li>
          </ul>
          <p v-if="s.recipe.instructions" class="text-sm whitespace-pre-line rounded-lg bg-muted/50 p-2.5">
            {{ s.recipe.instructions }}
          </p>
          <UButton block icon="i-lucide-cooking-pot" @click="cook(s)">
            Je la cuisine : retirer les aliments
          </UButton>
        </div>
      </div>
    </template>

    <!-- Aliments à consommer -->
    <template v-else>
      <p class="text-sm text-muted">
        Les aliments en stock, du plus proche de sa date de péremption au plus lointain.
      </p>
      <UEmpty
        v-if="!foods.length"
        icon="i-lucide-calendar-check"
        title="Rien à surveiller"
        description="Aucun aliment en stock n'a de date de péremption renseignée."
      />
      <ul v-else class="space-y-2">
        <li v-for="f in foods" :key="f.lot.item.id" class="flex items-center gap-3 p-3 rounded-xl border border-default bg-elevated/40">
          <NuxtLink :to="`/foyer/${householdId}/produit/${f.lot.product.id}`" class="flex-1 min-w-0">
            <p class="font-medium truncate">
              {{ f.lot.product.name }}
            </p>
            <p class="text-xs text-muted truncate">
              {{ formatQuantity(f.lot.remaining, f.lot.product.unit) }}
              <template v-if="f.lot.item.location_id && locationById.get(f.lot.item.location_id)">
                · {{ locationById.get(f.lot.item.location_id)!.label }}
              </template>
            </p>
            <div class="flex flex-wrap items-center gap-1 mt-1">
              <UBadge :color="expiryInfo(f.lot.item.expires_on).color" variant="subtle" size="sm">
                {{ expiryInfo(f.lot.item.expires_on).label }}
              </UBadge>
              <UBadge
                v-for="o in f.opinions"
                :key="o.person.id + o.label"
                :color="preferenceLevel(o.level).color"
                :icon="preferenceLevel(o.level).icon"
                variant="outline"
                size="sm"
              >
                {{ o.person.name }}
              </UBadge>
            </div>
          </NuxtLink>
          <UButton icon="i-lucide-pencil" color="neutral" variant="soft" aria-label="Modifier le stock" @click="takeFood(f.lot)" />
        </li>
      </ul>
    </template>

    <TakeStockModal
      v-model:open="takeOpen"
      :household-id="householdId"
      :lines="takeLines"
      :recipe-name="takeRecipe"
      :title="takeRecipe ?? undefined"
    />
  </div>
</template>
