<script setup lang="ts">
import type { Nutriscore, Product } from '~/utils/db'

/**
 * Popin d'ajout au stock : scan du code-barres (recherche Open Food Facts) ou saisie libre,
 * puis date d'achat, date de péremption, type d'aliment et lieu de stockage.
 * Un produit déjà connu du foyer (même code-barres ou choisi dans la liste) est réutilisé.
 */
const props = defineProps<{
  householdId: string
  /** ouvrir directement le scanner */
  scan?: boolean
  /** ajouter un lot d'un produit existant */
  productId?: string | null
  /** lieu présélectionné (filtre en cours dans la liste) */
  locationId?: string | null
}>()
const open = defineModel<boolean>('open', { default: false })

const db = useDb()
const toast = useToast()
const { online } = useSync()
const householdId = computed(() => props.householdId)
const { locations, foodTypes } = useHouseholdOptions(householdId)
const { products } = useStock(householdId)
const { addProduct, updateProduct, addStockItem } = useHouseholdActions()

const scanning = ref(false)
const lookingUp = ref(false)
const existing = ref<Product | null>(null)
const showDetails = ref(false)

function emptyForm() {
  return {
    barcode: '' as string,
    name: '',
    brand: '',
    description: '',
    ingredients: '',
    nutriscore: null as Nutriscore | null,
    image_url: null as string | null,
    rating: 0,
    reorder: false,
    unit: 'pièce',
    food_type_id: undefined as string | undefined,
    quantity: 1 as number | null,
    purchased_on: todayKey(),
    expires_on: '',
    location_id: undefined as string | undefined
  }
}
const form = reactive(emptyForm())

/** Rangé au congélateur avec un type dont la durée de conservation est connue : date limite = achat + N mois */
const inFreezer = computed(() => !!locations.value.find(l => l.id === form.location_id)?.freezer)
const freezerLimit = computed(() => {
  if (!inFreezer.value) return null
  const type = foodTypes.value.find(t => t.id === form.food_type_id)
  if (!type?.freezer_months) return null
  return { months: type.freezer_months, type: type.label, date: addMonths(form.purchased_on || todayKey(), type.freezer_months) }
})

// La date proposée remplit la péremption tant qu'elle est vide ou n'a pas été modifiée à la main
watch(() => freezerLimit.value?.date, (date, previous) => {
  if (!form.expires_on || form.expires_on === previous) form.expires_on = date ?? ''
})

function reset() {
  Object.assign(form, emptyForm())
  existing.value = null
  showDetails.value = false
  form.location_id = props.locationId ?? locations.value[0]?.id
  if (props.productId) {
    const p = products.value.find(x => x.id === props.productId)
    if (p) useExisting(p)
  }
  // le formulaire a été vidé : la date proposée n'a peut-être pas changé (le watch ne se déclencherait pas)
  form.expires_on = freezerLimit.value?.date ?? ''
  scanning.value = !!props.scan && !props.productId
}

watch(open, (o) => {
  if (o) reset()
}, { immediate: true })

// produit imposé mais catalogue pas encore chargé à l'ouverture
watch(products, (list) => {
  if (!open.value || existing.value || !props.productId) return
  const p = list.find(x => x.id === props.productId)
  if (p) useExisting(p)
})

watch(locations, (list) => {
  if (!form.location_id && list.length) form.location_id = props.locationId ?? list[0]!.id
})

function useExisting(p: Product) {
  existing.value = p
  form.name = p.name
  form.rating = p.rating
  form.reorder = p.reorder
  form.unit = p.unit
  form.food_type_id = p.food_type_id ?? undefined
  form.barcode = p.barcode ?? ''
}

function clearExisting() {
  const keep = { purchased_on: form.purchased_on, expires_on: form.expires_on, location_id: form.location_id, quantity: form.quantity }
  Object.assign(form, emptyForm(), keep)
  existing.value = null
}

/** Produits du foyer dont le nom ressemble à la saisie */
const nameSuggestions = computed(() => {
  const q = form.name.trim()
  if (existing.value || q.length < 2) return []
  return products.value.filter(p => matches(q, p.name) || p.name.toLowerCase().includes(q.toLowerCase())).slice(0, 5)
})

