import type { Nutriscore } from '~/utils/db'

/** Produit trouvé sur Open Food Facts (base collaborative des produits de grande surface) */
export interface OffProduct {
  barcode: string
  name: string
  brand: string
  description: string
  ingredients: string
  nutriscore: Nutriscore | null
  image_url: string | null
}

const FIELDS = [
  'product_name_fr', 'product_name', 'generic_name_fr', 'generic_name', 'brands', 'quantity',
  'ingredients_text_fr', 'ingredients_text', 'nutriscore_grade', 'image_front_small_url'
].join(',')

/**
 * Recherche d'un produit par code-barres. Renvoie null si le produit est inconnu ;
 * lève une erreur si le service est injoignable (hors ligne).
 */
export async function fetchOffProduct(barcode: string): Promise<OffProduct | null> {
  const code = barcode.replace(/\D/g, '')
  if (!code) return null
  const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=${FIELDS}`, {
    headers: { Accept: 'application/json' }
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Open Food Facts indisponible (${res.status})`)
  const json = await res.json() as { status: number, product?: Record<string, string | undefined> }
  const p = json.product
  if (json.status !== 1 || !p) return null

  const grade = p.nutriscore_grade?.toLowerCase()
  const generic = p.generic_name_fr || p.generic_name || ''
  return {
    barcode: code,
    name: (p.product_name_fr || p.product_name || generic || '').trim(),
    brand: (p.brands ?? '').split(',')[0]!.trim(),
    description: [generic, p.quantity].filter(Boolean).join(' — '),
    ingredients: (p.ingredients_text_fr || p.ingredients_text || '').trim(),
    nutriscore: grade && /^[a-e]$/.test(grade) ? grade as Nutriscore : null,
    image_url: p.image_front_small_url || null
  }
}
