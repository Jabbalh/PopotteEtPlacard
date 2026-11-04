/**
 * Rapprochement approximatif entre libellés (ingrédient d'une recette, préférence,
 * nom de produit) : sans accents, sans mots vides, au singulier.
 * « Tomates » correspond ainsi à « Tomates cerises bio ».
 */

const STOP_WORDS = new Set([
  'de', 'du', 'des', 'd', 'la', 'le', 'les', 'l', 'un', 'une', 'au', 'aux', 'a', 'en', 'et', 'ou',
  'avec', 'sans', 'pour', 'sur', 'bio', 'frais', 'fraiche', 'fraiches', 'nature', 'extra', 'g', 'kg', 'ml', 'cl'
])

function singular(word: string): string {
  if (word.length > 3 && (word.endsWith('s') || word.endsWith('x'))) return word.slice(0, -1)
  return word
}

export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/œ/g, 'oe')
    // mots composés à ne pas confondre avec leur premier mot (« pomme » ≠ « pomme de terre »)
    .replace(/\bpommes? de terre\b/g, 'pommedeterre')
    .split(/[^a-z0-9]+/)
    .filter(w => w.length > 1 && !STOP_WORDS.has(w) && !/^\d+$/.test(w))
    .map(singular)
}

/** Tous les mots significatifs de `needle` se retrouvent dans `haystack` */
function contains(haystack: string[], needle: string[]): boolean {
  if (!needle.length) return false
  const set = new Set(haystack)
  return needle.every(w => set.has(w))
}

/**
 * Indice de correspondance entre un libellé recherché (ingrédient, préférence)
 * et un produit : 0 = aucun, 2 = le nom du produit commence par le libellé, 1 = contenu.
 */
export function matchScore(label: string, productName: string): number {
  const a = tokens(label)
  const b = tokens(productName)
  if (!a.length || !b.length) return 0
  if (contains(b, a)) return b[0] === a[0] ? 2 : 1
  // « Lait » recherché, produit nommé « Lait demi-écrémé » : couvert ci-dessus ;
  // produit très court (« Beurre ») et libellé plus précis (« beurre doux ») :
  if (contains(a, b)) return 1
  return 0
}

export function matches(label: string, productName: string): boolean {
  return matchScore(label, productName) > 0
}

/**
 * Correspondance entre un libellé et un produit : par son nom, ou par son aliment
 * générique (« pâtes » pour « Coquillettes Panzani »). Meilleur des deux indices.
 */
export function productMatchScore(label: string, product: { name: string, generic_name?: string }): number {
  const byName = matchScore(label, product.name)
  return product.generic_name ? Math.max(byName, matchScore(label, product.generic_name)) : byName
}

/** Mêmes mots significatifs (« Tomates » et « tomate ») : doublons de la liste de courses */
export function sameFood(a: string, b: string): boolean {
  const ta = tokens(a)
  const tb = tokens(b)
  return ta.length > 0 && ta.length === tb.length && ta.every(w => tb.includes(w))
}

/** Unités convertibles entre elles : grandeur et facteur vers l'unité de base */
const UNIT_FACTORS: Record<string, { dim: string, factor: number }> = {
  g: { dim: 'masse', factor: 1 },
  gr: { dim: 'masse', factor: 1 },
  gramme: { dim: 'masse', factor: 1 },
  grammes: { dim: 'masse', factor: 1 },
  kg: { dim: 'masse', factor: 1000 },
  kilo: { dim: 'masse', factor: 1000 },
  kilos: { dim: 'masse', factor: 1000 },
  ml: { dim: 'volume', factor: 1 },
  cl: { dim: 'volume', factor: 10 },
  dl: { dim: 'volume', factor: 100 },
  l: { dim: 'volume', factor: 1000 },
  litre: { dim: 'volume', factor: 1000 },
  litres: { dim: 'volume', factor: 1000 },
  piece: { dim: 'nombre', factor: 1 },
  pieces: { dim: 'nombre', factor: 1 },
  pc: { dim: 'nombre', factor: 1 },
  pcs: { dim: 'nombre', factor: 1 }
}

function unitKey(unit: string) {
  return unit.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\.$/, '')
}

/**
 * Convertit une quantité d'une unité à une autre (g ↔ kg, ml ↔ cl ↔ L, pièce).
 * Sans unité, une quantité d'ingrédient se compte en pièces (« 3 œufs »).
 * null si les unités ne sont pas comparables (g et pièce, paquet et boîte…).
 */
export function convertQuantity(quantity: number, from: string, to: string): number | null {
  const f = unitKey(from) || 'piece'
  const t = unitKey(to) || 'piece'
  if (f === t) return quantity
  const a = UNIT_FACTORS[f]
  const b = UNIT_FACTORS[t]
  if (!a || !b || a.dim !== b.dim) return null
  return Math.round(quantity * a.factor / b.factor * 1000) / 1000
}
