<script setup lang="ts">
const route = useRoute()
const householdId = computed(() => route.params.id as string)

const { people, accountName } = useHousehold(householdId)
const { tastes } = useHouseholdTastes(householdId)
const { addPerson } = useHouseholdActions()

const countOf = computed(() => new Map(tastes.value.map(t => [t.person.id, { prefs: t.preferences.length, recipes: t.recipes.length }])))

function status(p: { user_id: string | null, invite_token: string | null, role: string }) {
  if (p.user_id) return { label: p.role === 'owner' ? 'Propriétaire' : `Compte : ${accountName(p.user_id) ?? 'lié'}`, icon: 'i-lucide-user-check', color: 'success' as const }
  if (p.invite_token) return { label: 'Invitation en attente', icon: 'i-lucide-mail', color: 'warning' as const }
  return { label: 'Sans compte', icon: 'i-lucide-user', color: 'neutral' as const }
}

const open = ref(false)
const name = ref('')
async function create() {
  if (!name.value.trim()) return
  const p = await addPerson(householdId.value, name.value)
  open.value = false
  name.value = ''
  await navigateTo(`/foyer/${householdId.value}/personnes/${p.id}`)
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-bold">
        Personnes
      </h1>
      <UButton icon="i-lucide-user-plus" @click="open = true">
        Ajouter
      </UButton>
    </div>
    <p class="text-sm text-muted">
      Les goûts et recettes préférées de chacun servent aux idées de repas. Une personne peut être invitée à lier son compte : ses préférences de compte sont alors reprises automatiquement.
    </p>

    <ul class="space-y-2">
      <li v-for="p in people" :key="p.id">
        <NuxtLink
          :to="`/foyer/${householdId}/personnes/${p.id}`"
          class="flex items-center gap-3 p-3 rounded-xl border border-default bg-elevated/40 hover:bg-elevated transition"
        >
          <UAvatar :alt="p.name" />
          <div class="flex-1 min-w-0">
            <p class="font-medium truncate">
              {{ p.name }}
              <UIcon v-if="p._dirty" name="i-lucide-cloud-upload" class="size-3 text-warning" />
            </p>
            <p class="text-xs text-muted">
              {{ countOf.get(p.id)?.prefs ?? 0 }} préférence(s) · {{ countOf.get(p.id)?.recipes ?? 0 }} recette(s)
            </p>
            <UBadge :color="status(p).color" :icon="status(p).icon" variant="subtle" size="sm" class="mt-1">
              {{ status(p).label }}
            </UBadge>
          </div>
          <UIcon name="i-lucide-chevron-right" class="size-5 text-muted" />
        </NuxtLink>
      </li>
    </ul>

    <UModal v-model:open="open" title="Nouvelle personne" description="Un membre du foyer, avec ou sans compte">
      <template #body>
        <form id="add-person" @submit.prevent="create">
          <UFormField label="Prénom" required>
            <UInput v-model="name" size="xl" class="w-full" autofocus required />
          </UFormField>
        </form>
      </template>
      <template #footer>
        <div class="flex gap-2 w-full">
          <UButton color="neutral" variant="ghost" class="flex-1 justify-center" @click="open = false">
            Annuler
          </UButton>
          <UButton type="submit" form="add-person" class="flex-1 justify-center" :disabled="!name.trim()">
            Ajouter
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
