<script setup lang="ts">
import type { Lot, TakeLine } from '~/composables/useStock'
import type { Nutriscore } from '~/utils/db'

const route = useRoute()
const router = useRouter()
const toast = useToast()
const householdId = computed(() => route.params.id as string)
const productId = computed(() => route.params.pid as string)

const { accountName } = useHousehold(householdId)
const { locations, locationById, foodTypes, foodTypeById } = useHouseholdOptions(householdId)
const { productById, allLots, movementsOf, isOrdered, loading } = useStock(householdId)
const { updateProduct, updateStockItem, addMovements, cancelMovements } = useHouseholdActions()

const product = computed(() => productById.value.get(productId.value))

// --- Préférences des personnes du foyer sur cet aliment (code-barres, sinon nom) ---
const { opinionsOn } = useOpinions(householdId)
const LEVEL_ORDER = ['allergy', 'dislike', 'love', 'like']
const opinions = computed(() => (product.value ? opinionsOn(product.value.name, [product.value.barcode]) : [])
  .sort((a, b) => LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level) || a.person.name.localeCompare(b.person.name)))
const productLots = computed(() => allLots.value.filter(l => l.product.id === productId.value))
const activeLots = computed(() => productLots.value
  .filter(l => l.remaining > 0)
  .sort((a, b) => (a.item.expires_on ?? '9999').localeCompare(b.item.expires_on ?? '9999')))
const total = computed(() => activeLots.value.reduce((s, l) => s + l.remaining, 0))
const history = computed(() => movementsOf(productLots.value.map(l => l.item.id)))
const lotById = computed(() => new Map(productLots.value.map(l => [l.item.id, l])))

function goBack() {
  if (window.history.state?.back) router.back()
  else navigateTo(`/foyer/${householdId.value}`)
}

// --- Note (favori) : enregistrée immédiatement ---
const rating = computed({
  get: () => product.value?.rating ?? 0,
  set: v => updateProduct(productId.value, { rating: v })
})

// --- À commander quand épuisé : enregistré immédiatement ---
const reorder = computed({
  get: () => product.value?.reorder ?? false,
  set: v => updateProduct(productId.value, { reorder: v })
})
const toOrder = computed(() => !!product.value?.reorder && total.value <= product.value.low_threshold)
const ordered = computed(() => !!product.value && isOrdered(product.value))
const setOrdered = (v: boolean) => updateProduct(productId.value, { ordered_at: v ? new Date().toISOString() : null })

// --- Modification du produit ---
const editOpen = ref(false)
const form = reactive({
  name: '', brand: '', description: '', ingredients: '',
  nutriscore: null as Nutriscore | null, food_type_id: undefined as string | undefined,
  unit: 'pièce', low_threshold: 1 as number | null
})

function openEdit() {
  const p = product.value!
  Object.assign(form, {
    name: p.name, brand: p.brand, description: p.description, ingredients: p.ingredients,
    nutriscore: p.nutriscore, food_type_id: p.food_type_id ?? undefined, unit: p.unit, low_threshold: p.low_threshold
  })
  editOpen.value = true
}

async function saveEdit() {
  if (!form.name.trim()) return
  await updateProduct(productId.value, {
    name: form.name.trim(), brand: form.brand.trim(), description: form.description.trim(), ingredients: form.ingredients.trim(),
    nutriscore: form.nutriscore, food_type_id: form.food_type_id ?? null, unit: form.unit, low_threshold: form.low_threshold ?? 0
  })
  editOpen.value = false
  toast.add({ title: 'Produit mis à jour', icon: 'i-lucide-check', color: 'success', duration: 2000 })
}

const deleteOpen = ref(false)
async function removeProduct() {
  await updateProduct(productId.value, { deleted_at: new Date().toISOString() })
  deleteOpen.value = false
  toast.add({
    title: 'Produit supprimé',
    icon: 'i-lucide-trash-2',
    actions: [{ label: 'Annuler', color: 'neutral', variant: 'outline', onClick: () => updateProduct(productId.value, { deleted_at: null }) }]
  })
  goBack()
}

// --- Lots ---
const addOpen = ref(false)
const takeOpen = ref(false)
const takeLines = ref<TakeLine[]>([])
function take(lot: Lot) {
  takeLines.value = [{ lot }]
  takeOpen.value = true
}

