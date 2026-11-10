import { isAuthRetryableFetchError, type Session } from '@supabase/supabase-js'

export interface AppUser {
  id: string
  email: string
}

const CACHE_KEY = 'pep:user'
const ADMIN_KEY = 'pep:admin'

function readCachedUser(): AppUser | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writeCachedUser(user: AppUser | null) {
  try {
    if (user) localStorage.setItem(CACHE_KEY, JSON.stringify(user))
    else localStorage.removeItem(CACHE_KEY)
  } catch { /* stockage indisponible */ }
}

const user = ref<AppUser | null>(null)
/** Administrateur de l'application (affichage uniquement : les droits sont vérifiés par la base) */
const isAdmin = ref(false)
const ready = ref(false)
/**
 * Session définitivement perdue (jeton expiré ou révoqué) sans déconnexion volontaire :
 * 'startup' = constaté au lancement (le middleware redirige), 'live' = en cours d'utilisation
 */
const sessionExpired = ref<false | 'startup' | 'live'>(false)
let initPromise: Promise<void> | null = null
/** lecture du rôle admin en cours (ou terminée) */
let rolePromise: Promise<void> | null = null
/** déconnexion demandée par l'utilisateur en cours (l'événement SIGNED_OUT n'est alors pas une expiration) */
let signingOut = false

const PUBLIC_ROUTES = ['/connexion', '/nouveau-mot-de-passe']

/** Route accessible sans être connecté */
export function isPublicRoute(path: string) {
  return PUBLIC_ROUTES.includes(path) || path.startsWith('/inscription/')
}

function clearUser() {
  user.value = null
  isAdmin.value = false
  writeCachedUser(null)
  writeCachedAdmin(null)
}

/**
 * La session n'existe plus côté Supabase : on oublie l'utilisateur en cache, sinon l'app
 * resterait utilisable en apparence alors que plus rien n'est envoyé au serveur.
 * La base locale est conservée : les modifications en attente partiront à la reconnexion.
 */
function expireSession() {
  if (!user.value) return
  clearUser()
  sessionExpired.value = ready.value ? 'live' : 'startup'
}

function fromSession(session: Session | null): AppUser | null {
  if (!session?.user) return null
  return { id: session.user.id, email: session.user.email ?? '' }
}

function readCachedAdmin(userId: string) {
  try {
    return localStorage.getItem(ADMIN_KEY) === userId
  } catch {
    return false
  }
}

function writeCachedAdmin(userId: string | null) {
  try {
    if (userId) localStorage.setItem(ADMIN_KEY, userId)
    else localStorage.removeItem(ADMIN_KEY)
  } catch { /* stockage indisponible */ }
}

export function useSupabase() {
  return useNuxtApp().$supabase
}

/**
 * Authentification. Hors connexion, on conserve le dernier utilisateur connu :
 * l'app reste utilisable même si le jeton ne peut pas être rafraîchi.
 */
export function useAuth() {
  const supabase = useSupabase()

  /** Charge le rôle admin (hors ligne : dernière valeur connue) */
  function loadRole(u: AppUser) {
    isAdmin.value = readCachedAdmin(u.id)
    rolePromise = (async () => {
      const { data, error } = await supabase.from('app_admins').select('user_id').eq('user_id', u.id).maybeSingle()
      // un autre compte s'est connecté entre-temps : sa propre lecture fait foi
      if (error || user.value?.id !== u.id) return
      isAdmin.value = !!data
      writeCachedAdmin(data ? u.id : null)
    })().catch(() => { /* hors ligne : dernière valeur connue */ })
    return rolePromise
  }

  /**
   * Attend la lecture du rôle en cours. `isAdmin` vaut d'abord la dernière valeur connue :
   * sans cache (première visite sur l'appareil), il est faux tant que le serveur n'a pas répondu.
   */
  function roleLoaded(): Promise<void> {
    return rolePromise ?? Promise.resolve()
  }

  /**
   * Session courante. `state` :
   * - 'ok' : session valide ;
   * - 'none' : définitivement absente (jamais connecté, jeton expiré ou révoqué) ;
   * - 'unknown' : impossible à vérifier (hors ligne, serveur injoignable) — on garde l'utilisateur en cache.
   */
  async function loadSession(): Promise<{ session: Session | null, state: 'ok' | 'none' | 'unknown' }> {
    try {
      const { data, error } = await supabase.auth.getSession()
      if (data.session) return { session: data.session, state: 'ok' }
      return { session: null, state: error && isAuthRetryableFetchError(error) ? 'unknown' : 'none' }
    } catch {
      return { session: null, state: 'unknown' }
    }
  }

  function init() {
    if (initPromise) return initPromise
    initPromise = (async () => {
      user.value = readCachedUser()
      const { session, state } = await loadSession()
      const u = fromSession(session)
      if (u) {
        user.value = u
        writeCachedUser(u)
      } else if (state === 'none') {
        // utilisateur en cache mais plus de session : expirée ou révoquée depuis la dernière visite
        expireSession()
      }
      if (user.value) loadRole(user.value)

      supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT') {
          // hors déconnexion volontaire : jeton de rafraîchissement refusé, ou déconnexion dans un autre onglet
          if (signingOut) clearUser()
          else expireSession()
          return
        }
        const u = fromSession(session)
        if (u) {
          const changed = u.id !== user.value?.id
          user.value = u
          writeCachedUser(u)
          sessionExpired.value = false
          if (changed || event === 'SIGNED_IN') loadRole(u)
        }
      })
      ready.value = true
    })()
    return initPromise
  }

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }

  /**
   * Inscription : réservée aux invitations à l'application créées par un administrateur
   * (et aux emails autorisés), contrôle fait côté serveur.
   */
  async function signUp(email: string, password: string, displayName: string, appInvite: string) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: displayName, app_invite: appInvite },
        emailRedirectTo: `${location.origin}/connexion`
      }
    })
    if (error) throw error
    return { needsConfirmation: !data.session }
  }

  async function resetPassword(email: string) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${location.origin}/nouveau-mot-de-passe`
    })
    if (error) throw error
  }

  async function updatePassword(password: string) {
    const { error } = await supabase.auth.updateUser({ password })
    if (error) throw error
  }

  async function signOut() {
    signingOut = true
    try {
      await supabase.auth.signOut({ scope: 'local' })
    } finally {
      clearUser()
      signingOut = false
    }
  }

  return { user, isAdmin, ready, sessionExpired, init, roleLoaded, loadSession, expireSession, signIn, signUp, signOut, resetPassword, updatePassword }
}
