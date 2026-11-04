import type { Nutriscore } from '~/utils/db'
import { tokens } from './matching'

/** Produit trouvé sur Open Food Facts (base collaborative des produits de grande surface) */
export interface OffProduct {
  barcode: string
  name: string
  brand: string
  description: string
  ingredients: string
  nutriscore: Nutriscore | null
  image_url: string | null
  /** catégories en français, de la plus large à la plus précise (« Fromages », « Camemberts ») */
  categories: string[]
  /** aliment générique proposé pour les recettes (une des catégories) ; vide si aucune */
  generic_name: string
}

const FIELDS = [
  'product_name_fr', 'product_name', 'generic_name_fr', 'generic_name', 'brands', 'quantity',
  'ingredients_text_fr', 'ingredients_text', 'nutriscore_grade', 'image_front_small_url',
  'categories_hierarchy', 'categories_tags_fr'
].join(',')

/**
 * Catégories traduites en français. Seules les catégories de la taxonomie officielle
 * (« en:dry-pastas ») sont gardées : les catégories libres saisies par les contributeurs
 * (« fr:Nutella », « en:Produits à tartiner ») sont souvent du bruit.
 */
function frenchCategories(hierarchy: unknown, tagsFr: unknown): string[] {
  if (!Array.isArray(hierarchy) || !Array.isArray(tagsFr) || hierarchy.length !== tagsFr.length) return []
  const result: string[] = []
  hierarchy.forEach((tag, i) => {
    const fr = String(tagsFr[i] ?? '').trim()
    if (!/^en:[a-z0-9-]+$/.test(String(tag)) || !fr || /^[a-z]{2}:/.test(fr)) return
    if (!result.some(c => c.toLowerCase() === fr.toLowerCase())) result.push(fr)
  })
  return result
}

/** Catégorie la plus précise restée courte (« Pâtes sèches » plutôt que « Camemberts au lait pasteurisé de vache ») */
function suggestGeneric(categories: string[]): string {
  const short = categories.filter(c => tokens(c).length <= 2)
  return short[short.length - 1] ?? categories[categories.length - 1] ?? ''
}

/**
 * Recherche d'un produit par code-barres. Renvoie null si le produit est inconnu ;
 * lève une erreur si le service est injoignable (hors ligne).
 */
export async function fetchOffProduct(barcode: string): Promise<OffProduct | null> {
  const code = barcode.replace(/\D/g, '')
  if (!code) return null
  // lc=fr : catégories traduites en français (categories_tags_fr)
  const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=${FIELDS}&lc=fr`, {
    headers: { Accept: 'application/json' }
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Open Food Facts indisponible (${res.status})`)
  const json = await res.json() as { status: number, product?: Record<string, string | undefined> & { categories_hierarchy?: unknown, categories_tags_fr?: unknown } }
  const p = json.product
  if (json.status !== 1 || !p) return null

  const grade = p.nutriscore_grade?.toLowerCase()
  const generic = p.generic_name_fr || p.generic_name || ''
  const categories = frenchCategories(p.categories_hierarchy, p.categories_tags_fr)
  return {
    categories,
    generic_name: suggestGeneric(categories),
    barcode: code,
    name: (p.product_name_fr || p.product_name || generic || '').trim(),
    brand: (p.brands ?? '').split(',')[0]!.trim(),
    description: [generic, p.quantity].filter(Boolean).join(' — '),
    ingredients: (p.ingredients_text_fr || p.ingredients_text || '').trim(),
    nutriscore: grade && /^[a-e]$/.test(grade) ? grade as Nutriscore : null,
    image_url: p.image_front_small_url || null
  }
}
