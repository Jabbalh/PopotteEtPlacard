import type { Table } from 'dexie'

/** Table Dexie dont on modifie une ligne par identifiant */
interface Updatable {
  update(key: string, changes: never): PromiseLike<number>
}
import type {
  FoodType, Household, Ingredient, Location, MovementKind, Person, Preference,
  PreferenceLevel, Product, Recipe, StockItem, StockMovement
} from '~/utils/db'

function nowIso() {
  return new Date().toISOString()
}

/** Champs communs à toute nouvelle ligne locale */
function base() {
  const now = nowIso()
  return { id: crypto.randomUUID(), created_at: now, updated_at: now, deleted_at: null, _dirty: 1 as const, _lmod: Date.now() }
}

function dirty() {
  return { _dirty: 1 as const, _lmod: Date.now() }
}

/** Propriétaire d'une préférence ou d'une recette : mon compte, ou une personne d'un foyer */
export type TasteOwner = { userId: string } | { personId: string, householdId: string }

function ownerFields(owner: TasteOwner) {
  return 'userId' in owner
    ? { user_id: owner.userId, household_id: null, person_id: null }
    : { user_id: null, household_id: owner.householdId, person_id: owner.personId }
}

export type OptionTable = 'locations' | 'foodTypes'

export interface ProductInput {
  barcode?: string | null
  name: string
  brand?: string
  description?: string
  ingredients?: string
  nutriscore?: Product['nutriscore']
  image_url?: string | null
  food_type_id?: string | null
  unit?: string
  rating?: number
  low_threshold?: number
}

export interface StockItemInput {
  product_id: string
  location_id: string | null
  quantity: number
  purchased_on: string
  expires_on: string | null
  note?: string
}

export interface MovementInput {
  stock_item_id: string
  kind: MovementKind
  quantity: number
  occurred_on: string
  recipe_name?: string | null
  note?: string
}

export function useHouseholdActions() {
  const db = useDb()
  const { user } = useAuth()
  const { schedule } = useSync()

  async function patch<T>(table: Updatable, id: string, changes: Partial<T>, delay?: number) {
    await table.update(id, { ...changes, ...dirty() } as never)
    schedule(delay)
  }

  // --- Foyers ---

  async function createHousehold(input: { name: string, myName: string }) {
    const userId = user.value!.id
    const household: Household = { ...base(), name: input.name.trim(), created_by: userId }
    const me: Person = { ...base(), household_id: household.id, name: input.myName.trim(), user_id: userId, role: 'owner', invite_token: null }
    await db.transaction('rw', [db.households, db.people, db.locations, db.foodTypes], async () => {
      await db.households.add(household)
      await db.people.add(me)
      await db.locations.bulkAdd(DEFAULT_LOCATIONS.map((l, i) => ({ ...base(), household_id: household.id, label: l.label, icon: l.icon, position: i + 1 })))
      await db.foodTypes.bulkAdd(DEFAULT_FOOD_TYPES.map((label, i) => ({ ...base(), household_id: household.id, label, position: i + 1 })))
    })
    schedule(0)
    return household
  }

  const updateHousehold = (id: string, changes: Partial<Pick<Household, 'name' | 'deleted_at'>>) =>
    patch(db.households, id, changes, 0)

  // --- Personnes ---

  async function addPerson(householdId: string, name: string) {
    const person: Person = { ...base(), household_id: householdId, name: name.trim(), user_id: null, role: 'member', invite_token: null }
    await db.people.add(person)
    schedule()
    return person
  }

  const updatePerson = (id: string, changes: Partial<Pick<Person, 'name' | 'deleted_at'>>) =>
    patch(db.people, id, changes)

  // --- Lieux de stockage / types d'aliments ---

  function optionTable(name: OptionTable) {
    return (name === 'locations' ? db.locations : db.foodTypes) as unknown as Table<Location, string>
  }

  async function addOption(name: OptionTable, householdId: string, label: string, icon = '') {
    const table = optionTable(name)
    const siblings = await table.where('household_id').equals(householdId).toArray()
    // Un élément archivé du même nom est restauré plutôt que dupliqué
    const existing = siblings.find(o => o.label.toLowerCase() === label.trim().toLowerCase())
    if (existing) {
      if (existing.deleted_at) await updateOption(name, existing.id, { deleted_at: null })
      return existing
    }
    const option = { ...base(), household_id: householdId, label: label.trim(), position: Math.max(0, ...siblings.map(o => o.position)) + 1, ...(name === 'locations' ? { icon: icon || 'i-lucide-package' } : {}) }
    await table.add(option as Location)
    schedule()
    return option as Location
  }

  const updateOption = (name: OptionTable, id: string, changes: Partial<Pick<Location, 'label' | 'icon' | 'position' | 'deleted_at'>>) =>
    patch(optionTable(name), id, changes)

  /** Réécrit les positions dans l'ordre donné (seules les lignes modifiées sont marquées à envoyer) */
  async function reorderOptions(name: OptionTable, ordered: { id: string, position: number }[]) {
    const table = optionTable(name)
    const lmod = Date.now()
    await db.transaction('rw', table, async () => {
      for (const [i, o] of ordered.entries()) {
        if (o.position !== i + 1) await table.update(o.id, { position: i + 1, _dirty: 1, _lmod: lmod })
      }
    })
    schedule()
  }

  // --- Produits et stock ---

  async function addProduct(householdId: string, input: ProductInput) {
    const product: Product = {
      ...base(),
      household_id: householdId,
      barcode: input.barcode?.trim() || null,
      name: input.name.trim(),
      brand: input.brand?.trim() ?? '',
      description: input.description?.trim() ?? '',
      ingredients: input.ingredients?.trim() ?? '',
      nutriscore: input.nutriscore ?? null,
      image_url: input.image_url ?? null,
      food_type_id: input.food_type_id ?? null,
      unit: input.unit ?? 'pièce',
      rating: input.rating ?? 0,
      low_threshold: input.low_threshold ?? 1
    }
    await db.products.add(product)
    schedule()
    return product
  }

  const updateProduct = (id: string, changes: Partial<ProductInput & Pick<Product, 'deleted_at'>>) =>
    patch(db.products, id, changes as Partial<Product>)

  async function addStockItem(householdId: string, input: StockItemInput) {
    const item: StockItem = { ...base(), household_id: householdId, note: '', created_by: user.value!.id, ...input }
    await db.stockItems.add(item)
    schedule()
    return item
  }

  const updateStockItem = (id: string, changes: Partial<Omit<StockItemInput, 'product_id'> & Pick<StockItem, 'deleted_at'>>) =>
    patch(db.stockItems, id, changes)

  /** Sorties de stock (une recette peut en enregistrer plusieurs d'un coup) */
  async function addMovements(householdId: string, inputs: MovementInput[]) {
    const rows: StockMovement[] = inputs.map(i => ({
      ...base(),
      household_id: householdId,
      recipe_name: null,
      note: '',
      created_by: user.value!.id,
      ...i
    }))
    await db.movements.bulkAdd(rows)
    // délai > durée du toast « Annuler »
    schedule(7000)
    return rows
  }

  async function cancelMovements(ids: string[]) {
    const lmod = Date.now()
    await db.movements.where('id').anyOf(ids).modify({ deleted_at: nowIso(), _dirty: 1, _lmod: lmod })
    schedule()
  }

  // --- Préférences et recettes ---

  async function addPreference(owner: TasteOwner, label: string, level: PreferenceLevel) {
    const pref: Preference = { ...base(), ...ownerFields(owner), label: label.trim(), level }
    await db.preferences.add(pref)
    schedule()
    return pref
  }

  const updatePreference = (id: string, changes: Partial<Pick<Preference, 'label' | 'level' | 'deleted_at'>>) =>
    patch(db.preferences, id, changes)

  async function saveRecipe(owner: TasteOwner, data: { id?: string, name: string, ingredients: Ingredient[], instructions: string }) {
    const fields = {
      name: data.name.trim(),
      ingredients: data.ingredients.filter(i => i.name.trim()).map(i => ({ name: i.name.trim(), quantity: i.quantity ?? null, unit: i.unit })),
      instructions: data.instructions
    }
    if (data.id) {
      await patch(db.recipes, data.id, fields)
      return data.id
    }
    const recipe: Recipe = { ...base(), ...ownerFields(owner), ...fields }
    await db.recipes.add(recipe)
    schedule()
    return recipe.id
  }

  const deleteRecipe = (id: string) => patch(db.recipes, id, { deleted_at: nowIso() })
  const restoreRecipe = (id: string) => patch(db.recipes, id, { deleted_at: null })

  return {
    createHousehold, updateHousehold,
    addPerson, updatePerson,
    addOption, updateOption, reorderOptions,
    addProduct, updateProduct, addStockItem, updateStockItem, addMovements, cancelMovements,
    addPreference, updatePreference, saveRecipe, deleteRecipe, restoreRecipe
  }
}

