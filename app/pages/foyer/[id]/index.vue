<script setup lang="ts">
import type { Lot, StockGrouping, TakeLine } from '~/composables/useStock'
import type { PersonOpinion } from '~/composables/useSuggestions'
import type { Product } from '~/utils/db'

const route = useRoute()
const householdId = computed(() => route.params.id as string)

const { household, loading } = useHousehold(householdId)
const { locations, locationById, foodTypeById } = useHouseholdOptions(householdId)
const { lots, loading: stockLoading } = useStock(householdId)
const { opinionsOn } = useOpinions(householdId)
const { pendingLines } = usePendingReceipt(householdId)

/** Préférences du foyer sur un produit : une par personne (la plus forte), allergies d'abord */
const LEVEL_ORDER = ['allergy', 'dislike', 'love', 'like']
const opinionsByProduct = computed(() => {
  const map = new Map<string, PersonOpinion[]>()
  for (const l of lots.value) {
    if (map.has(l.product.id)) continue
    const byPerson = new Map<string, PersonOpinion>()
    for (const o of opinionsOn(l.product.name, [l.product.barcode])) {
      const current = byPerson.get(o.person.id)
      if (!current || LEVEL_ORDER.indexOf(o.level) < LEVEL_ORDER.indexOf(current.level)) byPerson.set(o.person.id, o)
    }
    map.set(l.product.id, [...byPerson.values()].sort((a, b) => LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level) || a.person.name.localeCompare(b.person.name)))
  }
  return map
})
const opinionsOf = (p: Product) => opinionsByProduct.value.get(p.id) ?? []

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

// --- Groupement (préférence de l'appareil, non synchronisée) ---
const grouping = useStockGrouping()
const groupingItems: { label: string, value: StockGrouping, icon: string }[] = [
  { label: 'Sans groupement', value: 'none', icon: 'i-lucide-list' },
  { label: 'Par rangement', value: 'location', icon: 'i-lucide-warehouse' },
  { label: 'Par type d\'aliment', value: 'foodType', icon: 'i-lucide-tags' },
  { label: 'Par aliment', value: 'generic', icon: 'i-lucide-carrot' },
  { label: 'Par péremption', value: 'expiry', icon: 'i-lucide-calendar-clock' }
]
const groupingIcon = computed(() => groupingItems.find(i => i.value === grouping.value)?.icon)

// groupes repliés (préférence de l'appareil, par foyer et par groupement) ; une recherche déplie tout
const { collapsed, toggle: toggleGroup, setCollapsed } = useStockCollapsed(householdId, grouping)
const isOpen = (key: string) => !!search.value.trim() || !collapsed.value.has(key)

/** Rangement encore actif d'un lot (null = sans rangement) */
function activeLocationId(l: Lot): string | null {
  const loc = l.item.location_id ? locationById.value.get(l.item.location_id) : undefined
  return loc && !loc.deleted_at ? loc.id : null
}

const rows = computed<Row[]>(() => {
  const q = search.value.trim()
  // groupé par rangement : une ligne par produit et par rangement
  const byLocation = grouping.value === 'location'
  const groups = new Map<string, Row>()
  for (const l of lots.value) {
    if (location.value && l.item.location_id !== location.value) continue
    if (q && !(matches(q, l.product.name) || l.product.name.toLowerCase().includes(q.toLowerCase()) || l.product.brand.toLowerCase().includes(q.toLowerCase()))) continue
    const key = byLocation ? `${l.product.id}|${activeLocationId(l) ?? ''}` : l.product.id
    const row = groups.get(key) ?? { product: l.product, lots: [], total: 0, nextExpiry: null }
    row.lots.push(l)
    row.total = Math.round((row.total + l.remaining) * 1000) / 1000
    if (l.item.expires_on && (!row.nextExpiry || l.item.expires_on < row.nextExpiry)) row.nextExpiry = l.item.expires_on
    groups.set(key, row)
  }
  const list = [...groups.values()]
  return sort.value === 'name'
    ? list.sort((a, b) => a.product.name.localeCompare(b.product.name))
    : list.sort((a, b) => (a.nextExpiry ?? '9999').localeCompare(b.nextExpiry ?? '9999') || a.product.name.localeCompare(b.product.name))
})

