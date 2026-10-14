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
