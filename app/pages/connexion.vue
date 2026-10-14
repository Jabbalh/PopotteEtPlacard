<script setup lang="ts">
definePageMeta({ layout: 'auth' })

const route = useRoute()
const { signIn, resetPassword } = useAuth()
const toast = useToast()

const mode = ref<'login' | 'reset'>('login')
const loading = ref(false)
const form = reactive({ email: '', password: '' })

const redirectTo = computed(() =>
  typeof route.query.redirect === 'string' && route.query.redirect.startsWith('/') ? route.query.redirect : '/')
/** Arrivée par une invitation à rejoindre un foyer */
const isHouseholdInvite = computed(() => redirectTo.value.startsWith('/rejoindre/'))

async function submit() {
  loading.value = true
  try {
    if (mode.value === 'login') {
      await signIn(form.email, form.password)
      await navigateTo(redirectTo.value)
    } else {
      await resetPassword(form.email)
      toast.add({ title: 'Email envoyé', description: 'Suivez le lien reçu pour choisir un nouveau mot de passe.', color: 'success' })
      mode.value = 'login'
    }
  } catch (e) {
    toast.add({ title: 'Oups', description: errorMessage(e), color: 'error' })
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <UCard>
    <UAlert
      v-if="isHouseholdInvite"
      class="mb-4"
      icon="i-lucide-mail-open"
      color="primary"
      variant="soft"
      title="Vous êtes invité à rejoindre un foyer"
      description="Connectez-vous pour accepter l'invitation. Pas encore de compte ? Demandez un lien d'inscription à un administrateur de l'application."
    />

    <h2 class="font-semibold mb-4">
      {{ mode === 'reset' ? 'Mot de passe oublié' : 'Connexion' }}
    </h2>

    <form class="space-y-4" @submit.prevent="submit">
      <UFormField label="Email" required>
        <UInput v-model="form.email" type="email" size="xl" class="w-full" required autocomplete="email" inputmode="email" />
      </UFormField>
      <UFormField v-if="mode === 'login'" label="Mot de passe" required>
        <UInput v-model="form.password" type="password" size="xl" class="w-full" required minlength="6" autocomplete="current-password" />
      </UFormField>

      <UButton type="submit" block size="xl" :loading="loading">
        {{ mode === 'login' ? 'Se connecter' : 'Envoyer le lien' }}
      </UButton>
    </form>

    <div class="mt-4 text-center text-sm">
      <UButton v-if="mode === 'login'" variant="link" color="neutral" @click="mode = 'reset'">
        Mot de passe oublié ?
      </UButton>
      <UButton v-else variant="link" color="neutral" @click="mode = 'login'">
        Retour à la connexion
      </UButton>
      <p v-if="mode === 'login' && !isHouseholdInvite" class="text-xs text-muted mt-3">
        Pas encore de compte ? L'inscription se fait uniquement via un lien d'invitation envoyé par un administrateur.
      </p>
    </div>
  </UCard>
</template>
