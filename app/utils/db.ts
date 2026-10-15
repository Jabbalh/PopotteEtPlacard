import Dexie, { type EntityTable } from 'dexie'

/** Champs techniques locaux pour la synchronisation */
export interface SyncFields {
  /** 1 = modification locale non encore envoyée au serveur */
  _dirty: 0 | 1
  /** horodatage local de la dernière modification (évite d'écraser une modif faite pendant l'envoi) */
  _lmod: number
}

interface Timestamps {
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface Household extends SyncFields, Timestamps {
  id: string
  name: string
  created_by: string | null
}

export type PersonRole = 'owner' | 'member'

export interface Person extends SyncFields, Timestamps {
  id: string
  household_id: string
  name: string
  /** compte lié (accès au foyer + préférences du compte) */
  user_id: string | null
  role: PersonRole
  invite_token: string | null
}

/** Lieu de stockage (Frigo, Congélateur…) ou type d'aliment, paramétrables par foyer */
export interface HouseholdOption extends SyncFields, Timestamps {
  id: string
  household_id: string
  label: string
  position: number
}

export interface Location extends HouseholdOption {
  icon: string
}

export type FoodType = HouseholdOption

export type Nutriscore = 'a' | 'b' | 'c' | 'd' | 'e'

export interface Product extends SyncFields, Timestamps {
  id: string
  household_id: string
  barcode: string | null
  name: string
  brand: string
  description: string
  ingredients: string
  nutriscore: Nutriscore | null
  image_url: string | null
  food_type_id: string | null
  unit: string
  /** 0 = non favori, 1 à 5 étoiles */
  rating: number
  /** seuil « proche de la rupture » */
  low_threshold: number
  /** à recommander quand il est épuisé (liste « À commander ») */
  reorder: boolean
  /** marqué « commandé » ; ne compte plus dès qu'un lot est ajouté après cette date */
  ordered_at: string | null
}

export interface StockItem extends SyncFields, Timestamps {
  id: string
  household_id: string
  product_id: string
  location_id: string | null
  /** quantité initiale du lot */
  quantity: number
  purchased_on: string
  expires_on: string | null
  note: string
  created_by: string | null
}

export type MovementKind = 'used' | 'thrown' | 'given' | 'adjusted'

export interface StockMovement extends SyncFields, Timestamps {
  id: string
  household_id: string
  stock_item_id: string
  kind: MovementKind
  /** quantité retirée (négative = ajout lors d'un ajustement) */
  quantity: number
  occurred_on: string
  recipe_name: string | null
  note: string
  created_by: string | null
}

export type PreferenceLevel = 'love' | 'like' | 'dislike' | 'allergy'

/**
 * Préférence ou recette :
 * - niveau compte : user_id renseigné (household_id / person_id vides)
 * - niveau foyer : person_id + household_id
 */
interface Owned {
  user_id: string | null
  household_id: string | null
  person_id: string | null
}

export interface Preference extends SyncFields, Timestamps, Owned {
  id: string
  label: string
  /** code-barres du produit (saisie par scan) : correspondance exacte avec le stock */
  barcode?: string | null
  level: PreferenceLevel
}

export interface Ingredient {
  name: string
  quantity: number | null
  unit: string
}

export interface Recipe extends SyncFields, Timestamps, Owned {
  id: string
  name: string
  ingredients: Ingredient[]
  instructions: string
}

export interface Profile {
  id: string
  display_name: string
}

export interface Meta {
  key: string
  value: unknown
}

export type AppDb = Dexie & {
  households: EntityTable<Household, 'id'>
  people: EntityTable<Person, 'id'>
  locations: EntityTable<Location, 'id'>
  foodTypes: EntityTable<FoodType, 'id'>
  products: EntityTable<Product, 'id'>
  stockItems: EntityTable<StockItem, 'id'>
  movements: EntityTable<StockMovement, 'id'>
  preferences: EntityTable<Preference, 'id'>
  recipes: EntityTable<Recipe, 'id'>
  profiles: EntityTable<Profile, 'id'>
  meta: EntityTable<Meta, 'key'>
}

/** Tables synchronisées, dans l'ordre d'envoi (respect des clés étrangères) */
export const SYNCED_TABLES = ['households', 'people', 'locations', 'foodTypes', 'products', 'stockItems', 'movements', 'preferences', 'recipes'] as const
export type SyncedTable = typeof SYNCED_TABLES[number]

const instances = new Map<string, AppDb>()

/** Supprime définitivement la base locale d'un utilisateur */
export async function deleteDb(userId: string) {
  const db = openDb(userId)
  instances.delete(userId)
  await db.delete()
}

/** Une base IndexedDB par utilisateur : pas de mélange de données entre comptes */
export function openDb(userId: string): AppDb {
  let db = instances.get(userId)
  if (!db) {
    db = new Dexie(`popotte-${userId}`) as AppDb
    db.version(1).stores({
      households: 'id, _dirty',
      people: 'id, household_id, user_id, _dirty',
      locations: 'id, household_id, _dirty',
      foodTypes: 'id, household_id, _dirty',
      products: 'id, household_id, [household_id+barcode], _dirty',
      stockItems: 'id, household_id, product_id, _dirty',
      movements: 'id, household_id, stock_item_id, _dirty',
      preferences: 'id, user_id, household_id, person_id, _dirty',
      recipes: 'id, user_id, household_id, person_id, _dirty',
      profiles: 'id',
      meta: 'key'
    })
    // produits à commander : valeurs par défaut des lignes existantes (colonne non nulle côté serveur)
    db.version(2).stores({}).upgrade(tx => tx.table('products').toCollection().modify((p: Partial<Product>) => {
      p.reorder ??= false
      p.ordered_at ??= null
    }))
    instances.set(userId, db)
  }
  return db
}
