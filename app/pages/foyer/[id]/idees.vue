<script setup lang="ts">
import type { Lot, TakeLine } from '~/composables/useStock'
import type { RecipeSuggestion } from '~/composables/useSuggestions'

const route = useRoute()
const householdId = computed(() => route.params.id as string)

const { locationById } = useHouseholdOptions(householdId)
/** Nombre de convives choisi par recette (conservé le temps de la session) */
const guests = useState<Record<string, number>>('pep:ideas-guests', () => ({}))
const { byStock, byExpiry, foods } = useSuggestions(householdId, guests)

function setGuests(s: RecipeSuggestion, n: number | null) {
  const next = { ...guests.value }
  if (!n || n === s.recipe.servings) delete next[s.recipe.id]
  else next[s.recipe.id] = n
  guests.value = next
}

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

/** Quantité de l'ingrédient convertie dans l'unité du produit (g ↔ kg, cl ↔ L…), si elles sont comparables */
function suggestedFor(quantity: number | null, unit: string, lot: Lot) {
  if (!quantity) return null
  return convertQuantity(quantity, unit, lot.product.unit)
}

function cook(s: RecipeSuggestion) {
  takeRecipe.value = s.scaled ? `${s.recipe.name} (${s.servings} pers.)` : s.recipe.name
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

// --- Recettes du foyer et notes ---
const { user } = useAuth()
const { householdRecipes } = useHouseholdRecipes(householdId)
const { rateRecipe } = useHouseholdActions()
const householdRecipesOpen = ref(false)

/** Note modifiable : recette du foyer ou d'une personne, ou recette de mon compte (celles des autres comptes sont en lecture seule) */
function canRate(s: RecipeSuggestion) {
  return !s.recipe.user_id || s.recipe.user_id === user.value?.id
}

// --- Liste de courses ---
const toast = useToast()
const { findItem } = useShoppingList(householdId)
const { addShoppingItems, removeShoppingItems } = useHouseholdActions()

function ingredientLabel(i: { quantity: number | null, unit: string, name: string }) {
  return [i.quantity, i.unit, i.name].filter(Boolean).join(' ')
}

/** Aliments à acheter pour la recette qui ne sont pas encore dans la liste de courses */
function notListed(s: RecipeSuggestion) {
  return s.toBuy.filter(b => !findItem(b.ingredient.name))
}

async function addToShopping(s: RecipeSuggestion) {
  const items = notListed(s)
  if (!items.length) return
  const rows = await addShoppingItems(householdId.value, items.map(b => ({
    label: b.ingredient.name,
    quantity: b.quantity,
    unit: b.quantity ? b.ingredient.unit : '',
    recipe_name: s.recipe.name
  })))
  toast.add({
    title: items.length > 1 ? `${items.length} aliments ajoutés aux courses` : 'Aliment ajouté aux courses',
    icon: 'i-lucide-shopping-cart',
    color: 'success',
    actions: [{ label: 'Annuler', color: 'neutral', variant: 'outline', onClick: () => removeShoppingItems(rows.map(r => r.id)) }]
  })
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center gap-2">
      <h1 class="text-2xl font-bold flex-1">
        Idées
      </h1>
      <UButton icon="i-lucide-book-open" color="neutral" variant="soft" size="sm" @click="householdRecipesOpen = true">
        Recettes du foyer{{ householdRecipes.length ? ` · ${householdRecipes.length}` : '' }}
      </UButton>
    </div>

    <UTabs v-model="tab" :items="tabs" :content="false" class="w-full" :ui="{ trigger: 'flex-1 text-xs sm:text-sm' }" />

    <!-- Recettes -->
    <template v-if="tab !== 'foods'">
      <p class="text-sm text-muted">
        {{ tab === 'stock'
          ? 'Les recettes du foyer et les recettes préférées de chacun, des plus faciles à réaliser avec le stock aux moins complètes (à égalité, les mieux notées d\'abord).'
          : 'Les recettes qui utilisent les aliments qui périment bientôt.' }}
      </p>

      <UEmpty
        v-if="!recipes.length"
        icon="i-lucide-book-open"
        title="Aucune recette à proposer"
        :description="tab === 'stock'
          ? 'Ajoutez des recettes (avec leurs ingrédients) au foyer ou aux personnes, et des aliments au stock.'
          : 'Aucune recette n\'utilise d\'aliment qui périme dans les 14 prochains jours.'"
        :actions="[
          { label: 'Recettes du foyer', icon: 'i-lucide-book-open', onClick: () => { householdRecipesOpen = true } },
          { label: 'Personnes du foyer', icon: 'i-lucide-users', color: 'neutral', variant: 'soft', to: `/foyer/${householdId}/personnes` }
        ]"
      />

      <div v-else class="grid grid-cols-1 gap-4 md:grid-cols-2 items-start">
        <div v-for="s in recipes" :key="s.recipe.id" class="rounded-xl border border-default bg-elevated/40">
          <button type="button" class="w-full text-left p-3 space-y-1.5" @click="expanded = expanded === s.recipe.id ? null : s.recipe.id">
            <div class="flex items-center gap-2">
              <p class="font-semibold flex-1 min-w-0 truncate">
                {{ s.recipe.name }}
              </p>
              <UBadge :color="s.coverage === 1 ? 'success' : s.coverage >= 0.5 ? 'primary' : 'neutral'" variant="subtle" size="sm">
                {{ s.available }}/{{ s.recipe.ingredients.length }} ingrédients
              </UBadge>
            </div>
            <UProgress :model-value="Math.round(s.coverage * 100)" size="xs" :color="s.coverage === 1 ? 'success' : 'primary'" />
            <p class="text-xs text-muted flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span v-if="s.common" class="inline-flex items-center gap-1">
                <UIcon name="i-lucide-house" class="size-3 text-primary" /> Recette du foyer
              </span>
              <span v-if="s.favoredBy.length" class="inline-flex items-center gap-1">
                <UIcon name="i-lucide-heart" class="size-3 text-pink-500" /> {{ names(s.favoredBy) }}
              </span>
              <span v-if="s.servings" class="inline-flex items-center gap-1" :class="s.scaled ? 'text-primary font-medium' : ''">
                <UIcon name="i-lucide-users" class="size-3" /> {{ s.servings }} pers.
              </span>
              <StarRating v-if="s.recipe.rating" :model-value="Number(s.recipe.rating)" readonly size="sm" />
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
            <div v-if="s.recipe.servings" class="flex flex-wrap items-center gap-2 text-sm">
              <span class="text-muted inline-flex items-center gap-1">
                <UIcon name="i-lucide-users" class="size-4" /> Convives :
              </span>
              <UInputNumber
                :model-value="s.servings"
                :min="1"
                :max="99"
                size="sm"
                class="w-28"
                @update:model-value="v => setGuests(s, v ?? null)"
              />
              <UButton
                v-if="s.scaled"
                size="xs"
                color="neutral"
                variant="link"
                icon="i-lucide-rotate-ccw"
                @click="setGuests(s, null)"
              >
                Recette : {{ s.recipe.servings }} pers.
              </UButton>
            </div>
            <p v-else-if="s.ingredients.some(i => i.quantity)" class="text-xs text-muted">
              Indiquez le nombre de personnes dans la recette pour adapter les quantités aux convives.
            </p>
            <ul class="text-sm space-y-1">
              <li v-for="m in s.matches" :key="`ok-${m.ingredient.name}`" class="flex items-start gap-2">
                <UIcon
                  :name="m.enough ? 'i-lucide-check' : 'i-lucide-triangle-alert'"
                  class="size-4 mt-0.5 shrink-0"
                  :class="m.enough ? 'text-success' : 'text-warning'"
                />
                <span>
                  {{ ingredientLabel(m.ingredient) }}
                  <span class="text-muted">→ {{ m.lots[0]!.product.name }} ({{ formatQuantity(m.lots[0]!.remaining, m.lots[0]!.product.unit) }})</span>
                  <span v-if="!m.enough" class="text-warning">
                    — pas assez : {{ formatQuantity(m.available!, m.ingredient.unit) }} en stock
                    <template v-if="findItem(m.ingredient.name)">· dans la liste de courses</template>
                  </span>
                </span>
              </li>
              <li v-for="i in s.staples" :key="`staple-${i.name}`" class="flex items-start gap-2">
                <UIcon name="i-lucide-check" class="size-4 text-muted mt-0.5 shrink-0" />
                <span>
                  {{ ingredientLabel(i) }}
                  <span class="text-muted">— basique du placard</span>
                </span>
              </li>
              <li v-for="i in s.missing" :key="`ko-${i.name}`" class="flex items-start gap-2 text-muted">
                <UIcon name="i-lucide-x" class="size-4 text-error mt-0.5 shrink-0" />
                <span>{{ ingredientLabel(i) }} — {{ findItem(i.name) ? 'dans la liste de courses' : 'à acheter' }}</span>
              </li>
            </ul>
            <UButton
              v-if="notListed(s).length"
              block
              color="neutral"
              variant="soft"
              icon="i-lucide-shopping-cart"
              @click="addToShopping(s)"
            >
              Ajouter aux courses ({{ notListed(s).length }})
            </UButton>
            <p v-if="s.recipe.instructions" class="text-sm whitespace-pre-line rounded-lg bg-muted/50 p-2.5">
              {{ s.recipe.instructions }}
            </p>
            <div v-if="canRate(s)" class="flex items-center gap-2 text-sm">
              <span class="text-muted">Note :</span>
              <StarRating :model-value="Number(s.recipe.rating ?? 0)" @update:model-value="v => rateRecipe(s.recipe.id, v)" />
            </div>
            <UButton block icon="i-lucide-cooking-pot" @click="cook(s)">
              Je la cuisine : retirer les aliments
            </UButton>
          </div>
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
      <ul v-else class="grid grid-cols-1 gap-2 md:grid-cols-2">
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
          <UButton icon="i-lucide-minus" color="neutral" variant="soft" aria-label="Retirer du stock" @click="takeFood(f.lot)" />
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
    <HouseholdRecipesModal v-model:open="householdRecipesOpen" :household-id="householdId" />
  </div>
</template>
