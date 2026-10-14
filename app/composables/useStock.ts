import type { Person, Preference, Product, Recipe, StockItem, StockMovement } from '~/utils/db'

/** Un lot en stock avec sa quantité restante */
export interface Lot {
  item: StockItem
  product: Product
  remaining: number
}

/** Ligne de la popin de sortie de stock */
export interface TakeLine {
  lot: Lot
  /** quantité proposée (sinon la totalité du lot) */
  suggested?: number | null
  /** ligne cochée par défaut */
  selected?: boolean
  /** libellé d'ingrédient (recette) */
  ingredient?: string
}

/** Un produit et l'ensemble de ses lots disponibles */
export interface ProductStock {
  product: Product
  lots: Lot[]
  total: number
  /** péremption la plus proche parmi les lots disponibles */
  nextExpiry: string | null
}

/** Arrondi pour éviter les restes du type 0,30000000000000004 */
function round(n: number) {
  return Math.round(n * 1000) / 1000
}

/**
 * Stock d'un foyer (réactif) : quantité restante d'un lot = quantité initiale
 * moins la somme de ses sorties (utilisé, jeté, offert, ajustement).
 */
export function useStock(householdId: Ref<string>) {
  const db = useDb()

  const { data, loading } = useLiveQuery(
    async () => {
      const [products, items, movements] = await Promise.all([
        db.products.where('household_id').equals(householdId.value).toArray(),
        db.stockItems.where('household_id').equals(householdId.value).toArray(),
        db.movements.where('household_id').equals(householdId.value).toArray()
      ])
      return { products, items, movements }
    },
    { products: [] as Product[], items: [] as StockItem[], movements: [] as StockMovement[] },
    [householdId]
  )

  const products = computed(() => data.value.products.filter(p => !p.deleted_at).sort((a, b) => a.name.localeCompare(b.name)))
  const productById = computed(() => new Map(data.value.products.map(p => [p.id, p])))
  const movements = computed(() => data.value.movements.filter(m => !m.deleted_at))

  const removedByItem = computed(() => {
    const map = new Map<string, number>()
    for (const m of movements.value) map.set(m.stock_item_id, (map.get(m.stock_item_id) ?? 0) + Number(m.quantity))
    return map
  })

  /** Tous les lots (y compris épuisés) */
  const allLots = computed<Lot[]>(() => data.value.items
    .filter(i => !i.deleted_at && productById.value.has(i.product_id) && !productById.value.get(i.product_id)!.deleted_at)
    .map(item => ({
      item,
      product: productById.value.get(item.product_id)!,
      remaining: round(Number(item.quantity) - (removedByItem.value.get(item.id) ?? 0))
    })))

  /** Lots encore en stock, triés par date de péremption croissante (sans date à la fin) */
  const lots = computed(() => allLots.value
    .filter(l => l.remaining > 0)
    .sort((a, b) => (a.item.expires_on ?? '9999').localeCompare(b.item.expires_on ?? '9999') || a.product.name.localeCompare(b.product.name)))

  /** Stock par produit (y compris les produits sans stock, pour les ruptures) */
  const byProduct = computed<ProductStock[]>(() => {
    const map = new Map<string, ProductStock>()
    for (const p of products.value) map.set(p.id, { product: p, lots: [], total: 0, nextExpiry: null })
    for (const l of lots.value) {
      const s = map.get(l.product.id)
      if (!s) continue
      s.lots.push(l)
      s.total = round(s.total + l.remaining)
      if (l.item.expires_on && (!s.nextExpiry || l.item.expires_on < s.nextExpiry)) s.nextExpiry = l.item.expires_on
    }
    return [...map.values()]
  })

  function movementsOf(itemIds: string[]) {
    const set = new Set(itemIds)
    return movements.value.filter(m => set.has(m.stock_item_id)).sort((a, b) => b.occurred_on.localeCompare(a.occurred_on) || b.created_at.localeCompare(a.created_at))
  }

  return { loading, products, productById, allLots, lots, byProduct, movementsOf }
}

/** Préférences et recettes d'une personne : celles de son compte (si lié) + celles du foyer */
export interface PersonTastes {
  person: Person
  preferences: (Preference & { fromAccount: boolean })[]
  recipes: (Recipe & { fromAccount: boolean })[]
}

export function useHouseholdTastes(householdId: Ref<string>) {
  const db = useDb()

  const { data } = useLiveQuery(
    async () => {
      const people = (await db.people.where('household_id').equals(householdId.value).toArray()).filter(p => !p.deleted_at)
      const userIds = people.map(p => p.user_id).filter((id): id is string => !!id)
      const [hPrefs, uPrefs, hRecipes, uRecipes] = await Promise.all([
        db.preferences.where('household_id').equals(householdId.value).toArray(),
        userIds.length ? db.preferences.where('user_id').anyOf(userIds).toArray() : [],
        db.recipes.where('household_id').equals(householdId.value).toArray(),
        userIds.length ? db.recipes.where('user_id').anyOf(userIds).toArray() : []
      ])
      return people
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map<PersonTastes>(person => ({
          person,
          preferences: [
            ...uPrefs.filter(p => person.user_id && p.user_id === person.user_id).map(p => ({ ...p, fromAccount: true })),
            ...hPrefs.filter(p => p.person_id === person.id).map(p => ({ ...p, fromAccount: false }))
          ].filter(p => !p.deleted_at),
          recipes: [
            ...uRecipes.filter(r => person.user_id && r.user_id === person.user_id).map(r => ({ ...r, fromAccount: true })),
            ...hRecipes.filter(r => r.person_id === person.id).map(r => ({ ...r, fromAccount: false }))
          ].filter(r => !r.deleted_at).sort((a, b) => a.name.localeCompare(b.name))
        }))
    },
    [] as PersonTastes[],
    [householdId]
  )

  return { tastes: data }
}

/** Mes préférences et recettes de niveau compte */
export function useMyTastes() {
  const db = useDb()
  const { user } = useAuth()
  const userId = user.value!.id

  const { data: preferences } = useLiveQuery(
    async () => (await db.preferences.where('user_id').equals(userId).toArray()).filter(p => !p.deleted_at),
    [] as Preference[]
  )
  const { data: recipes } = useLiveQuery(
    async () => (await db.recipes.where('user_id').equals(userId).toArray()).filter(r => !r.deleted_at).sort((a, b) => a.name.localeCompare(b.name)),
    [] as Recipe[]
  )
  return { preferences, recipes, owner: { userId } as TasteOwner }
}