interface Group {
  key: string
  label: string
  icon?: string
  rows: Row[]
}

/** Tranches de péremption (date la plus proche du produit) */
const EXPIRY_BUCKETS = [
  { key: 'expired', label: 'Périmé', icon: 'i-lucide-circle-alert', test: (d: number) => d < 0 },
  { key: 'soon', label: 'Dans les 3 jours', icon: 'i-lucide-alarm-clock', test: (d: number) => d <= 3 },
  { key: 'week', label: 'Cette semaine', icon: 'i-lucide-calendar-days', test: (d: number) => d <= 7 },
  { key: 'month', label: 'Ce mois-ci', icon: 'i-lucide-calendar', test: (d: number) => d <= 31 },
  { key: 'later', label: 'Plus tard', icon: 'i-lucide-calendar-check', test: () => true }
]

const groups = computed<Group[]>(() => {
  const mode = grouping.value
  if (mode === 'none') return [{ key: 'all', label: '', rows: rows.value }]

  const map = new Map<string, Group>()
  /** ordre d'affichage des groupes (rang, puis libellé) ; « sans … » toujours en dernier */
  const rank = new Map<string, number>()
  const add = (key: string, label: string, order: number, row: Row, icon?: string) => {
    let g = map.get(key)
    if (!g) {
      g = { key, label, icon, rows: [] }
      map.set(key, g)
      rank.set(key, order)
    }
    g.rows.push(row)
  }

  for (const row of rows.value) {
    if (mode === 'location') {
      const locId = row.lots[0] ? activeLocationId(row.lots[0]) : null
      const loc = locId ? locationById.value.get(locId) : undefined
      if (loc) add(loc.id, loc.label, loc.position, row, loc.icon || 'i-lucide-package')
      else add('', 'Sans rangement', Infinity, row, 'i-lucide-package-open')
    } else if (mode === 'foodType') {
      const ft = row.product.food_type_id ? foodTypeById.value.get(row.product.food_type_id) : undefined
      if (ft && !ft.deleted_at) add(ft.id, ft.label, ft.position, row, 'i-lucide-tag')
      else add('', 'Sans type', Infinity, row, 'i-lucide-tag')
    } else if (mode === 'generic') {
      const name = row.product.generic_name.trim()
      if (name) add(`g:${tokens(name).join(' ') || name.toLowerCase()}`,name.charAt(0).toUpperCase() + name.slice(1), 0, row, 'i-lucide-carrot')
      else add('', 'Aliment non renseigné', Infinity, row, 'i-lucide-carrot')
    } else {
      if (!row.nextExpiry) {
        add('none', 'Sans date', Infinity, row, 'i-lucide-calendar-off')
        continue
      }
      const d = daysUntil(row.nextExpiry)
      const i = EXPIRY_BUCKETS.findIndex(b => b.test(d))
      const b = EXPIRY_BUCKETS[i]!
      add(b.key, b.label, i, row, b.icon)
    }
  }
  return [...map.values()].sort((a, b) => rank.get(a.key)! - rank.get(b.key)! || a.label.localeCompare(b.label))
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
        <UButton icon="i-lucide-receipt" color="neutral" variant="soft" :to="`/foyer/${householdId}/ticket`">
          Ticket
        </UButton>
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
      <USelect
        v-model="grouping"
        :items="groupingItems"
        :icon="groupingIcon"
        size="sm"
        color="neutral"
        variant="soft"
        aria-label="Grouper les aliments"
        title="Grouper les aliments"
        class="w-auto"
        :ui="{ content: 'min-w-48' }"
      />
    </div>

    <!-- Ticket de caisse en cours de saisie dans le foyer -->
    <UAlert
      v-if="pendingLines"
      icon="i-lucide-receipt"
      color="warning"
      variant="subtle"
      :title="`Ticket de caisse en cours : ${pendingLines} article${pendingLines > 1 ? 's' : ''} en attente`"
      :actions="[{ label: 'Continuer', to: `/foyer/${householdId}/ticket`, color: 'warning', variant: 'solid', size: 'xs' }]"
    />

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
        { label: 'Manuel', icon: 'i-lucide-plus', color: 'neutral', variant: 'soft', onClick: () => openAdd(false) },
        { label: 'Ticket de caisse', icon: 'i-lucide-receipt', color: 'neutral', variant: 'soft', to: `/foyer/${householdId}/ticket` }
      ]"
    />

    <p v-else-if="!rows.length" class="text-sm text-muted text-center py-6">
      Aucun aliment ne correspond.
    </p>

    <div v-else :class="grouping === 'none' ? '' : 'space-y-3'">
      <div v-if="grouping !== 'none' && groups.length > 1 && !search.trim()" class="flex justify-end -mb-2">
        <UButton
          v-if="groups.some(g => !collapsed.has(g.key))"
          icon="i-lucide-chevrons-down-up"
          size="xs"
          color="neutral"
          variant="link"
          @click="setCollapsed(groups.map(g => g.key))"
        >
          Tout replier
        </UButton>
        <UButton
          v-else
          icon="i-lucide-chevrons-up-down"
          size="xs"
          color="neutral"
          variant="link"
          @click="setCollapsed([])"
        >
          Tout déplier
        </UButton>
      </div>
      <section v-for="g in groups" :key="g.key" class="space-y-2">
        <h2 v-if="grouping !== 'none'">
          <button
            type="button"
            class="flex w-full items-center gap-2 py-1 text-sm font-semibold text-muted enabled:hover:text-default"
            :aria-expanded="isOpen(g.key)"
            :disabled="!!search.trim()"
            @click="toggleGroup(g.key)"
          >
            <UIcon name="i-lucide-chevron-right" class="size-4 transition-transform" :class="isOpen(g.key) && 'rotate-90'" />
            <UIcon v-if="g.icon" :name="g.icon" class="size-4" />
            {{ g.label }}
            <span class="font-normal">· {{ g.rows.length }}</span>
          </button>
        </h2>
        <ul v-show="grouping === 'none' || isOpen(g.key)" class="grid grid-cols-1 gap-2 md:grid-cols-2">
          <li
            v-for="row in g.rows"
            :key="`${row.product.id}|${row.lots[0]?.item.id}`"
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
                  <template v-if="!location && grouping !== 'location'">
                    <span v-for="l in locationsOf(row)" :key="l!.id"> · {{ l!.label }}</span>
                  </template>
                </p>
                <div v-if="row.nextExpiry || opinionsOf(row.product).length" class="flex flex-wrap items-center gap-1 mt-1">
                  <UBadge
                    v-if="row.nextExpiry"
                    :color="expiryInfo(row.nextExpiry).color"
                    variant="subtle"
                    size="sm"
                  >
                    {{ expiryInfo(row.nextExpiry).label }}
                  </UBadge>
                  <!-- préférences des personnes du foyer (une par personne, la plus forte) -->
                  <UBadge
                    v-for="o in opinionsOf(row.product).slice(0, 3)"
                    :key="o.person.id"
                    :color="preferenceLevel(o.level).color"
                    :icon="preferenceLevel(o.level).icon"
                    variant="outline"
                    size="sm"
                    :title="`${o.person.name} : ${preferenceLevel(o.level).label.toLowerCase()} « ${o.label} »`"
                  >
                    {{ o.person.name }}
                  </UBadge>
                  <span v-if="opinionsOf(row.product).length > 3" class="text-xs text-muted">
                    +{{ opinionsOf(row.product).length - 3 }}
                  </span>
                </div>
              </div>
            </NuxtLink>
            <UButton icon="i-lucide-minus" color="neutral" variant="soft" aria-label="Retirer du stock" @click="take(row)" />
          </li>
        </ul>
      </section>
    </div>

    <!-- Boutons d'ajout -->
    <div class="fixed z-20 right-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] flex lg:hidden flex-col items-end gap-2">
      <UButton icon="i-lucide-receipt" color="neutral" variant="solid" size="lg" class="rounded-full shadow-lg" :to="`/foyer/${householdId}/ticket`">
        Ticket
      </UButton>
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
