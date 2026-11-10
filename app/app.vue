<script setup lang="ts">
const { user, sessionExpired } = useAuth()
const { start } = useSync()
const route = useRoute()
const toast = useToast()

watch(user, (u) => {
  if (u) start()
}, { immediate: true })

// Session perdue sans déconnexion volontaire : on le dit, et on renvoie vers la connexion
watch(sessionExpired, (expired) => {
  if (!expired) return
  toast.add({
    title: 'Session expirée',
    description: 'Reconnectez-vous pour continuer. Les modifications non envoyées sont conservées sur cet appareil.',
    color: 'warning',
    duration: 8000
  })
  // au lancement, le middleware fait déjà la redirection
  if (expired === 'live' && !isPublicRoute(route.path)) {
    navigateTo({ path: '/connexion', query: route.fullPath !== '/' ? { redirect: route.fullPath } : {} })
  }
}, { immediate: true })
</script>

<template>
  <UApp :toaster="{ position: 'top-center', duration: 4000 }">
    <NuxtPwaManifest />
    <ClientOnly>
      <PwaPrompts />
    </ClientOnly>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