/** Foyer, personnes et rôle de l'utilisateur (réactif) */
export function useHousehold(householdId: Ref<string>) {
  const db = useDb()
  const { user } = useAuth()

  const { data: household, loading } = useLiveQuery(
    () => db.households.get(householdId.value),
    undefined as Household | undefined,
    [householdId]
  )
  const { data: allPeople } = useLiveQuery(
    async () => (await db.people.where('household_id').equals(householdId.value).toArray())
      .sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [] as Person[],
    [householdId]
  )
  const { data: profiles } = useLiveQuery(
    async () => new Map((await db.profiles.toArray()).map(p => [p.id, p.display_name])),
    new Map<string, string>()
  )

  const people = computed(() => allPeople.value.filter(p => !p.deleted_at))
  const me = computed(() => people.value.find(p => p.user_id === user.value?.id))
  const isOwner = computed(() => household.value?.created_by === user.value?.id || me.value?.role === 'owner')

  function accountName(userId: string | null) {
    if (!userId) return null
    if (userId === user.value?.id) return 'Moi'
    return profiles.value.get(userId) ?? null
  }

  function personName(personId: string | null) {
    return allPeople.value.find(p => p.id === personId)?.name ?? '?'
  }

  return { household, loading, people, me, isOwner, accountName, personName }
}

/** Lieux de stockage et types d'aliments d'un foyer (réactif), triés par position */
export function useHouseholdOptions(householdId: Ref<string>) {
  const db = useDb()
  const sortFn = (a: { position: number, label: string }, b: { position: number, label: string }) =>
    a.position - b.position || a.label.localeCompare(b.label)

  const { data: allLocations } = useLiveQuery(
    async () => (await db.locations.where('household_id').equals(householdId.value).toArray()).sort(sortFn),
    [] as Location[],
    [householdId]
  )
  const { data: allFoodTypes } = useLiveQuery(
    async () => (await db.foodTypes.where('household_id').equals(householdId.value).toArray()).sort(sortFn),
    [] as FoodType[],
    [householdId]
  )

  const locations = computed(() => allLocations.value.filter(o => !o.deleted_at))
  const foodTypes = computed(() => allFoodTypes.value.filter(o => !o.deleted_at))
  const locationById = computed(() => new Map(allLocations.value.map(o => [o.id, o])))
  const foodTypeById = computed(() => new Map(allFoodTypes.value.map(o => [o.id, o])))

  return { allLocations, allFoodTypes, locations, foodTypes, locationById, foodTypeById }
}
