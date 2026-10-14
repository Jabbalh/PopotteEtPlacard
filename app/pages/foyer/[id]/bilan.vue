<script setup lang="ts">
import type { Lot } from '~/composables/useStock'

const route = useRoute()
const householdId = computed(() => route.params.id as string)

const { locations, foodTypeById } = useHouseholdOptions(householdId)
const { lots, byProduct, allLots } = useStock(householdId)
const db = useDb()

// --- État des stocks par lieu de stockage ---
interface LocationReport {
  id: string | null
  label: string
  icon: string
  products: number
  lots: number
  expired: number
  soon: number
  types: { label: string, count: number }[]
}

function report(id: string | null, label: string, icon: string, list: Lot[]): LocationReport {
  const types = new Map<string, number>()
  for (const l of list) {
    const t = (l.product.food_type_id && foodTypeById.value.get(l.product.food_type_id)?.label) || 'Sans type'
    types.set(t, (types.get(t) ?? 0) + 1)
  }
  return {
    id,
    label,
    icon,
    products: new Set(list.map(l => l.product.id)).size,
    lots: list.length,
    expired: list.filter(l => l.item.expires_on && daysUntil(l.item.expires_on) < 0).length,
    soon: list.filter(l => l.item.expires_on && daysUntil(l.item.expires_on) >= 0 && daysUntil(l.item.expires_on) <= 3).length,
    types: [...types.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count)
  }
}

const reports = computed(() => {
  const known = new Set(locations.value.map(l => l.id))
  const list = locations.value.map(l => report(l.id, l.label, l.icon || 'i-lucide-package', lots.value.filter(x => x.item.location_id === l.id)))
  const orphans = lots.value.filter(x => !x.item.location_id || !known.has(x.item.location_id))
  if (orphans.length) list.push(report(null, 'Sans lieu', 'i-lucide-circle-help', orphans))
  return list
})

const totals = computed(() => ({
  products: new Set(lots.value.map(l => l.product.id)).size,
  expired: reports.value.reduce((s, r) => s + r.expired, 0),
  soon: reports.value.reduce((s, r) => s + r.soon, 0)
}))

// --- Favoris en rupture ou proches de la rupture ---
const favorites = computed(() => byProduct.value
  .filter(s => s.product.rating > 0 && s.total <= s.product.low_threshold)
  .sort((a, b) => a.total - b.total || b.product.rating - a.product.rating || a.product.name.localeCompare(b.product.name)))

// --- Sorties des 30 derniers jours ---
const { data: recent } = useLiveQuery(async () => {
  const since = toDateKey(new Date(Date.now() - 30 * 86_400_000))
  const rows = await db.movements.where('household_id').equals(householdId.value).toArray()
  const counts = { used: 0, thrown: 0, given: 0 }
  for (const m of rows) {
    if (m.deleted_at || m.kind === 'adjusted' || m.occurred_on < since) continue
    counts[m.kind]++
  }
  return counts
}, { used: 0, thrown: 0, given: 0 }, [householdId])

const lotsCount = computed(() => allLots.value.length)

const addOpen = ref(false)
const addProductId = ref<string | null>(null)
function restock(productId: string) {
  addProductId.value = productId
  addOpen.value = true
}

function goTo(locationId: string | null) {
  useState<string | null>(`pep:loc:${householdId.value}`).value = locationId
  navigateTo(`/foyer/${householdId.value}`)
}
</script>

