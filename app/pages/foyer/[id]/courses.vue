<script setup lang="ts">
import type { Product, ShoppingItem } from '~/utils/db'

const route = useRoute()
const toast = useToast()
const householdId = computed(() => route.params.id as string)

const { toOrder, loading } = useStock(householdId)
const { updateProduct } = useHouseholdActions()

/** Produits « à commander » épuisés, puis ceux sous leur seuil d'alerte */
const groups = computed(() => [
  { key: 'out', title: 'En rupture', items: toOrder.value.filter(s => s.total <= 0) },
  { key: 'low', title: 'Bientôt épuisés', items: toOrder.value.filter(s => s.total > 0) }
].filter(g => g.items.length))

const remaining = computed(() => toOrder.value.filter(s => !s.ordered))

function setOrdered(p: Product, v: boolean) {
  updateProduct(p.id, { ordered_at: v ? new Date().toISOString() : null })
}

// --- Liste de courses (aliments manquants des recettes, saisie libre) ---
const { shoppingItems, findItem } = useShoppingList(householdId)
const { addShoppingItems, removeShoppingItems } = useHouseholdActions()
const newItem = ref('')

function itemLabel(i: ShoppingItem) {
  return [i.quantity ? formatQuantity(Number(i.quantity), i.unit) : '', i.label].filter(Boolean).join(' ')
}

async function addItem() {
  const label = newItem.value.trim()
  if (!label) return
  newItem.value = ''
  if (findItem(label)) {
    toast.add({ title: 'Déjà dans la liste', icon: 'i-lucide-list-checks', duration: 2000 })
    return
  }
  await addShoppingItems(householdId.value, [{ label, quantity: null, unit: '', recipe_name: null }])
}

async function bought(i: ShoppingItem) {
  await removeShoppingItems([i.id])
  toast.add({
    title: `${i.label} acheté`,
    icon: 'i-lucide-check',
    duration: 4000,
    actions: [{ label: 'Annuler', color: 'neutral', variant: 'outline', onClick: () => removeShoppingItems([i.id], true) }]
  })
}

/** Liste de courses et produits non commandés, à coller dans un message ou un site de courses */
async function share() {
  const text = [
    ...shoppingItems.value.map(i => `- ${itemLabel(i)}`),
    ...remaining.value.map(s => `- ${s.product.name}${s.product.brand ? ` (${s.product.brand})` : ''}`)
  ].join('\n')
  if (navigator.share) {
    try {
      await navigator.share({ title: 'À commander', text })
      return
    } catch { /* partage annulé : on copie */ }
  }
  try {
    await navigator.clipboard.writeText(text)
    toast.add({ title: 'Liste copiée', icon: 'i-lucide-clipboard-check', color: 'success', duration: 2000 })
  } catch {
    toast.add({ title: 'Copie impossible', color: 'error' })
  }
}

const addOpen = ref(false)
const addProductId = ref<string | null>(null)
function restock(productId: string) {
  addProductId.value = productId
  addOpen.value = true
}
</script>

