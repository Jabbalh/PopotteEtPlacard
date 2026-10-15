<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { Household } from '~/utils/db'

const route = useRoute()
const { user, isAdmin, signOut } = useAuth()
const { pendingCount } = useSync()
const toast = useToast()

const householdId = computed(() => (route.path.startsWith('/foyer/') ? route.params.id as string | undefined : undefined) ?? null)

// Nom du foyer affiché dans la barre latérale (PC)
const { data: household } = useLiveQuery(
  () => (user.value && householdId.value ? openDb(user.value.id).households.get(householdId.value) : undefined),
  undefined as Household | undefined,
  [householdId, user]
)

const navItems = computed(() => {
  if (!householdId.value) return []
  const base = `/foyer/${householdId.value}`
  return [
    { label: 'Stock', icon: 'i-lucide-refrigerator', to: base, exact: true, also: `${base}/produit` },
    { label: 'Idées', icon: 'i-lucide-chef-hat', to: `${base}/idees` },
    { label: 'Courses', icon: 'i-lucide-shopping-cart', to: `${base}/courses` },
    { label: 'Bilan', icon: 'i-lucide-clipboard-list', to: `${base}/bilan` },
    { label: 'Personnes', icon: 'i-lucide-users', to: `${base}/personnes` },
    { label: 'Réglages', icon: 'i-lucide-settings', to: `${base}/reglages` }
  ]
})

function isActive(item: { to: string, exact?: boolean, also?: string }) {
  if (item.also && route.path.startsWith(item.also)) return true
  return item.exact ? route.path === item.to : route.path.startsWith(item.to)
}

async function logout() {
  if (pendingCount.value > 0 && !confirm(`${pendingCount.value} modification(s) n'ont pas encore été synchronisées. Se déconnecter quand même ?`)) return
  await signOut()
  toast.add({ title: 'Déconnecté', icon: 'i-lucide-log-out' })
  await navigateTo('/connexion')
}

const userMenu = computed<DropdownMenuItem[][]>(() => [
  [{ label: user.value?.email ?? '', type: 'label' }],
  [
    { label: 'Mes foyers', icon: 'i-lucide-house', to: '/' },
    { label: 'Mes goûts et recettes', icon: 'i-lucide-heart', to: '/mes-gouts' },
    { label: 'Mon profil', icon: 'i-lucide-user', to: '/profil' },
    ...(isAdmin.value ? [{ label: 'Administration', icon: 'i-lucide-shield-check', to: '/admin' }] : [])
  ],
  [{ label: 'Se déconnecter', icon: 'i-lucide-log-out', color: 'error', onSelect: logout }]
])
</script>

<template>
  <div class="min-h-dvh flex flex-col bg-default">
    <header class="sticky top-0 z-30 bg-default/85 backdrop-blur border-b border-default pt-[env(safe-area-inset-top)]">
      <div class="max-w-2xl md:max-w-4xl lg:max-w-7xl mx-auto h-14 px-4 lg:px-6 flex items-center gap-2">
        <NuxtLink to="/" class="flex items-center gap-2 font-bold text-lg min-w-0">
          <img src="/icon.svg" alt="" class="size-7 shrink-0">
          <span class="truncate">Popotte &amp; Placard</span>
        </NuxtLink>
        <div class="ml-auto flex items-center gap-1">
          <SyncStatus v-if="user" />
          <UDropdownMenu v-if="user" :items="userMenu" :content="{ align: 'end' }">
            <UButton icon="i-lucide-circle-user-round" color="neutral" variant="ghost" aria-label="Menu utilisateur" />
          </UDropdownMenu>
        </div>
      </div>
    </header>

    <div class="flex-1 w-full lg:max-w-7xl lg:mx-auto lg:flex">
      <!-- PC : navigation du foyer en barre latérale -->
      <aside
        v-if="navItems.length"
        class="hidden lg:flex flex-col gap-1 w-60 shrink-0 sticky top-14 self-start h-[calc(100dvh-3.5rem)] px-4 py-6 border-r border-default"
      >
        <NuxtLink to="/" class="flex items-center gap-1 text-xs text-muted hover:text-default mb-1">
          <UIcon name="i-lucide-chevron-left" class="size-3.5" /> Mes foyers
        </NuxtLink>
        <p class="font-bold text-lg truncate mb-3">
          {{ household?.name }}
        </p>
        <NuxtLink
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          class="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
          :class="isActive(item) ? 'bg-primary/10 text-primary' : 'text-muted hover:bg-elevated hover:text-default'"
        >
          <UIcon :name="item.icon" class="size-5" />
          {{ item.label }}
        </NuxtLink>
      </aside>

      <main
        class="flex-1 min-w-0 w-full max-w-2xl md:max-w-4xl lg:max-w-none mx-auto px-4 lg:px-8 py-4 lg:py-6"
        :class="navItems.length ? 'pb-28 lg:pb-10' : 'pb-8'"
      >
        <slot />
      </main>
    </div>

    <nav
      v-if="navItems.length"
      class="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-default/90 backdrop-blur border-t border-default pb-[env(safe-area-inset-bottom)]"
    >
      <div class="max-w-2xl md:max-w-4xl mx-auto grid grid-cols-6">
        <NuxtLink
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          class="flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium transition-colors"
          :class="isActive(item) ? 'text-primary' : 'text-muted hover:text-default'"
        >
          <UIcon :name="item.icon" class="size-6" />
          {{ item.label }}
        </NuxtLink>
      </div>
    </nav>
  </div>
</template>