<template>
  <div class="space-y-5">
    <h1 class="text-2xl font-bold">
      Bilan
    </h1>

    <div class="grid grid-cols-3 gap-2 text-center">
      <div class="rounded-xl border border-default p-3">
        <p class="text-2xl font-bold">
          {{ totals.products }}
        </p>
        <p class="text-xs text-muted">
          produits en stock
        </p>
      </div>
      <div class="rounded-xl border border-default p-3" :class="totals.soon ? 'border-warning/50 bg-warning/5' : ''">
        <p class="text-2xl font-bold" :class="totals.soon ? 'text-warning' : ''">
          {{ totals.soon }}
        </p>
        <p class="text-xs text-muted">
          périment sous 3 j
        </p>
      </div>
      <div class="rounded-xl border border-default p-3" :class="totals.expired ? 'border-error/50 bg-error/5' : ''">
        <p class="text-2xl font-bold" :class="totals.expired ? 'text-error' : ''">
          {{ totals.expired }}
        </p>
        <p class="text-xs text-muted">
          périmés
        </p>
      </div>
    </div>

    <!-- Favoris -->
    <UCard>
      <template #header>
        <h2 class="font-semibold flex items-center gap-2">
          <UIcon name="i-lucide-star" class="text-amber-400" /> Favoris à racheter
        </h2>
        <p class="text-sm text-muted">
          Aliments favoris en rupture ou sous leur seuil d'alerte.
        </p>
      </template>
      <p v-if="!favorites.length" class="text-sm text-muted">
        Tous vos favoris sont en stock. 👌
      </p>
      <ul v-else class="divide-y divide-default -my-2">
        <li v-for="f in favorites" :key="f.product.id" class="py-2.5 flex items-center gap-3">
          <NuxtLink :to="`/foyer/${householdId}/produit/${f.product.id}`" class="flex-1 min-w-0">
            <p class="font-medium truncate">
              {{ f.product.name }}
            </p>
            <div class="flex items-center gap-2">
              <StarRating :model-value="f.product.rating" readonly size="sm" />
              <UBadge :color="f.total <= 0 ? 'error' : 'warning'" variant="subtle" size="sm">
                {{ f.total <= 0 ? 'Rupture' : `Reste ${formatQuantity(f.total, f.product.unit)}` }}
              </UBadge>
            </div>
          </NuxtLink>
          <UButton icon="i-lucide-plus" size="sm" color="neutral" variant="soft" aria-label="Racheter" @click="restock(f.product.id)" />
        </li>
      </ul>
    </UCard>

    <!-- Par lieu de stockage -->
    <section class="space-y-2">
      <h2 class="font-semibold">
        Par lieu de stockage
      </h2>
      <button
        v-for="r in reports"
        :key="r.id ?? 'none'"
        type="button"
        class="w-full text-left rounded-xl border border-default bg-elevated/40 p-3 space-y-2 hover:bg-elevated transition"
        @click="goTo(r.id)"
      >
        <div class="flex items-center gap-2">
          <UIcon :name="r.icon" class="size-5 text-primary" />
          <p class="font-semibold flex-1">
            {{ r.label }}
          </p>
          <span class="text-sm text-muted">{{ r.products }} produit(s) · {{ r.lots }} lot(s)</span>
        </div>
        <div v-if="r.expired || r.soon" class="flex gap-1.5">
          <UBadge v-if="r.expired" color="error" variant="subtle" size="sm">
            {{ r.expired }} périmé(s)
          </UBadge>
          <UBadge v-if="r.soon" color="warning" variant="subtle" size="sm">
            {{ r.soon }} à consommer vite
          </UBadge>
        </div>
        <div v-if="r.types.length" class="flex flex-wrap gap-1">
          <UBadge v-for="t in r.types" :key="t.label" color="neutral" variant="outline" size="sm">
            {{ t.label }} · {{ t.count }}
          </UBadge>
        </div>
        <p v-else class="text-xs text-muted">
          Vide
        </p>
      </button>
    </section>

    <!-- Activité -->
    <UCard v-if="lotsCount">
      <template #header>
        <h2 class="font-semibold">
          30 derniers jours
        </h2>
      </template>
      <div class="grid grid-cols-3 gap-2 text-center">
        <div v-for="k in MOVEMENT_KINDS" :key="k.value">
          <UIcon :name="k.icon" class="size-5" :class="`text-${k.color}`" />
          <p class="text-xl font-bold">
            {{ recent[k.value] }}
          </p>
          <p class="text-xs text-muted">
            {{ k.past }}(s)
          </p>
        </div>
      </div>
    </UCard>

    <AddStockModal v-model:open="addOpen" :household-id="householdId" :product-id="addProductId" />
  </div>
</template>