/** Modification d'un lot : lieu, dates, et correction de la quantité restante (inventaire) */
const lotOpen = ref(false)
const lotEdit = reactive({
  id: '', location_id: undefined as string | undefined, purchased_on: '', expires_on: '', remaining: 0 as number | null, current: 0,
  /** rangement et péremption à l'ouverture (transfert vers le congélateur) */
  initialLocation: null as string | null, initialExpiry: ''
})

function openLot(lot: Lot) {
  Object.assign(lotEdit, {
    id: lot.item.id,
    location_id: lot.item.location_id ?? undefined,
    purchased_on: lot.item.purchased_on,
    expires_on: lot.item.expires_on ?? '',
    remaining: lot.remaining,
    current: lot.remaining,
    initialLocation: lot.item.location_id,
    initialExpiry: lot.item.expires_on ?? ''
  })
  lotOpen.value = true
}

/** Lot transféré vers un congélateur : congelé aujourd'hui, date limite = aujourd'hui + durée du type */
const lotFreezer = computed(() => {
  const isFreezer = (id: string | null | undefined) => !!(id && locationById.value.get(id)?.freezer)
  if (!isFreezer(lotEdit.location_id) || isFreezer(lotEdit.initialLocation)) return null
  const type = product.value?.food_type_id ? foodTypeById.value.get(product.value.food_type_id) : undefined
  if (!type?.freezer_months) return null
  return { months: type.freezer_months, type: type.label, date: addMonths(todayKey(), type.freezer_months) }
})

// La date du congélateur remplace la péremption ; retour à la date d'origine si le transfert est annulé
watch(() => lotFreezer.value?.date, (date, previous) => {
  if (!lotOpen.value) return
  if (date) lotEdit.expires_on = date
  else if (previous && lotEdit.expires_on === previous) lotEdit.expires_on = lotEdit.initialExpiry
})

async function saveLot() {
  await updateStockItem(lotEdit.id, {
    location_id: lotEdit.location_id ?? null,
    purchased_on: lotEdit.purchased_on || todayKey(),
    expires_on: lotEdit.expires_on || null
  })
  const target = Math.max(0, lotEdit.remaining ?? 0)
  if (target !== lotEdit.current) {
    // l'écart est enregistré comme un ajustement : l'historique reste juste même hors ligne
    await addMovements(householdId.value, [{ stock_item_id: lotEdit.id, kind: 'adjusted', quantity: lotEdit.current - target, occurred_on: todayKey() }])
  }
  lotOpen.value = false
  toast.add({ title: 'Lot mis à jour', icon: 'i-lucide-check', color: 'success', duration: 2000 })
}

async function deleteLot() {
  const id = lotEdit.id
  await updateStockItem(id, { deleted_at: new Date().toISOString() })
  lotOpen.value = false
  toast.add({
    title: 'Lot supprimé',
    description: 'Erreur de saisie effacée du stock et des statistiques.',
    actions: [{ label: 'Annuler', color: 'neutral', variant: 'outline', onClick: () => updateStockItem(id, { deleted_at: null }) }]
  })
}

async function cancelMovement(id: string) {
  await cancelMovements([id])
  toast.add({ title: 'Sortie annulée', description: 'La quantité est revenue dans le stock.', icon: 'i-lucide-undo-2' })
}

const foodTypeItems = computed(() => foodTypes.value.map(t => ({ label: t.label, value: t.id })))
const locationItems = computed(() => locations.value.map(l => ({ label: l.label, value: l.id, icon: l.icon })))
const unitItems = UNITS.map(u => ({ label: u, value: u }))
</script>

