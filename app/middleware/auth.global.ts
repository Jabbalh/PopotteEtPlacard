export default defineNuxtRouteMiddleware(async (to) => {
  const { user, isAdmin, init, roleLoaded } = useAuth()
  await init()

  if (!user.value && !isPublicRoute(to.path)) {
    return navigateTo({ path: '/connexion', query: to.fullPath !== '/' ? { redirect: to.fullPath } : {} })
  }
  if (user.value && to.path === '/connexion') {
    const redirect = typeof to.query.redirect === 'string' && to.query.redirect.startsWith('/') ? to.query.redirect : '/'
    return navigateTo(redirect)
  }
  if (to.path.startsWith('/admin')) {
    // sans rôle en cache (première ouverture sur cet appareil), on attend la réponse du serveur
    if (!isAdmin.value) await roleLoaded()
    if (!isAdmin.value) return navigateTo('/')
  }
})
