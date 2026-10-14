<script setup lang="ts">
import type { Household } from '~/utils/db'

const db = useDb()
const { user } = useAuth()
const { createHousehold } = useHouseholdActions()
const toast = useToast()

const { data: households, loading } = useLiveQuery(
  async () => (await db.households.toArray()).filter(h => !h.deleted_at).sort((a, b) => a.name.localeCompare(b.name)),
  [] as Household[]
)
const { data: stats } = useLiveQuery(async () => {
  const map: Record<string, { people: number, items: number }> = {}
  await db.people.each((p) => {
    if (p.deleted_at) return
    map[p.household_id] ??= { people: 0, items: 0 }
    map[p.household_id]!.people++
  })
  await db.stockItems.each((i) => {
    if (i.deleted_at) return
    map[i.household_id] ??= { people: 0, items: 0 }
    map[i.household_id]!.items++
  })
  return map
}, {} as Record<string, { people: number, items: number }>)

// Ouverture directe du dernier foyer consulté au lancement de l'app
const autoOpen = useState('pep:auto-open', () => true)
watch(loading, (l) => {
  if (l || !autoOpen.value) return
  autoOpen.value = false
  let last: string | null = null
  try {
    last = localStorage.getItem('pep:lastHousehold')
  } catch { /* ignore */ }
  const target = households.value.find(h => h.id === last) ?? (households.value.length === 1 ? households.value[0] : undefined)
  if (target) navigateTo(`/foyer/${target.id}`, { replace: true })
}, { immediate: true })

const open = ref(false)
const form = reactive({ name: '', myName: '' })

const supabase = useSupabase()
watch(open, async (o) => {
  if (!o || form.myName) return
  // prénom proposé : nom affiché du profil
  const cached = await db.profiles.get(user.value!.id)
  if (cached) form.myName = cached.display_name
  else {
    const { data } = await supabase.from('profiles').select('display_name').eq('id', user.value!.id).maybeSingle()
    form.myName = data?.display_name ?? ''
  }
})

async function create() {
  if (!form.name.trim() || !form.myName.trim()) return
  const household = await createHousehold({ name: form.name, myName: form.myName })
  open.value = false
  form.name = ''
  toast.add({ title: 'Foyer créé', description: 'Frigo, congélateur et types d\'aliments sont prêts (modifiables dans les réglages).', icon: 'i-lucide-house', color: 'success' })
  await navigateTo(`/foyer/${household.id}`)
}
</script>

<template>
  <div class="space-y-5">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-bold">
        Mes foyers
      </h1>
      <UButton icon="i-lucide-plus" @click="open = true">
        Nouveau
      </UButton>
    </div>

    <div v-if="loading" class="space-y-3">
      <USkeleton v-for="i in 2" :key="i" class="h-20 w-full" />
    </div>

    <UEmpty
      v-else-if="!households.length"
      icon="i-lucide-house"
      title="Aucun foyer pour le moment"
      description="Créez votre foyer pour gérer le stock du frigo et des placards, ou ouvrez le lien d'invitation reçu d'un proche."
      :actions="[{ label: 'Créer un foyer', icon: 'i-lucide-plus', size: 'lg', onClick: () => { open = true } }]"
    />

    <div v-else class="space-y-3">
      <NuxtLink
        v-for="h in households"
        :key="h.id"
        :to="`/foyer/${h.id}`"
        class="flex items-center gap-4 p-4 rounded-xl border border-default bg-elevated/50 hover:bg-elevated active:scale-[0.99] transition"
      >
        <div class="size-12 rounded-full bg-primary/15 text-primary flex items-center justify-center text-xl font-bold shrink-0">
          {{ h.name.charAt(0).toUpperCase() }}
        </div>
        <div class="min-w-0 flex-1">
          <p class="font-semibold truncate">
            {{ h.name }}
          </p>
          <p class="text-sm text-muted">
            {{ stats[h.id]?.people ?? 0 }} personne(s) · {{ stats[h.id]?.items ?? 0 }} produit(s) enregistré(s)
          </p>
        </div>
        <UIcon v-if="h._dirty" name="i-lucide-cloud-upload" class="text-warning size-4" />
        <UIcon name="i-lucide-chevron-right" class="text-muted size-5" />
      </NuxtLink>
    </div>

    <UModal v-model:open="open" title="Nouveau foyer" description="Le stock et les goûts des personnes qui vivent ensemble">
      <template #body>
        <form id="create-household" class="space-y-4" @submit.prevent="create">
          <UFormField label="Nom du foyer" required>
            <UInput v-model="form.name" size="xl" class="w-full" autofocus required placeholder="ex. La maison, Chez les Martin" />
          </UFormField>
          <UFormField label="Votre prénom dans ce foyer" required>
            <UInput v-model="form.myName" size="xl" class="w-full" required />
          </UFormField>
        </form>
      </template>
      <template #footer>
        <div class="flex gap-2 w-full">
          <UButton color="neutral" variant="ghost" class="flex-1 justify-center" @click="open = false">
            Annuler
          </UButton>
          <UButton type="submit" form="create-household" class="flex-1 justify-center" :disabled="!form.name.trim() || !form.myName.trim()">
            Créer
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
