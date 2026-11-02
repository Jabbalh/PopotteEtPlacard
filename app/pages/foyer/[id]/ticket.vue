<script setup lang="ts">
import type { ParsedReceipt, ReceiptItem } from '~/utils/receipt'

/**
 * Ticket de caisse → stock : import d'un ticket PDF (texte lu sur l'appareil) ou d'un texte collé,
 * liste temporaire des articles à associer aux produits du foyer, puis ajout au stock.
 */
const route = useRoute()
const toast = useToast()
const { online } = useSync()
const householdId = computed(() => route.params.id as string)
const { household } = useHousehold(householdId)
const db = useDb()

const receipt = useReceipt(householdId)
const { lines, loading } = receipt

const counts = computed(() => {
  const c = { ready: 0, todo: 0, ignored: 0 }
  for (const l of lines.value) c[lineStatus(l)]++
  return c
})

/** Date d'achat des lignes en attente : commune, ou null si plusieurs tickets de dates différentes */
const linesDate = computed(() => {
  const dates = new Set(lines.value.map(l => l.purchased_on))
  return dates.size === 1 ? [...dates][0]! : null
})
async function setLinesDate(value: string | number) {
  const date = String(value)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return
  await receipt.setPurchasedOn(date)
  purchasedOn.value = date
}

