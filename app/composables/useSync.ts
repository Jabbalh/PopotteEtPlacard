import type { Table } from 'dexie'
import type { AppDb, Household, SyncedTable } from '~/utils/db'

const online = ref(typeof navigator === 'undefined' ? true : navigator.onLine)
const syncing = ref(false)
const lastSyncAt = ref<Date | null>(null)
const lastError = ref<string | null>(null)
const pendingCount = ref(0)

let started = false
let running: Promise<void> | null = null
let rerun = false
let debounceTimer: ReturnType<typeof setTimeout> | null = null

/** Marge de recouvrement pour ne rater aucune ligne commitée en retard */
const CURSOR_OVERLAP_MS = 60_000
const PAGE_SIZE = 500
const BATCH_SIZE = 100

type Row = { id: string, _dirty: 0 | 1, _lmod: number, [k: string]: unknown }

/** Description d'une table synchronisée */
interface TableSpec {
  remote: string
  /** colonnes envoyées au serveur (updated_at est toujours horodaté par le serveur) */
  fields: readonly string[]
  /** rattachement : par foyer, et/ou par compte (préférences et recettes de niveau compte) */
  byHousehold: boolean
  byUser: boolean
}

const TABLES: Record<Exclude<SyncedTable, 'households'>, TableSpec> = {
  people: {
    remote: 'pp_people',
    // user_id / role / invite_token ne sont jamais envoyés par la synchro (voir pushPeople)
    fields: ['id', 'household_id', 'name', 'created_at', 'deleted_at'],
    byHousehold: true,
    byUser: false
  },
  locations: {
    remote: 'pp_locations',
    fields: ['id', 'household_id', 'label', 'icon', 'position', 'created_at', 'deleted_at'],
    byHousehold: true,
    byUser: false
  },
  foodTypes: {
    remote: 'pp_food_types',
    fields: ['id', 'household_id', 'label', 'position', 'created_at', 'deleted_at'],
    byHousehold: true,
    byUser: false
  },
  products: {
    remote: 'pp_products',
    fields: ['id', 'household_id', 'barcode', 'name', 'brand', 'description', 'ingredients', 'nutriscore', 'image_url', 'food_type_id', 'unit', 'rating', 'low_threshold', 'created_at', 'deleted_at'],
    byHousehold: true,
    byUser: false
  },
  stockItems: {
    remote: 'pp_stock_items',
    fields: ['id', 'household_id', 'product_id', 'location_id', 'quantity', 'purchased_on', 'expires_on', 'note', 'created_by', 'created_at', 'deleted_at'],
    byHousehold: true,
    byUser: false
  },
  movements: {
    remote: 'pp_stock_movements',
    fields: ['id', 'household_id', 'stock_item_id', 'kind', 'quantity', 'occurred_on', 'recipe_name', 'note', 'created_by', 'created_at', 'deleted_at'],
    byHousehold: true,
    byUser: false
  },
  preferences: {
    remote: 'pp_preferences',
    fields: ['id', 'user_id', 'household_id', 'person_id', 'label', 'level', 'created_at', 'deleted_at'],
    byHousehold: true,
    byUser: true
  },
  recipes: {
    remote: 'pp_recipes',
    fields: ['id', 'user_id', 'household_id', 'person_id', 'name', 'ingredients', 'instructions', 'created_at', 'deleted_at'],
    byHousehold: true,
    byUser: true
  }
}

const TABLE_NAMES = Object.keys(TABLES) as (keyof typeof TABLES)[]

function pick(obj: Record<string, unknown>, keys: readonly string[]) {
  const r: Record<string, unknown> = {}
  for (const k of keys) r[k] = obj[k] ?? null
  return r
}

function tableOf(db: AppDb, name: SyncedTable) {
  return db[name] as unknown as Table<Row, string>
}

/** Retire le marqueur « à envoyer » sauf si la ligne a encore été modifiée pendant l'envoi */
async function markClean(table: Table<Row, string>, rows: { id: string, _lmod: number }[]) {
  await Promise.all(rows.map(r =>
    table.where('id').equals(r.id).modify((row) => {
      if (row._lmod === r._lmod) row._dirty = 0
    })
  ))
}

function isPermissionError(err: { code?: string } | null) {
  return err?.code === '42501' || err?.code === 'PGRST301'
}

