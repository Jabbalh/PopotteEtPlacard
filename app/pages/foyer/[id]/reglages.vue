<script setup lang="ts">
const route = useRoute()
const householdId = computed(() => route.params.id as string)
const supabase = useSupabase()
const toast = useToast()
const { online, sync } = useSync()

const { household, isOwner, me } = useHousehold(householdId)
const { allLocations, allFoodTypes, locations, foodTypes } = useHouseholdOptions(householdId)
const { allLots, products } = useStock(householdId)
const { updateHousehold } = useHouseholdActions()

// --- Nom ---
const name = ref('')
watch(household, (h) => {
  if (h && !name.value) name.value = h.name
}, { immediate: true })

async function saveName() {
  if (!name.value.trim()) return
  await updateHousehold(householdId.value, { name: name.value.trim() })
  toast.add({ title: 'Foyer mis à jour', color: 'success', icon: 'i-lucide-check' })
}

// --- Listes paramétrables ---
const tab = ref<'locations' | 'foodTypes'>('locations')
const locationUsage = computed(() => {
  const map = new Map<string, number>()
  for (const l of allLots.value) if (l.remaining > 0 && l.item.location_id) map.set(l.item.location_id, (map.get(l.item.location_id) ?? 0) + 1)
  return map
})
const typeUsage = computed(() => {
  const map = new Map<string, number>()
  for (const p of products.value) if (p.food_type_id) map.set(p.food_type_id, (map.get(p.food_type_id) ?? 0) + 1)
  return map
})

// --- Zone sensible ---
const confirmAction = ref<null | { title: string, description: string, label: string, run: () => Promise<void> }>(null)
const confirmOpen = computed({
  get: () => !!confirmAction.value,
  set: (v) => {
    if (!v) confirmAction.value = null
  }
})
const running = ref(false)

async function runConfirm() {
  if (!confirmAction.value) return
  running.value = true
  try {
    await confirmAction.value.run()
    confirmAction.value = null
  } catch (e) {
    toast.add({ title: 'Oups', description: errorMessage(e), color: 'error' })
  } finally {
    running.value = false
  }
}

function forget() {
  try {
    localStorage.removeItem('pep:lastHousehold')
  } catch { /* ignore */ }
}

function askDelete() {
  confirmAction.value = {
    title: 'Supprimer ce foyer ?',
    description: 'Le foyer, son stock, ses personnes et leurs préférences de foyer seront supprimés pour tous les membres. Les préférences de compte de chacun sont conservées.',
    label: 'Supprimer définitivement',
    run: async () => {
      await updateHousehold(householdId.value, { deleted_at: new Date().toISOString() })
      forget()
      await navigateTo('/')
    }
  }
}

function askLeave() {
  confirmAction.value = {
    title: 'Quitter ce foyer ?',
    description: 'Vous n\'y aurez plus accès, sauf nouvelle invitation.',
    label: 'Quitter',
    run: async () => {
      await sync()
      const { error } = await supabase.rpc('pp_leave_household', { p_household_id: householdId.value })
      if (error) throw error
      await sync()
      forget()
      await navigateTo('/')
    }
  }
}
</script>

<template>
  <div class="space-y-5">
    <h1 class="text-2xl font-bold">
      Réglages
    </h1>

    <div class="flex flex-col gap-5 lg:grid lg:grid-cols-2 lg:items-start">
      <div class="contents lg:flex lg:flex-col lg:gap-5">
        <UCard class="order-1">
          <template #header>
            <h2 class="font-semibold">
              Foyer
            </h2>
          </template>
          <form class="flex gap-2" @submit.prevent="saveName">
            <UInput v-model="name" class="flex-1" required />
            <UButton type="submit">
              Enregistrer
            </UButton>
          </form>
        </UCard>

        <UCard class="order-3">
          <template #header>
            <h2 class="font-semibold">
              Membres et invitations
            </h2>
          </template>
          <p class="text-sm text-muted mb-3">
            Pour donner accès au foyer, ajoutez la personne puis envoyez-lui un lien d'invitation depuis sa fiche.
          </p>
          <UButton block color="neutral" variant="soft" icon="i-lucide-users" :to="`/foyer/${householdId}/personnes`">
            Personnes du foyer
          </UButton>
        </UCard>

        <UCard class="order-4" :ui="{ root: 'ring-error/40' }">
          <template #header>
            <h2 class="font-semibold text-error">
              Zone sensible
            </h2>
          </template>
          <UButton v-if="isOwner" block color="error" variant="soft" icon="i-lucide-trash-2" @click="askDelete">
            Supprimer le foyer
          </UButton>
          <UButton v-else-if="me" block color="error" variant="soft" icon="i-lucide-log-out" :disabled="!online" @click="askLeave">
            Quitter le foyer
          </UButton>
        </UCard>
      </div>

      <UCard class="order-2">
        <template #header>
          <h2 class="font-semibold">
            Rangements et types d'aliments
          </h2>
          <p class="text-sm text-muted">
            Les choix proposés à l'ajout d'un produit. Touchez un libellé pour le renommer, l'icône pour la changer.
          </p>
        </template>
        <UTabs
          v-model="tab"
          :content="false"
          :items="[{ label: `Rangements (${locations.length})`, value: 'locations' }, { label: `Types (${foodTypes.length})`, value: 'foodTypes' }]"
          class="mb-3"
        />
        <OptionsEditor
          v-if="tab === 'locations'"
          :household-id="householdId"
          table="locations"
          :options="locations"
          :archived="allLocations.filter(o => o.deleted_at)"
          :usage="locationUsage"
          placeholder="Nouveau rangement (ex. Cave, Placard)…"
        />
        <OptionsEditor
          v-else
          :household-id="householdId"
          table="foodTypes"
          :options="foodTypes"
          :archived="allFoodTypes.filter(o => o.deleted_at)"
          :usage="typeUsage"
          placeholder="Nouveau type d'aliment…"
        />
      </UCard>
    </div>

    <UModal v-model:open="confirmOpen" :title="confirmAction?.title" :description="confirmAction?.description">
      <template #footer>
        <div class="flex gap-2 w-full">
          <UButton color="neutral" variant="ghost" class="flex-1 justify-center" @click="confirmAction = null">
            Annuler
          </UButton>
          <UButton color="error" class="flex-1 justify-center" :loading="running" @click="runConfirm">
            {{ confirmAction?.label }}
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