<template>
  <div v-if="!loading && !product" class="py-10">
    <UEmpty
      icon="i-lucide-search-x"
      title="Produit introuvable"
      description="Il a peut-être été supprimé."
      :actions="[{ label: 'Retour au stock', to: `/foyer/${householdId}` }]"
    />
  </div>

  <div v-else-if="product" class="space-y-5">
    <div class="flex items-center gap-2">
      <UButton icon="i-lucide-arrow-left" color="neutral" variant="ghost" aria-label="Retour" @click="goBack" />
      <h1 class="text-xl font-bold flex-1 truncate">
        {{ product.name }}
      </h1>
      <UButton icon="i-lucide-pencil" color="neutral" variant="ghost" aria-label="Modifier" @click="openEdit" />
      <UButton icon="i-lucide-trash-2" color="error" variant="ghost" aria-label="Supprimer" @click="deleteOpen = true" />
    </div>

    <div class="space-y-5 lg:space-y-0 lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-8 lg:items-start">
      <div class="space-y-5 lg:sticky lg:top-20">
        <UCard>
          <div class="flex gap-4">
            <img v-if="product.image_url" :src="product.image_url" alt="" class="size-24 rounded-lg object-contain bg-white shrink-0">
            <div class="min-w-0 flex-1 space-y-1.5">
              <p v-if="product.brand" class="text-sm text-muted">
                {{ product.brand }}
              </p>
              <div class="flex items-center gap-2 flex-wrap">
                <NutriscoreBadge :value="product.nutriscore" />
                <UBadge v-if="product.food_type_id && foodTypeById.get(product.food_type_id)" color="neutral" variant="subtle">
                  {{ foodTypeById.get(product.food_type_id)!.label }}
                </UBadge>
                <UBadge v-if="product.barcode" color="neutral" variant="outline" icon="i-lucide-barcode">
                  {{ product.barcode }}
                </UBadge>
              </div>
              <div>
                <p class="text-xs text-muted">
                  Aliment favori
                </p>
                <StarRating v-model="rating" />
              </div>
              <USwitch v-model="reorder" label="À commander quand épuisé" size="sm" />
            </div>
          </div>
          <p v-if="product.description" class="text-sm mt-3">
            {{ product.description }}
          </p>
          <details v-if="product.ingredients" class="mt-3 text-sm">
            <summary class="cursor-pointer text-muted">
              Composition
            </summary>
            <p class="mt-1 whitespace-pre-line">
              {{ product.ingredients }}
            </p>
          </details>
        </UCard>

        <UCard>
          <template #header>
            <h2 class="font-semibold flex items-center gap-2">
              <UIcon name="i-lucide-users" class="size-4 text-primary" /> Préférences du foyer
            </h2>
          </template>
          <p v-if="!opinions.length" class="text-sm text-muted">
            Personne n'a de préférence enregistrée sur cet aliment.
          </p>
          <ul v-else class="divide-y divide-default -my-2">
            <li v-for="(o, i) in opinions" :key="`${o.person.id}-${i}`">
              <NuxtLink :to="`/foyer/${householdId}/personnes/${o.person.id}`" class="flex items-center gap-3 py-2">
                <UAvatar :alt="o.person.name" size="sm" />
                <div class="flex-1 min-w-0">
                  <p class="font-medium truncate">
                    {{ o.person.name }}
                  </p>
                  <p class="text-xs text-muted truncate">
                    « {{ o.label }} »
                    <UIcon v-if="o.byBarcode" name="i-lucide-barcode" class="size-3" :title="'Même code-barres'" />
                    · {{ o.fromAccount ? 'goût du compte' : 'propre au foyer' }}
                  </p>
                </div>
                <UBadge :color="preferenceLevel(o.level).color" :icon="preferenceLevel(o.level).icon" variant="subtle" size="sm" class="shrink-0">
                  {{ preferenceLevel(o.level).label }}
                </UBadge>
              </NuxtLink>
            </li>
          </ul>
        </UCard>
      </div>
      <div class="space-y-5">
        <!-- Stock -->
        <section class="space-y-2">
          <div class="flex items-center justify-between">
            <h2 class="font-semibold">
              En stock : {{ formatQuantity(total, product.unit) }}
            </h2>
            <UButton icon="i-lucide-plus" size="sm" @click="addOpen = true">
              Ajouter
            </UButton>
          </div>
          <p v-if="(product.rating || product.reorder) && total <= product.low_threshold" class="text-sm text-warning flex items-center gap-1">
            <UIcon name="i-lucide-triangle-alert" /> {{ total <= 0 ? 'En rupture' : 'Bientôt en rupture' }} (seuil : {{ formatQuantity(product.low_threshold, product.unit) }})
          </p>
          <div v-if="toOrder" class="flex items-center gap-2 p-3 rounded-xl border" :class="ordered ? 'border-default' : 'border-warning/50 bg-warning/5'">
            <UIcon :name="ordered ? 'i-lucide-truck' : 'i-lucide-shopping-cart'" class="size-5 shrink-0" :class="ordered ? 'text-muted' : 'text-warning'" />
            <p class="text-sm flex-1">
              {{ ordered ? `Commandé le ${formatDate(toDateKey(new Date(product.ordered_at!)))}` : 'À commander' }}
            </p>
            <UButton v-if="ordered" size="sm" color="neutral" variant="ghost" icon="i-lucide-undo-2" @click="setOrdered(false)">
              Annuler
            </UButton>
            <UButton v-else size="sm" color="neutral" variant="soft" icon="i-lucide-check" @click="setOrdered(true)">
              Commandé
            </UButton>
          </div>
          <div v-for="lot in activeLots" :key="lot.item.id" class="p-3 rounded-xl border border-default bg-elevated/40 space-y-2">
            <div class="flex items-start gap-2">
              <div class="flex-1 min-w-0">
                <p class="font-medium">
                  {{ formatQuantity(lot.remaining, product.unit) }}
                  <span v-if="lot.remaining !== Number(lot.item.quantity)" class="text-xs text-muted font-normal">sur {{ formatQuantity(lot.item.quantity, product.unit) }}</span>
                </p>
                <p class="text-xs text-muted">
                  <template v-if="lot.item.location_id && locationById.get(lot.item.location_id)">
                    {{ locationById.get(lot.item.location_id)!.label }} ·
                  </template>
                  acheté le {{ formatDate(lot.item.purchased_on) }}
                  <UIcon v-if="lot.item._dirty" name="i-lucide-cloud-upload" class="size-3 text-warning ml-1" />
                </p>
              </div>
              <UBadge :color="expiryInfo(lot.item.expires_on).color" variant="subtle" size="sm">
                {{ expiryInfo(lot.item.expires_on).label }}
              </UBadge>
            </div>
            <div class="grid grid-cols-2 gap-2">
              <UButton size="sm" icon="i-lucide-minus" class="justify-center" @click="take(lot)">
                Retirer
              </UButton>
              <UButton size="sm" icon="i-lucide-sliders-horizontal" color="neutral" variant="soft" class="justify-center" @click="openLot(lot)">
                Modifier / corriger
              </UButton>
            </div>
          </div>
          <p v-if="!activeLots.length" class="text-sm text-muted text-center py-4 rounded-xl border border-dashed border-default">
            Plus rien en stock.
          </p>
        </section>

        <!-- Historique -->
        <section v-if="history.length" class="space-y-2">
          <h2 class="font-semibold">
            Historique
          </h2>
          <ul class="divide-y divide-default rounded-xl border border-default">
            <li v-for="m in history" :key="m.id" class="flex items-center gap-3 px-3 py-2">
              <UIcon
                :name="m.kind === 'adjusted' ? 'i-lucide-sliders-horizontal' : MOVEMENT_KINDS.find(k => k.value === m.kind)!.icon"
                class="size-4 text-muted shrink-0"
              />
              <div class="flex-1 min-w-0">
                <p class="text-sm">
                  {{ movementLabel(m.kind) }} :
                  <strong>{{ m.kind === 'adjusted' ? (m.quantity > 0 ? '−' : '+') : '' }}{{ formatQuantity(Math.abs(m.quantity), product.unit) }}</strong>
                  <span v-if="m.recipe_name" class="text-muted"> · {{ m.recipe_name }}</span>
                </p>
                <p class="text-xs text-muted truncate">
                  {{ formatDate(m.occurred_on) }}
                  <template v-if="accountName(m.created_by)">
                    · {{ accountName(m.created_by) }}
                  </template>
                  <template v-if="m.note">
                    · {{ m.note }}
                  </template>
                  <template v-if="lotById.get(m.stock_item_id)?.item.expires_on">
                    · lot du {{ formatDate(lotById.get(m.stock_item_id)!.item.expires_on) }}
                  </template>
                </p>
              </div>
              <UButton icon="i-lucide-undo-2" size="xs" color="neutral" variant="ghost" aria-label="Annuler cette sortie" @click="cancelMovement(m.id)" />
            </li>
          </ul>
        </section>
      </div>
    </div>

    <AddStockModal v-model:open="addOpen" :household-id="householdId" :product-id="productId" />
    <TakeStockModal v-model:open="takeOpen" :household-id="householdId" :lines="takeLines" />

    <!-- Modifier le produit -->
    <UModal v-model:open="editOpen" title="Modifier le produit" :ui="{ content: 'max-h-[92dvh]', body: 'overflow-y-auto' }">
      <template #body>
        <form id="edit-product" class="space-y-4" @submit.prevent="saveEdit">
          <UFormField label="Nom" required>
            <UInput v-model="form.name" class="w-full" required />
          </UFormField>
          <UFormField label="Marque">
            <UInput v-model="form.brand" class="w-full" />
          </UFormField>
          <UFormField label="Description">
            <UTextarea v-model="form.description" :rows="2" autoresize class="w-full" />
          </UFormField>
          <UFormField label="Composition">
            <UTextarea v-model="form.ingredients" :rows="3" autoresize class="w-full" />
          </UFormField>
          <UFormField label="Nutri-Score">
            <div class="flex gap-1.5">
              <button
                v-for="n in NUTRISCORES"
                :key="n.value"
                type="button"
                class="size-9 rounded-lg font-extrabold uppercase transition"
                :class="[n.color, form.nutriscore === n.value ? 'ring-2 ring-offset-2 ring-offset-default ring-inverted scale-110' : 'opacity-50']"
                @click="form.nutriscore = form.nutriscore === n.value ? null : n.value"
              >
                {{ n.value }}
              </button>
            </div>
          </UFormField>
          <UFormField label="Type d'aliment">
            <USelect v-model="form.food_type_id" :items="foodTypeItems" placeholder="Choisir…" class="w-full" />
          </UFormField>
          <div class="grid grid-cols-2 gap-3">
            <UFormField label="Unité">
              <USelect v-model="form.unit" :items="unitItems" class="w-full" />
            </UFormField>
            <UFormField label="Alerte rupture sous" help="Favoris et produits à commander">
              <UInputNumber v-model="form.low_threshold" :min="0" :step-snapping="false" class="w-full" />
            </UFormField>
          </div>
        </form>
      </template>
      <template #footer>
        <div class="flex gap-2 w-full">
          <UButton color="neutral" variant="ghost" class="flex-1 justify-center" @click="editOpen = false">
            Annuler
          </UButton>
          <UButton type="submit" form="edit-product" class="flex-1 justify-center" :disabled="!form.name.trim()">
            Enregistrer
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- Modifier un lot -->
    <UModal v-model:open="lotOpen" title="Modifier le lot">
      <template #body>
        <form id="edit-lot" class="space-y-4" @submit.prevent="saveLot">
          <UFormField label="Quantité restante" :help="`Corrige le stock après un inventaire (actuellement ${formatQuantity(lotEdit.current, product.unit)})`">
            <UInputNumber v-model="lotEdit.remaining" :min="0" :step-snapping="false" class="w-full" />
          </UFormField>
          <UFormField label="Rangé dans">
            <USelect v-model="lotEdit.location_id" :items="locationItems" placeholder="Choisir…" class="w-full" />
          </UFormField>
          <div class="grid grid-cols-2 gap-3">
            <UFormField label="Date d'achat">
              <UInput v-model="lotEdit.purchased_on" type="date" class="w-full" />
            </UFormField>
            <UFormField label="Péremption">
              <UInput v-model="lotEdit.expires_on" type="date" class="w-full" />
            </UFormField>
          </div>
          <p v-if="lotFreezer" class="-mt-2 text-xs text-muted flex items-start gap-1">
            <UIcon name="i-lucide-snowflake" class="size-3.5 shrink-0 mt-px text-info" />
            <span>
              Congelé aujourd'hui · {{ lotFreezer.type }} : {{ lotFreezer.months }} mois, soit jusqu'au {{ formatDate(lotFreezer.date) }}.
              <button v-if="lotEdit.expires_on !== lotFreezer.date" type="button" class="underline" @click="lotEdit.expires_on = lotFreezer.date">Appliquer</button>
            </span>
          </p>
          <UButton block color="error" variant="ghost" icon="i-lucide-trash-2" @click="deleteLot">
            Supprimer ce lot (erreur de saisie)
          </UButton>
        </form>
      </template>
      <template #footer>
        <div class="flex gap-2 w-full">
          <UButton color="neutral" variant="ghost" class="flex-1 justify-center" @click="lotOpen = false">
            Annuler
          </UButton>
          <UButton type="submit" form="edit-lot" class="flex-1 justify-center">
            Enregistrer
          </UButton>
        </div>
      </template>
    </UModal>

    <UModal v-model:open="deleteOpen" title="Supprimer ce produit ?" description="Le produit et ses lots disparaissent du stock du foyer.">
      <template #footer>
        <div class="flex gap-2 w-full">
          <UButton color="neutral" variant="ghost" class="flex-1 justify-center" @click="deleteOpen = false">
            Annuler
          </UButton>
          <UButton color="error" class="flex-1 justify-center" @click="removeProduct">
            Supprimer
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