async function onDetected(code: string) {
  scanning.value = false
  // déjà dans le catalogue du foyer ?
  const known = await db.products.where('[household_id+barcode]').equals([props.householdId, code]).filter(p => !p.deleted_at).first()
  if (known) {
    useExisting(known)
    toast.add({ title: known.name, description: 'Produit déjà connu du foyer', icon: 'i-lucide-scan-barcode', color: 'success', duration: 2500 })
    return
  }
  clearExisting()
  form.barcode = code
  if (!online.value) {
    toast.add({ title: 'Hors connexion', description: 'Recherche du produit impossible : saisissez son nom.', icon: 'i-lucide-wifi-off', color: 'warning' })
    return
  }
  lookingUp.value = true
  try {
    const p = await fetchOffProduct(code)
    if (!p) {
      toast.add({ title: 'Produit inconnu', description: 'Ce code-barres n\'est pas référencé : saisissez le produit.', color: 'warning' })
      return
    }
    Object.assign(form, {
      name: p.name,
      brand: p.brand,
      description: p.description,
      ingredients: p.ingredients,
      nutriscore: p.nutriscore,
      image_url: p.image_url
    })
  } catch (e) {
    toast.add({ title: 'Recherche impossible', description: errorMessage(e), color: 'warning' })
  } finally {
    lookingUp.value = false
  }
}

const canSave = computed(() => !!form.name.trim() && (form.quantity ?? 0) > 0)
const saving = ref(false)

async function save() {
  if (!canSave.value) return
  saving.value = true
  try {
    let product = existing.value
    if (product) {
      const changes: Partial<Product> = {}
      if ((form.food_type_id ?? null) !== product.food_type_id) changes.food_type_id = form.food_type_id ?? null
      if (form.rating !== product.rating) changes.rating = form.rating
      if (form.reorder !== product.reorder) changes.reorder = form.reorder
      if (Object.keys(changes).length) await updateProduct(product.id, changes)
    } else {
      product = await addProduct(props.householdId, {
        barcode: form.barcode || null,
        name: form.name,
        brand: form.brand,
        description: form.description,
        ingredients: form.ingredients,
        nutriscore: form.nutriscore,
        image_url: form.image_url,
        food_type_id: form.food_type_id ?? null,
        unit: form.unit,
        rating: form.rating,
        reorder: form.reorder
      })
    }
    await addStockItem(props.householdId, {
      product_id: product.id,
      location_id: form.location_id ?? null,
      quantity: form.quantity!,
      purchased_on: form.purchased_on || todayKey(),
      expires_on: form.expires_on || null
    })
    toast.add({ title: `${product.name} ajouté au stock`, icon: 'i-lucide-check', color: 'success', duration: 2500 })
    open.value = false
  } finally {
    saving.value = false
  }
}

/** Enregistre puis rouvre le formulaire (plusieurs produits à la suite) */
async function saveAndNext() {
  await save()
  if (!open.value) {
    await nextTick()
    open.value = true
  }
}

const foodTypeItems = computed(() => foodTypes.value.map(t => ({ label: t.label, value: t.id })))
const unitItems = UNITS.map(u => ({ label: u, value: u }))
</script>