/** Efface toutes les données locales d'un foyer (supprimé ou quitté) */
async function purgeHousehold(db: AppDb, householdId: string) {
  await db.households.delete(householdId)
  for (const name of TABLE_NAMES) {
    await tableOf(db, name).where('household_id').equals(householdId).delete()
    await db.meta.delete(`${name}:${householdId}`)
  }
}

/**
 * Synchronisation bidirectionnelle IndexedDB <-> Supabase.
 * - Toute écriture est d'abord locale (marquée _dirty), puis poussée.
 * - Les changements distants sont tirés par foyer (et par compte pour les préférences
 *   et recettes de niveau compte) grâce à updated_at, horodaté par le serveur.
 * - Conflits : la dernière écriture envoyée l'emporte ; une modif locale non envoyée n'est jamais écrasée.
 * - Les suppressions sont « douces » (deleted_at) : les lignes supprimées restent en local, filtrées à l'affichage.
 */
export function useSync() {
  const supabase = useSupabase()
  const { user } = useAuth()

  async function refreshPending() {
    if (!user.value) return
    const db = openDb(user.value.id)
    let count = 0
    for (const name of ['households', ...TABLE_NAMES] as SyncedTable[]) {
      count += await tableOf(db, name).where('_dirty').equals(1).count()
    }
    pendingCount.value = count
  }

  async function pushHouseholds(db: AppDb, userId: string) {
    const dirty = await db.households.where('_dirty').equals(1).toArray()
    for (const h of dirty) {
      const isOwner = h.created_by === userId
        || !!(await db.people.where('household_id').equals(h.id).filter(p => p.user_id === userId && p.role === 'owner').first())
      const payload: Record<string, unknown> = { id: h.id, name: h.name, created_by: h.created_by, created_at: h.created_at }
      // Seul le propriétaire peut supprimer : on n'envoie pas ce champ sinon (refus serveur)
      if (isOwner) payload.deleted_at = h.deleted_at
      const { error } = await supabase.from('pp_households').upsert(payload)
      if (error && !isPermissionError(error)) throw error
      if (error) console.warn('[sync] foyer refusé', h.id, error.message)
      await markClean(db.households as unknown as Table<Row, string>, [h])
    }
  }

  /** Envoie les lignes modifiées localement d'une table, par lots */
  async function pushRows(db: AppDb, name: keyof typeof TABLES, userId: string) {
    const spec = TABLES[name]
    const table = tableOf(db, name)
    const households = name === 'people' ? new Map((await db.households.toArray()).map(h => [h.id, h])) : null
    const toPayload = (row: Row) => {
      const payload = pick(row, spec.fields)
      // Le créateur d'un foyer se lie lui-même à sa personne (seul cas autorisé par le serveur)
      if (name === 'people' && row.user_id === userId && households?.get(row.household_id as string)?.created_by === userId) {
        payload.user_id = row.user_id
        payload.role = row.role
      }
      return payload
    }

    const dirty = await table.where('_dirty').equals(1).toArray()
    for (let i = 0; i < dirty.length; i += BATCH_SIZE) {
      const batch = dirty.slice(i, i + BATCH_SIZE)
      const { error } = await supabase.from(spec.remote).upsert(batch.map(toPayload))
      if (!error) {
        await markClean(table, batch)
        continue
      }
      if (!isPermissionError(error)) throw error
      // Lot refusé : on isole la ou les lignes fautives (foyer quitté, etc.)
      for (const row of batch) {
        const { error: e } = await supabase.from(spec.remote).upsert(toPayload(row))
        if (e && !isPermissionError(e)) throw e
        if (e) console.warn(`[sync] ${spec.remote} refusé`, row.id, e.message)
        await markClean(table, [row])
      }
    }
  }

  /** Foyers visibles ; purge locale de ceux qui ont été supprimés ou quittés */
  async function pullHouseholds(db: AppDb) {
    const { data, error } = await supabase.from('pp_households').select('*')
    if (error) throw error
    const remoteIds = new Set(data.map(h => h.id as string))
    const active: string[] = []
    for (const h of data) {
      const local = await db.households.get(h.id)
      if (h.deleted_at) {
        if (!local?._dirty) await purgeHousehold(db, h.id)
        continue
      }
      active.push(h.id)
      if (local?._dirty) continue
      await db.households.put({ ...h, _dirty: 0, _lmod: local?._lmod ?? 0 } as Household)
    }
    // Foyers dont on n'est plus membre (et qui ne sont pas en attente de création)
    for (const l of await db.households.toArray()) {
      if (!remoteIds.has(l.id) && !l._dirty) await purgeHousehold(db, l.id)
    }
    return active
  }

  /** Tire les changements distants d'une table depuis le dernier curseur */
  async function pullRows(db: AppDb, name: keyof typeof TABLES, column: 'household_id' | 'user_id', value: string) {
    const spec = TABLES[name]
    const table = tableOf(db, name)
    const cursorKey = column === 'household_id' ? `${name}:${value}` : `${name}:u:${value}`
    let cursor = ((await db.meta.get(cursorKey))?.value as string | undefined) ?? '1970-01-01T00:00:00Z'
    const since = new Date(new Date(cursor).getTime() - CURSOR_OVERLAP_MS).toISOString()
    let from = 0
    while (true) {
      const { data, error } = await supabase
        .from(spec.remote)
        .select('*')
        .eq(column, value)
        .gt('updated_at', since)
        .order('updated_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + PAGE_SIZE - 1)
      if (error) throw error
      if (!data.length) break

      await db.transaction('rw', table, async () => {
        for (const row of data) {
          const local = await table.get(row.id)
          if (local?._dirty) continue
          await table.put({ ...row, _dirty: 0, _lmod: local?._lmod ?? 0 })
        }
      })
      const last = data[data.length - 1]!.updated_at as string
      if (new Date(last) > new Date(cursor)) cursor = last
      if (data.length < PAGE_SIZE) break
      from += PAGE_SIZE
    }
    await db.meta.put({ key: cursorKey, value: cursor })
  }

  /**
   * Préférences et recettes des comptes liés à mes foyers (et les miennes).
   * Celles des comptes qui ne sont plus visibles sont retirées de la base locale.
   */
  async function pullUsers(db: AppDb, userId: string, householdIds: string[]) {
    const people = await db.people.where('household_id').anyOf(householdIds).toArray()
    const userIds = [...new Set([userId, ...people.filter(p => p.user_id && !p.deleted_at).map(p => p.user_id!)])]

    for (const uid of userIds) {
      await pullRows(db, 'preferences', 'user_id', uid)
      await pullRows(db, 'recipes', 'user_id', uid)
    }

    const visible = new Set(userIds)
    for (const name of ['preferences', 'recipes'] as const) {
      await tableOf(db, name).filter(r => !!r.user_id && !visible.has(r.user_id as string) && !r._dirty).delete()
    }
    const staleCursors = (await db.meta.toCollection().primaryKeys())
      .filter(k => /^(preferences|recipes):u:/.test(k) && !visible.has(k.split(':')[2]!))
    await db.meta.bulkDelete(staleCursors)

    // Noms affichés des comptes liés
    const { data, error } = await supabase.from('profiles').select('id, display_name').in('id', userIds)
    if (error) throw error
    await db.profiles.bulkPut(data)
  }

  async function doSync() {
    if (!user.value || !online.value) return
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    const userId = user.value.id
    const db = openDb(userId)
    syncing.value = true
    try {
      await pushHouseholds(db, userId)
      for (const name of TABLE_NAMES) await pushRows(db, name, userId)

      const householdIds = await pullHouseholds(db)
      for (const id of householdIds) {
        for (const name of TABLE_NAMES) {
          if (TABLES[name].byHousehold) await pullRows(db, name, 'household_id', id)
        }
      }
      await pullUsers(db, userId, householdIds)

      lastSyncAt.value = new Date()
      lastError.value = null
    } catch (e) {
      lastError.value = e instanceof Error ? e.message : String(e)
      console.error('[sync]', e)
    } finally {
      syncing.value = false
      await refreshPending()
    }
  }

  /** Lance une synchro (les appels concurrents sont fusionnés) */
  function sync(): Promise<void> {
    if (running) {
      rerun = true
      return running
    }
    running = (async () => {
      do {
        rerun = false
        await doSync()
      } while (rerun)
    })().finally(() => {
      running = null
    })
    return running
  }

  /** À appeler après chaque écriture locale */
  function schedule(delay = 800) {
    refreshPending()
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => sync(), delay)
  }

  function start() {
    if (started || typeof window === 'undefined') return
    started = true
    window.addEventListener('online', () => {
      online.value = true
      sync()
    })
    window.addEventListener('offline', () => {
      online.value = false
    })
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') sync()
    })
    setInterval(() => {
      if (document.visibilityState === 'visible') sync()
    }, 30_000)
    sync()
  }

  return { online, syncing, lastSyncAt, lastError, pendingCount, sync, schedule, start, refreshPending }
}