// --- Import ---
const showImport = ref(false)
const purchasedOn = ref(todayKey())
const pasted = ref('')
const pasteOpen = ref(false)
const reading = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`

// --- Lignes non reconnues comme articles (en-tête, totaux, paiement… ou article mal lu) ---
/** conservées pendant la session (retour sur la page compris) pour en intégrer certaines */
const others = useState<ReceiptItem[]>(`pep:receiptOthers:${householdId.value}`, () => [])
const othersOpen = ref(false)
const othersSelected = ref<Set<number>>(new Set())

function openOthers() {
  othersSelected.value = new Set()
  othersOpen.value = true
}

function toggleOther(i: number, checked: boolean | 'indeterminate') {
  const next = new Set(othersSelected.value)
  if (checked === true) next.add(i)
  else next.delete(i)
  othersSelected.value = next
}

/** Ajoute les lignes cochées à la liste du ticket, et les retire des lignes non reconnues */
async function addSelectedOthers() {
  const picked = others.value.filter((_, i) => othersSelected.value.has(i))
  if (!picked.length) return
  const r = await receipt.importItems(picked, linesDate.value ?? purchasedOn.value)
  others.value = others.value.filter((_, i) => !othersSelected.value.has(i))
  othersOpen.value = false
  toast.add({
    title: `${plural(r.added, 'ligne')} ajoutée${r.added > 1 ? 's' : ''} à la liste`,
    description: 'Associez-les à un produit comme les autres articles.',
    icon: 'i-lucide-list-plus',
    color: 'success'
  })
}

async function addParsed(parsed: ParsedReceipt, source: string) {
  if (!parsed.items.length && !parsed.others.length) {
    toast.add({ title: 'Aucune ligne trouvée', description: `Le ${source} ne contient pas de texte exploitable.`, color: 'warning' })
    return
  }
  if (parsed.date) purchasedOn.value = parsed.date
  showImport.value = false

  // aucun article reconnu : toutes les lignes sont listées, l'utilisateur valide ou exclut
  if (!parsed.items.length) {
    others.value = []
    const r = await receipt.importItems(parsed.others, purchasedOn.value)
    toast.add({
      title: 'Aucun article reconnu',
      description: `Les ${plural(r.added, 'ligne')} du ${source} sont listées : associez celles qui sont des articles, ignorez ou retirez les autres.`,
      icon: 'i-lucide-receipt',
      color: 'warning',
      duration: 8000
    })
    return
  }

  const r = await receipt.importItems(parsed.items, purchasedOn.value)
  const details = [
    r.recognized && `${r.recognized} reconnu${r.recognized > 1 ? 's' : ''}`,
    r.guessed && `${r.guessed} proposé${r.guessed > 1 ? 's' : ''}`,
    r.ignored && `${r.ignored} ignoré${r.ignored > 1 ? 's' : ''}`,
    parsed.date && `ticket du ${formatDate(parsed.date)}`
  ].filter(Boolean).join(' · ')
  const rest = parsed.others
  others.value = rest
  toast.add({
    title: `${plural(r.added, 'article')} ajouté${r.added > 1 ? 's' : ''} à la liste`,
    description: [details, rest.length ? `${plural(rest.length, 'autre ligne')} non reconnue${rest.length > 1 ? 's' : ''} (totaux, paiement… ou article oublié).` : ''].filter(Boolean).join('. ') || undefined,
    icon: 'i-lucide-receipt',
    color: 'success',
    duration: rest.length ? 10000 : 5000,
    actions: rest.length
      ? [{ label: 'Voir les lignes', icon: 'i-lucide-list-checks', color: 'neutral', variant: 'outline', onClick: openOthers }]
      : undefined
  })
}

async function onFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  reading.value = true
  try {
    const text = await extractPdfLines(file)
    if (!text.some(l => /[a-z]{3}/i.test(l))) {
      toast.add({
        title: 'Pas de texte dans ce PDF',
        description: 'C\'est sans doute une image (ticket scanné ou photographié). Utilisez le ticket dématérialisé envoyé par le magasin, ou collez le texte.',
        color: 'warning'
      })
      return
    }
    await addParsed(parseReceipt(text), 'PDF')
  } catch (e) {
    toast.add({ title: 'Lecture du PDF impossible', description: errorMessage(e), color: 'error' })
  } finally {
    reading.value = false
  }
}

async function readPasted() {
  await addParsed(parseReceipt(pasted.value.split(/\r?\n/)), 'texte')
  if (lines.value.length) {
    pasted.value = ''
    pasteOpen.value = false
  }
}

const newLabel = ref('')
async function addManual() {
  if (!newLabel.value.trim()) return
  await receipt.addLine(newLabel.value, purchasedOn.value)
  newLabel.value = ''
}

// --- Scan d'un article ---
const scanLineId = ref<string | null>(null)
const scanOpen = computed({
  get: () => !!scanLineId.value,
  set: (v) => {
    if (!v) scanLineId.value = null
  }
})

async function onDetected(code: string) {
  const line = lines.value.find(l => l.id === scanLineId.value)
  scanLineId.value = null
  if (!line) return
  const known = await db.products.where('[household_id+barcode]').equals([householdId.value, code]).filter(p => !p.deleted_at).first()
  if (known) {
    await receipt.updateLine(line.id, { product_id: known.id, match: 'manual', new_product: null, location_id: null })
    toast.add({ title: known.name, description: 'Produit déjà connu du foyer', icon: 'i-lucide-scan-barcode', color: 'success', duration: 2500 })
    return
  }
  const base = {
    name: productNameFromLabel(line.label),
    barcode: code,
    brand: '',
    description: '',
    ingredients: '',
    nutriscore: null,
    image_url: null,
    unit: line.weighed ? 'kg' : 'pièce',
    food_type_id: null
  }
  let off: Awaited<ReturnType<typeof fetchOffProduct>> = null
  if (online.value) {
    try {
      off = await fetchOffProduct(code)
    } catch (e) {
      toast.add({ title: 'Recherche impossible', description: errorMessage(e), color: 'warning' })
    }
  }
  await receipt.updateLine(line.id, {
    product_id: null,
    match: null,
    new_product: off
      ? { ...base, name: off.name || base.name, brand: off.brand, description: off.description, ingredients: off.ingredients, nutriscore: off.nutriscore, image_url: off.image_url }
      : base
  })
  if (!off) toast.add({ title: 'Nouveau produit', description: online.value ? 'Code-barres inconnu : vérifiez le nom proposé.' : 'Hors connexion : vérifiez le nom proposé.', color: 'warning' })
}

// --- Validation ---
const saving = ref(false)
async function validate() {
  saving.value = true
  try {
    const r = await receipt.validate()
    toast.add({
      title: `${r.added} produit${r.added > 1 ? 's' : ''} ajouté${r.added > 1 ? 's' : ''} au stock`,
      description: counts.value.todo ? `${counts.value.todo} ligne${counts.value.todo > 1 ? 's' : ''} reste${counts.value.todo > 1 ? 'nt' : ''} à compléter.` : undefined,
      icon: 'i-lucide-check',
      color: 'success'
    })
    if (!lines.value.length) {
      others.value = []
      await navigateTo(`/foyer/${householdId.value}`)
    }
  } catch (e) {
    toast.add({ title: 'Ajout impossible', description: errorMessage(e), color: 'error' })
  } finally {
    saving.value = false
  }
}

const confirmClear = ref(false)
async function clearAll() {
  await receipt.clear()
  others.value = []
  confirmClear.value = false
}
</script>

<template>
  <div class="space-y-4 pb-24 lg:pb-0">
    <div class="flex items-center gap-2">
      <UButton :to="`/foyer/${householdId}`" icon="i-lucide-arrow-left" color="neutral" variant="ghost" aria-label="Retour au stock" />
      <div class="min-w-0 flex-1">
        <p class="text-sm text-muted truncate">
          {{ household?.name }}
        </p>
        <h1 class="text-2xl font-bold">
          Ticket de caisse
        </h1>
      </div>
      <UButton v-if="lines.length && !showImport" icon="i-lucide-plus" color="neutral" variant="soft" size="sm" @click="showImport = true">
        Importer
      </UButton>
    </div>

    <!-- Import -->
    <div v-if="!loading && (!lines.length || showImport)" class="p-4 rounded-xl border border-default bg-elevated/40 space-y-4">
      <p class="text-sm text-muted">
        Importez le <strong>ticket dématérialisé</strong> (PDF envoyé par le magasin ou téléchargé depuis son appli) : son texte est lu sur l'appareil.
        Les articles sont ensuite à associer aux produits déjà achetés ; les associations sont mémorisées pour les prochains tickets.
      </p>
      <input ref="fileInput" type="file" accept="application/pdf,.pdf" class="hidden" @change="onFile">
      <div class="grid grid-cols-1 gap-2 md:grid-cols-2">
        <UButton size="lg" icon="i-lucide-file-text" class="justify-center" :loading="reading" @click="fileInput?.click()">
          {{ reading ? 'Lecture du ticket…' : 'Importer un ticket PDF' }}
        </UButton>
        <UButton size="lg" color="neutral" variant="soft" icon="i-lucide-clipboard-paste" class="justify-center" @click="pasteOpen = !pasteOpen">
          Coller le texte
        </UButton>
      </div>
      <div v-if="pasteOpen" class="space-y-2">
        <UTextarea
          v-model="pasted"
          :rows="6"
          autoresize
          class="w-full font-mono"
          placeholder="LAIT 1/2 ECR UHT 1L   1,15&#10;2 x 0,89&#10;YAOURT NATURE X4   1,78&#10;… ou une liste : un article par ligne"
        />
        <UButton block icon="i-lucide-scan-text" :disabled="!pasted.trim()" @click="readPasted">
          Lire le texte
        </UButton>
      </div>
      <UFormField label="Date d'achat" hint="Reprise du ticket si elle y figure">
        <UInput v-model="purchasedOn" type="date" class="w-full md:w-60" />
      </UFormField>
      <UButton v-if="lines.length" block color="neutral" variant="ghost" @click="showImport = false">
        Fermer
      </UButton>
    </div>

    <template v-if="lines.length">
      <!-- Résumé -->
      <div class="flex flex-wrap items-center gap-2 text-sm">
        <UBadge color="primary" variant="subtle" icon="i-lucide-circle-check">
          {{ counts.ready }} prêt{{ counts.ready > 1 ? 's' : '' }}
        </UBadge>
        <UBadge v-if="counts.todo" color="warning" variant="subtle" icon="i-lucide-circle-dashed">
          {{ counts.todo }} à compléter
        </UBadge>
        <UBadge v-if="counts.ignored" color="neutral" variant="subtle" icon="i-lucide-circle-slash">
          {{ counts.ignored }} ignoré{{ counts.ignored > 1 ? 's' : '' }}
        </UBadge>
        <span class="flex-1" />
        <UButton v-if="others.length" size="xs" color="neutral" variant="ghost" icon="i-lucide-list-checks" @click="openOthers">
          {{ others.length }} non reconnue{{ others.length > 1 ? 's' : '' }}
        </UButton>
        <UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" @click="confirmClear = true">
          Tout effacer
        </UButton>
      </div>
      <p class="text-xs text-muted -mt-2">
        Liste enregistrée sur cet appareil : vous pouvez la compléter plus tard. Les lignes prêtes partent au stock, les autres restent ici.
      </p>

      <!-- Date d'achat (ticket saisi après coup) -->
      <UFormField
        label="Date d'achat"
        :hint="linesDate ? undefined : 'Plusieurs dates : en choisir une l\'applique à toutes les lignes'"
        :help="linesDate ? 'S\'applique à toutes les lignes du ticket (péremption au congélateur comprise).' : undefined"
      >
        <UInput
          :model-value="linesDate ?? ''"
          type="date"
          :max="todayKey()"
          class="w-full md:w-60"
          @update:model-value="setLinesDate"
        />
      </UFormField>

      <ul class="grid grid-cols-1 gap-2 md:grid-cols-2">
        <ReceiptLineCard
          v-for="line in lines"
          :key="line.id"
          :line="line"
          :receipt="receipt"
          @scan="scanLineId = line.id"
        />
      </ul>

      <form class="flex gap-2" @submit.prevent="addManual">
        <UInput v-model="newLabel" icon="i-lucide-plus" placeholder="Ajouter un article oublié" class="flex-1" />
        <UButton type="submit" color="neutral" variant="soft" :disabled="!newLabel.trim()">
          Ajouter
        </UButton>
      </form>

      <!-- Validation : barre fixe sur mobile et tablette, en fin de liste sur PC -->
      <div class="fixed z-20 inset-x-0 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] px-4 lg:static lg:px-0">
        <div class="max-w-2xl md:max-w-4xl mx-auto lg:max-w-none">
          <UButton
            block
            size="xl"
            icon="i-lucide-check"
            class="shadow-lg lg:shadow-none"
            :disabled="!counts.ready && !counts.ignored"
            :loading="saving"
            @click="validate"
          >
            Ajouter au stock{{ counts.ready ? ` (${counts.ready})` : '' }}
          </UButton>
        </div>
      </div>
    </template>

    <UModal v-model:open="scanOpen" title="Scanner l'article">
      <template #body>
        <BarcodeScanner v-if="scanOpen" @detected="onDetected" @cancel="scanLineId = null" />
      </template>
    </UModal>

    <!-- Lignes non reconnues : en intégrer certaines -->
    <UModal
      v-model:open="othersOpen"
      title="Lignes non reconnues"
      description="Cochez celles qui sont des articles pour les ajouter à la liste."
      :ui="{ content: 'max-h-[92dvh]', body: 'overflow-y-auto' }"
    >
      <template #body>
        <ul class="divide-y divide-default rounded-xl border border-default">
          <li v-for="(o, i) in others" :key="i">
            <label class="flex items-center gap-3 px-3 py-2 cursor-pointer">
              <UCheckbox :model-value="othersSelected.has(i)" @update:model-value="v => toggleOther(i, v)" />
              <span class="flex-1 min-w-0 font-mono text-sm break-words">{{ o.label }}</span>
              <span v-if="o.price !== null" class="text-xs text-muted shrink-0">{{ formatPrice(o.price) }}</span>
            </label>
          </li>
        </ul>
      </template>
      <template #footer>
        <div class="flex gap-2 w-full">
          <UButton color="neutral" variant="ghost" class="flex-1 justify-center" @click="othersOpen = false">
            Fermer
          </UButton>
          <UButton class="flex-1 justify-center" icon="i-lucide-list-plus" :disabled="!othersSelected.size" @click="addSelectedOthers">
            Ajouter{{ othersSelected.size ? ` (${othersSelected.size})` : '' }}
          </UButton>
        </div>
      </template>
    </UModal>

    <UModal v-model:open="confirmClear" title="Effacer le ticket ?" description="Toutes les lignes en attente seront retirées. Rien n'est ajouté au stock.">
      <template #footer>
        <div class="flex gap-2 w-full justify-end">
          <UButton color="neutral" variant="soft" @click="confirmClear = false">
            Annuler
          </UButton>
          <UButton color="error" icon="i-lucide-trash-2" @click="clearAll">
            Effacer
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