<template>
  <UModal
    v-model:open="open"
    :title="productId ? 'Ajouter au stock' : 'Nouveau produit'"
    :ui="{ content: 'max-h-[92dvh]', body: 'overflow-y-auto' }"
  >
    <template #body>
      <div class="space-y-5">
        <!-- Scan -->
        <BarcodeScanner v-if="scanning" @detected="onDetected" @cancel="scanning = false" />
        <UButton
          v-else-if="!existing || !productId"
          block
          size="lg"
          color="neutral"
          variant="soft"
          icon="i-lucide-scan-barcode"
          :loading="lookingUp"
          @click="scanning = true"
        >
          {{ lookingUp ? 'Recherche du produit…' : form.barcode ? `Code ${form.barcode} — scanner à nouveau` : 'Scanner un code-barres' }}
        </UButton>

        <form v-show="!scanning" id="add-stock" class="space-y-5" @submit.prevent="save">
          <!-- Produit -->
          <div v-if="existing" class="flex items-center gap-3 p-3 rounded-xl border border-default bg-elevated/50">
            <img v-if="existing.image_url" :src="existing.image_url" alt="" class="size-12 rounded object-contain bg-white shrink-0">
            <UIcon v-else name="i-lucide-package" class="size-8 text-muted shrink-0" />
            <div class="flex-1 min-w-0">
              <p class="font-semibold truncate">
                {{ existing.name }}
              </p>
              <p class="text-xs text-muted truncate">
                {{ [existing.brand, existing.description].filter(Boolean).join(' · ') || 'Produit du foyer' }}
              </p>
            </div>
            <UButton v-if="!productId" icon="i-lucide-x" size="sm" color="neutral" variant="ghost" aria-label="Autre produit" @click="clearExisting" />
          </div>

          <template v-else>
            <div class="flex gap-3">
              <img v-if="form.image_url" :src="form.image_url" alt="" class="size-16 rounded-lg object-contain bg-white shrink-0">
              <UFormField label="Nom du produit" required class="flex-1">
                <UInput v-model="form.name" size="lg" class="w-full" required placeholder="ex. Yaourt nature" />
              </UFormField>
            </div>
            <div v-if="nameSuggestions.length" class="-mt-3 space-y-1">
              <p class="text-xs text-muted">
                Déjà dans le foyer :
              </p>
              <div class="flex flex-wrap gap-1.5">
                <UButton
                  v-for="p in nameSuggestions"
                  :key="p.id"
                  size="xs"
                  color="neutral"
                  variant="outline"
                  icon="i-lucide-history"
                  @click="useExisting(p)"
                >
                  {{ p.name }}
                </UButton>
              </div>
            </div>

            <UButton
              size="xs"
              variant="link"
              color="neutral"
              :icon="showDetails ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
              class="-mt-2"
              @click="showDetails = !showDetails"
            >
              Description, composition, Nutri-Score
            </UButton>
            <div v-if="showDetails" class="space-y-4 -mt-2">
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
            </div>
          </template>

          <UFormField label="Aliment favori">
            <StarRating v-model="form.rating" />
          </UFormField>
          <USwitch v-model="form.reorder" label="À commander quand épuisé" />

          <!-- Lot -->
          <div class="grid grid-cols-2 gap-3">
            <UFormField label="Quantité" required>
              <UInputNumber v-model="form.quantity" :min="0" :step="1" :step-snapping="false" class="w-full" />
            </UFormField>
            <UFormField label="Unité">
              <USelect v-model="form.unit" :items="unitItems" class="w-full" :disabled="!!existing" />
            </UFormField>
            <UFormField label="Date d'achat">
              <UInput v-model="form.purchased_on" type="date" class="w-full" />
            </UFormField>
            <UFormField label="Péremption">
              <UInput v-model="form.expires_on" type="date" class="w-full" />
            </UFormField>
          </div>
          <p v-if="freezerLimit" class="-mt-3 text-xs text-muted flex items-start gap-1">
            <UIcon name="i-lucide-snowflake" class="size-3.5 shrink-0 mt-px text-info" />
            <span>
              {{ freezerLimit.type }} au congélateur : {{ freezerLimit.months }} mois, soit jusqu'au {{ formatDate(freezerLimit.date) }}.
              <button v-if="form.expires_on !== freezerLimit.date" type="button" class="underline" @click="form.expires_on = freezerLimit.date">Appliquer</button>
            </span>
          </p>

          <UFormField label="Type d'aliment">
            <USelect v-model="form.food_type_id" :items="foodTypeItems" placeholder="Choisir…" class="w-full" />
          </UFormField>

          <UFormField label="Rangé dans">
            <div class="flex flex-wrap gap-2">
              <UButton
                v-for="l in locations"
                :key="l.id"
                :icon="l.icon || 'i-lucide-package'"
                :color="form.location_id === l.id ? 'primary' : 'neutral'"
                :variant="form.location_id === l.id ? 'solid' : 'outline'"
                class="rounded-full"
                @click="form.location_id = l.id"
              >
                {{ l.label }}
              </UButton>
            </div>
            <p v-if="inFreezer && !freezerLimit" class="mt-1.5 text-xs text-muted">
              Au congélateur, la date limite est proposée selon le type d'aliment (durée réglable dans les réglages du foyer).
            </p>
          </UFormField>
        </form>
      </div>
    </template>

    <template #footer>
      <div v-if="!scanning" class="flex gap-2 w-full">
        <UButton color="neutral" variant="soft" class="flex-1 justify-center" :disabled="!canSave" :loading="saving" @click="saveAndNext">
          + Autre produit
        </UButton>
        <UButton type="submit" form="add-stock" class="flex-1 justify-center" icon="i-lucide-check" :disabled="!canSave" :loading="saving">
          Ajouter
        </UButton>
      </div>
    </template>
  </UModal>
</template>
