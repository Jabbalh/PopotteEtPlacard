<script setup lang="ts">
import type { Lot, TakeLine } from '~/composables/useStock'
import type { Product } from '~/utils/db'

const route = useRoute()
const householdId = computed(() => route.params.id as string)

const { household, loading } = useHousehold(householdId)
const { locations, locationById, foodTypeById } = useHouseholdOptions(householdId)
const { lots, loading: stockLoading } = useStock(householdId)

onMounted(() => {
  try {
    localStorage.setItem('pep:lastHousehold', householdId.value)
  } catch { /* ignore */ }
})

// --- Filtres (mémorisés par foyer pour la session) ---
const location = useState<string | null>(`pep:loc:${householdId.value}`, () => null)
const search = ref('')
const sort = useState<'expiry' | 'name'>('pep:sort', () => 'expiry')

const countByLocation = computed(() => {
  const map = new Map<string | null, number>()
  for (const l of lots.value) {
    const key = l.item.location_id && locationById.value.get(l.item.location_id) && !locationById.value.get(l.item.location_id)!.deleted_at ? l.item.location_id : null
    map.set(key, (map.get(key) ?? 0) + 1)
  }
  return map
})

interface Row {
  product: Product
  lots: Lot[]
  total: number
  nextExpiry: string | null
}

const rows = computed<Row[]>(() => {
  const q = search.value.trim()
  const groups = new Map<string, Row>()
  for (const l of lots.value) {
    if (location.value && l.item.location_id !== location.value) continue
    if (q && !(matches(q, l.product.name) || l.product.name.toLowerCase().includes(q.toLowerCase()) || l.product.brand.toLowerCase().includes(q.toLowerCase()))) continue
    const row = groups.get(l.product.id) ?? { product: l.product, lots: [], total: 0, nextExpiry: null }
    row.lots.push(l)
    row.total = Math.round((row.total + l.remaining) * 1000) / 1000
    if (l.item.expires_on && (!row.nextExpiry || l.item.expires_on < row.nextExpiry)) row.nextExpiry = l.item.expires_on
    groups.set(l.product.id, row)
  }
  const list = [...groups.values()]
  return sort.value === 'name'
    ? list.sort((a, b) => a.product.name.localeCompare(b.product.name))
    : list.sort((a, b) => (a.nextExpiry ?? '9999').localeCompare(b.nextExpiry ?? '9999') || a.product.name.localeCompare(b.product.name))
})

function locationsOf(row: Row) {
  const ids = [...new Set(row.lots.map(l => l.item.location_id))]
  return ids.map(id => (id ? locationById.value.get(id) : undefined)).filter(Boolean)
}

// --- Ajout ---
const addOpen = ref(false)
const addScan = ref(false)
function openAdd(scan: boolean) {
  addScan.value = scan
  addOpen.value = true
}

// --- Sortie de stock ---
const takeOpen = ref(false)
const takeLines = ref<TakeLine[]>([])
function take(row: Row) {
  // le lot le plus urgent est présélectionné
  takeLines.value = row.lots.map((lot, i) => ({ lot, selected: i === 0 }))
  takeOpen.value = true
}
</script>