<template>
  <div class="space-y-5">
    <div class="flex items-center gap-2">
      <div class="min-w-0 flex-1">
        <h1 class="text-2xl font-bold">
          À commander
        </h1>
        <p class="text-sm text-muted">
          Liste de courses du foyer, et produits marqués « à commander quand épuisé » en rupture ou sous leur seuil d'alerte.
        </p>
      </div>
      <UButton v-if="remaining.length || shoppingItems.length" icon="i-lucide-share-2" color="neutral" variant="soft" size="sm" @click="share">
        Partager
      </UButton>
    </div>

    <section class="space-y-2">
      <h2 class="font-semibold">
        Liste de courses{{ shoppingItems.length ? ` · ${shoppingItems.length}` : '' }}
      </h2>
      <form class="flex gap-2" @submit.prevent="addItem">
        <UInput v-model="newItem" class="flex-1" placeholder="Ajouter un aliment (ex. Tomates)…" />
        <UButton type="submit" icon="i-lucide-plus" :disabled="!newItem.trim()" aria-label="Ajouter" />
      </form>
      <p v-if="!shoppingItems.length" class="text-sm text-muted">
        Vide. Depuis une idée de recette, « Ajouter aux courses » y place les aliments manquants.
      </p>
      <ul v-else class="grid grid-cols-1 gap-2 md:grid-cols-2">
        <li v-for="i in shoppingItems" :key="i.id" class="flex items-center gap-3 p-3 rounded-xl border border-default bg-elevated/40">
          <div class="min-w-0 flex-1">
            <p class="font-medium truncate">
              {{ itemLabel(i) }}
            </p>
            <p v-if="i.recipe_name" class="text-xs text-muted truncate inline-flex items-center gap-1">
              <UIcon name="i-lucide-chef-hat" class="size-3" /> {{ i.recipe_name }}
            </p>
          </div>
          <UButton icon="i-lucide-check" color="neutral" variant="soft" aria-label="Acheté" title="Acheté" @click="bought(i)" />
        </li>
      </ul>
    </section>

    <div v-if="loading" class="grid grid-cols-1 gap-2 md:grid-cols-2">
      <USkeleton v-for="i in 4" :key="i" class="h-16 w-full" />
    </div>

    <UEmpty
      v-else-if="!groups.length && !shoppingItems.length"
      icon="i-lucide-shopping-cart"
      title="Rien à commander"
      description="Activez « À commander quand épuisé » sur la fiche d'un produit : il apparaîtra ici dès qu'il n'y en aura plus."
    />

    <section v-for="g in groups" :key="g.key" class="space-y-2">
      <h2 class="font-semibold">
        {{ g.title }} · {{ g.items.length }}
      </h2>
      <ul class="grid grid-cols-1 gap-2 md:grid-cols-2">
        <li
          v-for="s in g.items"
          :key="s.product.id"
          class="flex items-center gap-3 p-3 rounded-xl border border-default bg-elevated/40"
          :class="s.ordered ? 'opacity-60' : ''"
        >
          <NuxtLink :to="`/foyer/${householdId}/produit/${s.product.id}`" class="flex items-center gap-3 flex-1 min-w-0">
            <img v-if="s.product.image_url" :src="s.product.image_url" alt="" class="size-11 rounded-lg object-contain bg-white shrink-0" loading="lazy">
            <div v-else class="size-11 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <UIcon name="i-lucide-carrot" class="size-5" />
            </div>
            <div class="min-w-0 flex-1">
              <p class="font-medium truncate" :class="s.ordered ? 'line-through' : ''">
                {{ s.product.name }}
              </p>
              <div class="flex flex-wrap items-center gap-1 mt-0.5">
                <UBadge v-if="s.ordered" color="neutral" variant="subtle" size="sm" icon="i-lucide-truck">
                  Commandé le {{ formatDate(toDateKey(new Date(s.product.ordered_at!))) }}
                </UBadge>
                <UBadge v-else :color="s.total <= 0 ? 'error' : 'warning'" variant="subtle" size="sm">
                  {{ s.total <= 0 ? 'Rupture' : `Reste ${formatQuantity(s.total, s.product.unit)}` }}
                </UBadge>
                <span v-if="s.product.brand" class="text-xs text-muted truncate">{{ s.product.brand }}</span>
              </div>
            </div>
          </NuxtLink>
          <UButton
            :icon="s.ordered ? 'i-lucide-undo-2' : 'i-lucide-check'"
            color="neutral"
            :variant="s.ordered ? 'ghost' : 'soft'"
            :aria-label="s.ordered ? 'Annuler la commande' : 'Marquer comme commandé'"
            :title="s.ordered ? 'Annuler la commande' : 'Commandé'"
            @click="setOrdered(s.product, !s.ordered)"
          />
          <UButton icon="i-lucide-plus" color="neutral" variant="soft" aria-label="Ajouter au stock" title="Ajouter au stock" @click="restock(s.product.id)" />
        </li>
      </ul>
    </section>

    <AddStockModal v-model:open="addOpen" :household-id="householdId" :product-id="addProductId" />
  </div>
</template>
