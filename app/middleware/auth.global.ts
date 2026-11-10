export default defineNuxtRouteMiddleware(async (to) => {
  const { user, isAdmin, init } = useAuth()
  await init()

  if (!user.value && !isPublicRoute(to.path)) {
    return navigateTo({ path: '/connexion', query: to.fullPath !== '/' ? { redirect: to.fullPath } : {} })
  }
  if (user.value && to.path === '/connexion') {
    const redirect = typeof to.query.redirect === 'string' && to.query.redirect.startsWith('/') ? to.query.redirect : '/'
    return navigateTo(redirect)
  }
  if (to.path.startsWith('/admin') && !isAdmin.value) {
    return navigateTo('/')
  }
})
