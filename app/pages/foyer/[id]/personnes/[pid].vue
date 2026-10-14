<script setup lang="ts">
const route = useRoute()
const router = useRouter()
const toast = useToast()
const supabase = useSupabase()
const { user } = useAuth()
const { online, sync } = useSync()

const householdId = computed(() => route.params.id as string)
const personId = computed(() => route.params.pid as string)

const { household, people, isOwner, accountName } = useHousehold(householdId)
const { tastes } = useHouseholdTastes(householdId)
const { catalog } = useFoodCatalog(householdId)
const { updatePerson } = useHouseholdActions()

const person = computed(() => people.value.find(p => p.id === personId.value))
const personTastes = computed(() => tastes.value.find(t => t.person.id === personId.value))
const isMe = computed(() => !!person.value?.user_id && person.value.user_id === user.value?.id)
const owner = computed(() => ({ personId: personId.value, householdId: householdId.value }))

function goBack() {
  if (window.history.state?.back) router.back()
  else navigateTo(`/foyer/${householdId.value}/personnes`)
}

// --- Prénom ---
const editingName = ref(false)
const name = ref('')
function startEdit() {
  name.value = person.value?.name ?? ''
  editingName.value = true
}
async function saveName() {
  editingName.value = false
  if (name.value.trim() && name.value.trim() !== person.value?.name) await updatePerson(personId.value, { name: name.value.trim() })
}

// --- Invitation (lier un compte à cette personne) ---
const inviteUrl = computed(() => person.value?.invite_token ? `${location.origin}/rejoindre/${person.value.invite_token}` : '')
const busy = ref(false)

async function setInvite(token: string | null) {
  busy.value = true
  try {
    // la personne doit exister côté serveur avant de générer un lien
    await sync()
    const { error } = await supabase.from('pp_people').update({ invite_token: token }).eq('id', personId.value)
    if (error) throw error
    await sync()
    if (token) await share()
    else toast.add({ title: 'Invitation annulée', icon: 'i-lucide-link-2-off' })
  } catch (e) {
    toast.add({ title: 'Oups', description: errorMessage(e), color: 'error' })
  } finally {
    busy.value = false
  }
}

async function share() {
  const text = `${person.value?.name}, rejoins le foyer « ${household.value?.name} » sur Popotte & Placard`
  const result = await shareOrCopy(inviteUrl.value, 'Popotte & Placard', text)
  if (result === 'copied') toast.add({ title: 'Lien copié', icon: 'i-lucide-clipboard-check', color: 'success' })
  if (result === 'failed') toast.add({ title: 'Copie impossible', description: inviteUrl.value, color: 'warning' })
}

// --- Actions sensibles ---
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

function askUnlink() {
  confirmAction.value = {
    title: `Retirer l'accès de ${person.value?.name} ?`,
    description: 'Son compte n\'aura plus accès au foyer. La personne reste dans le foyer avec ses préférences propres au foyer ; celles de son compte ne seront plus reprises.',
    label: 'Retirer l\'accès',
    run: async () => {
      await sync()
      const { error } = await supabase.from('pp_people').update({ user_id: null }).eq('id', personId.value)
      if (error) throw error
      await sync()
    }
  }
}

function askLeave() {
  confirmAction.value = {
    title: 'Quitter ce foyer ?',
    description: 'Vous n\'y aurez plus accès, sauf nouvelle invitation. Votre prénom et les préférences propres au foyer y restent.',
    label: 'Quitter',
    run: async () => {
      await sync()
      const { error } = await supabase.rpc('pp_leave_household', { p_household_id: householdId.value })
      if (error) throw error
      await sync()
      try {
        localStorage.removeItem('pep:lastHousehold')
      } catch { /* ignore */ }
      await navigateTo('/')
    }
  }
}

function askDelete() {
  confirmAction.value = {
    title: `Retirer ${person.value?.name} du foyer ?`,
    description: person.value?.user_id
      ? 'Son compte perdra l\'accès au foyer et ses préférences propres au foyer seront supprimées.'
      : 'Ses préférences et recettes propres au foyer seront supprimées.',
    label: 'Retirer du foyer',
    run: async () => {
      await updatePerson(personId.value, { deleted_at: new Date().toISOString() })
      goBack()
    }
  }
}
</script>