<template>
  <div v-if="!loading && !household" class="py-10">
    <UEmpty
      icon="i-lucide-house"
      title="Foyer introuvable"
      description="Il a peut-être été supprimé ou vous n'en faites plus partie."
      :actions="[{ label: 'Mes foyers', to: '/' }]"
    />
  </div>

  <div v-else class="space-y-4">
    <div class="flex items-center gap-2">
      <div class="min-w-0 flex-1">
        <p class="text-sm text-muted truncate">
          {{ household?.name }}
        </p>
        <h1 class="text-2xl font-bold">
          Stock
        </h1>
      </div>
      <!-- PC : boutons d'ajout dans l'en-tête (boutons flottants sur mobile et tablette) -->
      <div class="hidden lg:flex items-center gap-2">
        <UButton icon="i-lucide-plus" color="neutral" variant="soft" @click="openAdd(false)">
          Manuel
        </UButton>
        <UButton icon="i-lucide-scan-barcode" @click="openAdd(true)">
          Scanner
        </UButton>
      </div>
      <UButton
        :icon="sort === 'expiry' ? 'i-lucide-calendar-clock' : 'i-lucide-arrow-down-a-z'"
        color="neutral"
        variant="soft"
        size="sm"
        @click="sort = sort === 'expiry' ? 'name' : 'expiry'"
      >
        {{ sort === 'expiry' ? 'Péremption' : 'Nom' }}
      </UButton>
    </div>

    <UInput v-model="search" icon="i-lucide-search" placeholder="Rechercher un aliment" class="w-full" :ui="{ trailing: 'pe-1' }">
      <template v-if="search" #trailing>
        <UButton icon="i-lucide-x" size="xs" color="neutral" variant="link" aria-label="Effacer" @click="search = ''" />
      </template>
    </UInput>

    <!-- Filtre par lieu de stockage -->
    <div class="flex gap-2 overflow-x-auto -mx-4 px-4 pb-1 no-scrollbar md:flex-wrap md:overflow-visible md:mx-0 md:px-0">
      <UButton
        size="sm"
        class="rounded-full shrink-0"
        :color="!location ? 'primary' : 'neutral'"
        :variant="!location ? 'solid' : 'outline'"
        @click="location = null"
      >
        Tout · {{ lots.length }}
      </UButton>
      <UButton
        v-for="l in locations"
        :key="l.id"
        size="sm"
        class="rounded-full shrink-0"
        :icon="l.icon || 'i-lucide-package'"
        :color="location === l.id ? 'primary' : 'neutral'"
        :variant="location === l.id ? 'solid' : 'outline'"
        @click="location = location === l.id ? null : l.id"
      >
        {{ l.label }} · {{ countByLocation.get(l.id) ?? 0 }}
      </UButton>
    </div>

    <div v-if="stockLoading" class="grid grid-cols-1 gap-2 md:grid-cols-2">
      <USkeleton v-for="i in 4" :key="i" class="h-16 w-full" />
    </div>

    <UEmpty
      v-else-if="!lots.length"
      icon="i-lucide-refrigerator"
      title="Le stock est vide"
      description="Scannez le code-barres d'un produit ou saisissez-le pour commencer."
      :actions="[
        { label: 'Scanner', icon: 'i-lucide-scan-barcode', onClick: () => openAdd(true) },
        { label: 'Manuel', icon: 'i-lucide-plus', color: 'neutral', variant: 'soft', onClick: () => openAdd(false) }
      ]"
    />

    <p v-else-if="!rows.length" class="text-sm text-muted text-center py-6">
      Aucun aliment ne correspond.
    </p>

    <ul v-else class="grid grid-cols-1 gap-2 md:grid-cols-2">
      <li
        v-for="row in rows"
        :key="row.product.id"
        class="flex items-center gap-3 p-3 rounded-xl border border-default bg-elevated/40"
      >
        <NuxtLink :to="`/foyer/${householdId}/produit/${row.product.id}`" class="flex items-center gap-3 flex-1 min-w-0">
          <img v-if="row.product.image_url" :src="row.product.image_url" alt="" class="size-11 rounded-lg object-contain bg-white shrink-0" loading="lazy">
          <div v-else class="size-11 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <UIcon name="i-lucide-carrot" class="size-5" />
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5">
              <p class="font-medium truncate">
                {{ row.product.name }}
              </p>
              <NutriscoreBadge :value="row.product.nutriscore" size="sm" />
              <StarRating v-if="row.product.rating" :model-value="row.product.rating" readonly size="sm" class="shrink-0" />
            </div>
            <p class="text-xs text-muted truncate">
              {{ formatQuantity(row.total, row.product.unit) }}
              <template v-if="row.lots.length > 1">
                ({{ row.lots.length }} lots)
              </template>
              <template v-if="row.product.food_type_id && foodTypeById.get(row.product.food_type_id)">
                · {{ foodTypeById.get(row.product.food_type_id)!.label }}
              </template>
              <template v-if="!location">
                <span v-for="l in locationsOf(row)" :key="l!.id"> · {{ l!.label }}</span>
              </template>
            </p>
            <UBadge
              v-if="row.nextExpiry"
              :color="expiryInfo(row.nextExpiry).color"
              variant="subtle"
              size="sm"
              class="mt-1"
            >
              {{ expiryInfo(row.nextExpiry).label }}
            </UBadge>
          </div>
        </NuxtLink>
        <UButton icon="i-lucide-minus" color="neutral" variant="soft" aria-label="Retirer du stock" @click="take(row)" />
      </li>
    </ul>

    <!-- Boutons d'ajout -->
    <div class="fixed z-20 right-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] flex lg:hidden flex-col items-end gap-2">
      <UButton icon="i-lucide-plus" color="neutral" variant="solid" size="lg" class="rounded-full shadow-lg" @click="openAdd(false)">
        Manuel
      </UButton>
      <UButton icon="i-lucide-scan-barcode" size="xl" class="rounded-full shadow-lg" @click="openAdd(true)">
        Scanner
      </UButton>
    </div>

    <AddStockModal v-model:open="addOpen" :household-id="householdId" :scan="addScan" :location-id="location" />
    <TakeStockModal v-model:open="takeOpen" :household-id="householdId" :lines="takeLines" />
  </div>
</template>

<style scoped>
.no-scrollbar::-webkit-scrollbar { display: none; }
.no-scrollbar { scrollbar-width: none; }
</style>
