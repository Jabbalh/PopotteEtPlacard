<script setup lang="ts">
import type { Product, ReceiptLine } from '~/utils/db'

/**
 * Une ligne de ticket de caisse en attente : quantité, produit associé
 * (reconnu, proposé, choisi par recherche ou scan, ou nouveau produit), rangement et péremption.
 */
const props = defineProps<{
  line: ReceiptLine
  receipt: ReturnType<typeof useReceipt>
}>()
const emit = defineEmits<{ scan: [] }>()

const r = props.receipt
const line = computed(() => props.line)
const product = computed(() => (line.value.product_id ? r.productById.value.get(line.value.product_id) : undefined))
const status = computed(() => lineStatus(line.value))
const unit = computed(() => product.value?.unit ?? line.value.new_product?.unit ?? (line.value.weighed ? 'kg' : 'pièce'))

const suggestions = computed(() => (line.value.product_id || line.value.new_product || line.value.ignored ? [] : r.suggestionsFor(line.value)))

const searching = ref(false)
const query = ref('')
const results = computed(() => {
  const q = query.value.trim()
  if (q.length < 2) return []
  return r.products.value
    .filter(p => matches(q, p.name) || p.name.toLowerCase().includes(q.toLowerCase()) || p.brand.toLowerCase().includes(q.toLowerCase()))
    .slice(0, 6)
})

function update(changes: Partial<ReceiptLine>) {
  return r.updateLine(line.value.id, changes)
}

function choose(p: Product) {
  searching.value = false
  query.value = ''
  update({ product_id: p.id, match: 'manual', new_product: null, location_id: null })
}

function unlink() {
  update({ product_id: null, match: null, new_product: null, location_id: null, expires_on: null })
}

function createNew() {
  searching.value = false
  update({
    product_id: null,
    match: null,
    new_product: {
      name: productNameFromLabel(line.value.label),
      barcode: null,
      brand: '',
      description: '',
      ingredients: '',
      nutriscore: null,
      image_url: null,
      unit: line.value.weighed ? 'kg' : 'pièce',
      food_type_id: null
    }
  })
}

function updateNew(changes: Partial<NonNullable<ReceiptLine['new_product']>>) {
  if (!line.value.new_product) return
  update({ new_product: { ...line.value.new_product, ...changes } })
}

/** Nom du nouveau produit : saisie locale, enregistrée en quittant le champ */
const newName = ref('')
watch(() => line.value.new_product?.name, (name) => {
  newName.value = name ?? ''
}, { immediate: true })
function saveNewName() {
  if (line.value.new_product && newName.value !== line.value.new_product.name) updateNew({ name: newName.value })
}

const quantity = computed({
  get: () => Number(line.value.quantity),
  set: (v: number | null) => update({ quantity: v ?? 0 })
})

/** prix total de la ligne (lu sur le ticket, modifiable, facultatif) */
const price = computed({
  get: () => (line.value.price === null ? null : Number(line.value.price)),
  set: (v: number | null) => update({ price: v ?? null })
})
/** prix unitaire, si la quantité n'est pas 1 (ex. 3 yaourts, article pesé) */
const lotUnitPrice = computed(() => {
  const q = lineQuantity(line.value, unit.value)
  return q !== 1 ? unitPrice(line.value.price, q, unit.value) : null
})

const locationId = computed(() => r.locationOf(line.value))
const freezer = computed(() => r.freezerLimitOf(line.value))
const foodTypeItems = computed(() => r.foodTypes.value.map(t => ({ label: t.label, value: t.id })))
const unitItems = UNITS.map(u => ({ label: u, value: u }))
</script>