<template>
  <div v-if="!person" class="py-10">
    <UEmpty
      icon="i-lucide-user-x"
      title="Personne introuvable"
      :actions="[{ label: 'Personnes du foyer', to: `/foyer/${householdId}/personnes` }]"
    />
  </div>

  <div v-else class="space-y-5">
    <div class="flex items-center gap-2">
      <UButton icon="i-lucide-arrow-left" color="neutral" variant="ghost" aria-label="Retour" @click="goBack" />
      <form v-if="editingName" class="flex-1" @submit.prevent="saveName">
        <UInput v-model="name" size="lg" class="w-full" autofocus @blur="saveName" />
      </form>
      <button v-else type="button" class="flex-1 min-w-0 text-left" @click="startEdit">
        <h1 class="text-xl font-bold truncate">
          {{ person.name }}
          <UIcon name="i-lucide-pencil" class="size-4 text-muted" />
        </h1>
      </button>
    </div>

    <!-- Compte lié -->
    <UCard>
      <div v-if="person.user_id" class="flex items-center gap-3">
        <UIcon name="i-lucide-user-check" class="size-6 text-success shrink-0" />
        <div class="flex-1 min-w-0">
          <p class="font-medium">
            {{ isMe ? 'Votre compte' : `Compte de ${accountName(person.user_id) ?? person.name}` }}
          </p>
          <p class="text-xs text-muted">
            Accès au foyer · les préférences du compte sont reprises ci-dessous (<UIcon name="i-lucide-link" class="size-3" />)
          </p>
        </div>
        <UButton v-if="isOwner && !isMe && person.role !== 'owner'" size="sm" color="error" variant="ghost" icon="i-lucide-user-minus" :disabled="!online" @click="askUnlink">
          Retirer
        </UButton>
        <UButton v-if="isMe && person.role !== 'owner'" size="sm" color="error" variant="ghost" icon="i-lucide-log-out" :disabled="!online" @click="askLeave">
          Quitter
        </UButton>
      </div>

      <div v-else class="space-y-3">
        <div class="flex items-center gap-3">
          <UIcon name="i-lucide-user" class="size-6 text-muted shrink-0" />
          <div class="flex-1">
            <p class="font-medium">
              Sans compte
            </p>
            <p class="text-xs text-muted">
              Invitez {{ person.name }} à lier son compte : il ou elle aura accès au foyer et ses préférences de compte seront reprises.
            </p>
          </div>
        </div>
        <UAlert v-if="!online" icon="i-lucide-wifi-off" color="warning" variant="soft" title="Connexion internet requise pour gérer l'invitation" />
        <template v-if="isOwner">
          <div v-if="inviteUrl" class="space-y-2">
            <UInput :model-value="inviteUrl" readonly class="w-full" :ui="{ base: 'text-xs' }" @focus="($event.target as HTMLInputElement).select()" />
            <div class="grid grid-cols-2 gap-2">
              <UButton icon="i-lucide-share-2" class="justify-center" @click="share">
                Partager
              </UButton>
              <UButton icon="i-lucide-link-2-off" color="error" variant="soft" class="justify-center" :loading="busy" :disabled="!online" @click="setInvite(null)">
                Annuler
              </UButton>
            </div>
            <p class="text-xs text-muted">
              Lien à usage unique. La personne doit déjà avoir un compte : sinon, un administrateur peut lui envoyer une invitation à créer son compte.
            </p>
          </div>
          <UButton v-else block icon="i-lucide-mail-plus" :loading="busy" :disabled="!online" @click="setInvite(randomToken())">
            Inviter {{ person.name }} à lier son compte
          </UButton>
        </template>
        <p v-else class="text-xs text-muted">
          Seul le propriétaire du foyer peut envoyer une invitation.
        </p>
      </div>
    </UCard>

    <TastesEditor
      v-if="personTastes"
      :preferences="personTastes.preferences"
      :recipes="personTastes.recipes"
      :owner="owner"
      :editable-account="isMe"
      :account-label="accountName(person.user_id) ?? undefined"
      :catalog="catalog"
    />
    <p v-if="person.user_id && !isMe" class="text-xs text-muted -mt-2">
      <UIcon name="i-lucide-link" class="size-3" /> = issu du compte (modifiable par son titulaire seulement). Ce que vous ajoutez ici complète ses goûts pour ce foyer uniquement.
    </p>

    <UButton
      v-if="isOwner && person.role !== 'owner'"
      block
      color="error"
      variant="soft"
      icon="i-lucide-user-x"
      @click="askDelete"
    >
      Retirer {{ person.name }} du foyer
    </UButton>

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