<template>
  <li
    class="p-3 rounded-xl border bg-elevated/40 space-y-3"
    :class="status === 'ready' ? 'border-primary/40' : status === 'ignored' ? 'border-default opacity-60' : 'border-default'"
  >
    <!-- Libellé du ticket -->
    <div class="flex items-start gap-2">
      <UIcon
        :name="status === 'ready' ? 'i-lucide-circle-check' : status === 'ignored' ? 'i-lucide-circle-slash' : 'i-lucide-circle-dashed'"
        class="size-5 shrink-0 mt-0.5"
        :class="status === 'ready' ? 'text-primary' : 'text-muted'"
      />
      <div class="flex-1 min-w-0">
        <p class="font-mono text-sm break-words" :class="{ 'line-through': line.ignored }">
          {{ line.label }}
        </p>
        <p v-if="line.ignored && line.price !== null" class="text-xs text-muted">
          {{ formatPrice(Number(line.price)) }}
        </p>
      </div>
      <UButton
        v-if="line.ignored"
        size="xs"
        color="neutral"
        variant="soft"
        icon="i-lucide-undo-2"
        @click="update({ ignored: false })"
      >
        Rétablir
      </UButton>
      <UButton
        v-else
        size="xs"
        color="neutral"
        variant="ghost"
        icon="i-lucide-eye-off"
        title="Ignorer cette ligne (sac, article non alimentaire…) : mémorisé pour les prochains tickets"
        @click="update({ ignored: true })"
      >
        Ignorer
      </UButton>
      <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-x" aria-label="Retirer la ligne" @click="r.removeLine(line.id)" />
    </div>

    <template v-if="!line.ignored">
      <!-- Produit associé -->
      <div v-if="product" class="flex items-center gap-3 p-2 rounded-lg bg-default border border-default">
        <img v-if="product.image_url" :src="product.image_url" alt="" class="size-10 rounded object-contain bg-white shrink-0">
        <UIcon v-else name="i-lucide-package" class="size-6 text-muted shrink-0" />
        <div class="flex-1 min-w-0">
          <p class="font-medium truncate">
            {{ product.name }}
          </p>
          <p class="text-xs truncate" :class="line.match === 'guess' ? 'text-warning' : 'text-muted'">
            <template v-if="line.match === 'alias'">
              Reconnu (déjà associé à ce libellé)
            </template>
            <template v-else-if="line.match === 'guess'">
              Proposé d'après le nom : à vérifier
            </template>
            <template v-else>
              {{ product.brand || 'Produit du foyer' }}
            </template>
          </p>
        </div>
        <UButton icon="i-lucide-x" size="sm" color="neutral" variant="ghost" aria-label="Autre produit" @click="unlink" />
      </div>

      <!-- Nouveau produit -->
      <div v-else-if="line.new_product" class="space-y-3 p-2 rounded-lg bg-default border border-default">
        <div class="flex items-center gap-2">
          <img v-if="line.new_product.image_url" :src="line.new_product.image_url" alt="" class="size-10 rounded object-contain bg-white shrink-0">
          <UFormField label="Nouveau produit" class="flex-1">
            <UInput v-model="newName" class="w-full" placeholder="Nom du produit" @blur="saveNewName" @keydown.enter="saveNewName" />
          </UFormField>
          <UButton icon="i-lucide-x" size="sm" color="neutral" variant="ghost" aria-label="Annuler" class="self-end" @click="unlink" />
        </div>
        <p v-if="line.new_product.barcode" class="text-xs text-muted -mt-2">
          Code-barres {{ line.new_product.barcode }}{{ line.new_product.brand ? ` · ${line.new_product.brand}` : '' }}
        </p>
        <div class="grid grid-cols-2 gap-2">
          <UFormField label="Unité">
            <USelect :model-value="line.new_product.unit" :items="unitItems" class="w-full" @update:model-value="v => updateNew({ unit: String(v) })" />
          </UFormField>
          <UFormField label="Type d'aliment">
            <USelect
              :model-value="line.new_product.food_type_id ?? undefined"
              :items="foodTypeItems"
              placeholder="Choisir…"
              class="w-full"
              @update:model-value="v => updateNew({ food_type_id: (v as string) ?? null })"
            />
          </UFormField>
        </div>
      </div>

      <!-- À associer -->
      <div v-else class="space-y-2">
        <div v-if="suggestions.length" class="space-y-1">
          <p class="text-xs text-muted">
            Déjà acheté :
          </p>
          <div class="flex flex-wrap gap-1.5">
            <UButton
              v-for="s in suggestions"
              :key="s.product.id"
              size="xs"
              color="neutral"
              variant="outline"
              icon="i-lucide-history"
              @click="choose(s.product)"
            >
              {{ s.product.name }}
            </UButton>
          </div>
        </div>

        <div v-if="searching" class="space-y-1.5">
          <UInput v-model="query" icon="i-lucide-search" placeholder="Rechercher un produit déjà acheté" class="w-full" autofocus />
          <div v-if="results.length" class="flex flex-wrap gap-1.5">
            <UButton v-for="p in results" :key="p.id" size="xs" color="neutral" variant="outline" @click="choose(p)">
              {{ p.name }}
            </UButton>
          </div>
          <p v-else-if="query.trim().length >= 2" class="text-xs text-muted">
            Aucun produit trouvé.
          </p>
        </div>

        <div class="flex flex-wrap gap-1.5">
          <UButton size="sm" color="neutral" variant="soft" icon="i-lucide-search" @click="searching = !searching">
            Chercher
          </UButton>
          <UButton size="sm" color="neutral" variant="soft" icon="i-lucide-scan-barcode" @click="emit('scan')">
            Scanner
          </UButton>
          <UButton size="sm" color="neutral" variant="soft" icon="i-lucide-plus" @click="createNew">
            Nouveau produit
          </UButton>
        </div>
      </div>

      <!-- Lot -->
      <div class="grid grid-cols-2 gap-2">
        <UFormField :label="`Quantité (${unit === 'pièce' ? 'pièces' : unit})`">
          <UInputNumber v-model="quantity" :min="0" :step="1" :step-snapping="false" class="w-full" />
        </UFormField>
        <UFormField label="Prix payé" :hint="lotUnitPrice ? lotUnitPrice.label : undefined">
          <UInputNumber
            v-model="price"
            :min="0"
            :step="0.01"
            :step-snapping="false"
            :format-options="{ style: 'currency', currency: 'EUR' }"
            placeholder="—"
            class="w-full"
          />
        </UFormField>
        <UFormField label="Péremption">
          <UInput :model-value="line.expires_on ?? ''" type="date" class="w-full" @update:model-value="v => update({ expires_on: String(v) || null })" />
        </UFormField>
      </div>
      <p v-if="line.weighed && unit !== 'kg'" class="-mt-1 text-xs text-muted">
        Article pesé : quantité lue en kg{{ unit === 'g' ? ', convertie en grammes' : '' }}.
      </p>
      <p v-if="freezer && !line.expires_on" class="-mt-1 text-xs text-muted flex items-start gap-1">
        <UIcon name="i-lucide-snowflake" class="size-3.5 shrink-0 mt-px text-info" />
        {{ freezer.type }} au congélateur : jusqu'au {{ formatDate(freezer.date) }}.
      </p>

      <div v-if="status === 'ready' || product || line.new_product" class="flex flex-wrap gap-1.5">
        <UButton
          v-for="l in r.locations.value"
          :key="l.id"
          size="xs"
          :icon="l.icon || 'i-lucide-package'"
          :color="locationId === l.id ? 'primary' : 'neutral'"
          :variant="locationId === l.id ? 'solid' : 'outline'"
          class="rounded-full"
          @click="update({ location_id: l.id })"
        >
          {{ l.label }}
        </UButton>
      </div>
    </template>
  </li>
</template>
