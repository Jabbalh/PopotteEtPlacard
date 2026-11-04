import type { Ingredient, Person, PreferenceLevel, Recipe } from '~/utils/db'
import type { Lot } from '~/composables/useStock'

export interface IngredientMatch {
  ingredient: Ingredient
  /** lots correspondants, du plus urgent au moins urgent */
  lots: Lot[]
  /**
   * quantité en stock exprimée dans l'unité de l'ingrédient ; null si l'ingrédient
   * n'a pas de quantité ou si aucune unité n'est comparable (g et pièce…)
   */
  available: number | null
  /** false = en stock, mais pas assez pour la recette */
  enough: boolean
}

/** Aliment à acheter pour une recette : manquant, ou complément d'un stock insuffisant */
export interface ToBuy {
  ingredient: Ingredient
  /** quantité à acheter, dans l'unité de l'ingrédient (null = non précisée) */
  quantity: number | null
}

export interface PersonOpinion {
  person: Person
  level: PreferenceLevel
  /** préférence telle que la personne l'a saisie */
  label: string
  /** trouvée par le code-barres (sinon par le nom) */
  byBarcode: boolean
  /** préférence du compte de la personne (sinon propre au foyer) */
  fromAccount: boolean
}

export interface RecipeSuggestion {
  recipe: Recipe
  /** personnes qui ont cette recette dans leurs favorites */
  favoredBy: Person[]
  /** recette commune du foyer (rattachée à aucune personne) */
  common: boolean
  matches: IngredientMatch[]
  /** ingrédients absents du stock mais parmi les basiques du placard (sel, huile…) */
  staples: Ingredient[]
  /** part des ingrédients disponibles (0 à 1) ; un ingrédient en quantité insuffisante compte pour moitié */
  coverage: number
  /** nombre d'ingrédients disponibles (en stock, même en quantité insuffisante, ou basiques) */
  available: number
  missing: Ingredient[]
  /** manquants et compléments des ingrédients insuffisants */
  toBuy: ToBuy[]
  /** urgence liée aux dates de péremption des lots utilisés */
  urgency: number
  /** ingrédients que quelqu'un n'aime pas ou ne peut pas manger */
  conflicts: PersonOpinion[]
}

/** Poids d'un lot selon le nombre de jours avant péremption */
export function urgencyOf(expiresOn: string | null): number {
  if (!expiresOn) return 0
  const d = daysUntil(expiresOn)
  if (d <= 0) return 5
  if (d === 1) return 4
  if (d <= 3) return 3
  if (d <= 7) return 2
  if (d <= 14) return 1
  return 0
}

/**
 * Avis des personnes du foyer sur les aliments (préférences de compte et propres au foyer).
 */
export function useOpinions(householdId: Ref<string>) {
  const { tastes } = useHouseholdTastes(householdId)

  /**
   * Avis des personnes du foyer sur un aliment : même code-barres (correspondance exacte),
   * sinon libellé ressemblant. `barcodes` : codes-barres des produits concernés.
   */
  function opinionsOn(name: string, barcodes: (string | null)[] = []): PersonOpinion[] {
    const codes = new Set(barcodes.filter(Boolean))
    const result: PersonOpinion[] = []
    for (const t of tastes.value) {
      for (const p of t.preferences) {
        const byBarcode = !!p.barcode && codes.has(p.barcode)
        if (byBarcode || matches(p.label, name)) result.push({ person: t.person, level: p.level, label: p.label, byBarcode, fromAccount: p.fromAccount })
      }
    }
    return result
  }

  return { opinionsOn }
}

/**
 * Idées de recettes et d'aliments pour le foyer, à partir du stock,
 * des recettes favorites et des préférences de chaque personne.
 */
export function useSuggestions(householdId: Ref<string>) {
  const { lots } = useStock(householdId)
  const { tastes } = useHouseholdTastes(householdId)
  const { householdRecipes } = useHouseholdRecipes(householdId)
  const { opinionsOn } = useOpinions(householdId)
  const { staples } = usePantryStaples(householdId)

  /** Quantité en stock dans l'unité de l'ingrédient (lots d'unité comparable) ; null si non comparable */
  function availableFor(ingredient: Ingredient, found: Lot[]): number | null {
    if (!ingredient.quantity) return null
    let total: number | null = null
    for (const l of found) {
      const q = convertQuantity(l.remaining, l.product.unit, ingredient.unit)
      if (q !== null) total = (total ?? 0) + q
    }
    return total === null ? null : Math.round(total * 1000) / 1000
  }

  const recipes = computed<RecipeSuggestion[]>(() => {
    const byId = new Map<string, { recipe: Recipe, favoredBy: Person[], common: boolean }>()
    for (const r of householdRecipes.value) byId.set(r.id, { recipe: r, favoredBy: [], common: true })
    for (const t of tastes.value) {
      for (const r of t.recipes) {
        const entry = byId.get(r.id) ?? { recipe: r, favoredBy: [], common: false }
        entry.favoredBy.push(t.person)
        byId.set(r.id, entry)
      }
    }

    return [...byId.values()].map(({ recipe, favoredBy, common }) => {
      const matchList: IngredientMatch[] = []
      const stapleList: Ingredient[] = []
      const missing: Ingredient[] = []
      const toBuy: ToBuy[] = []
      const conflicts: PersonOpinion[] = []
      for (const ingredient of recipe.ingredients) {
        const found = lots.value
          .map(l => ({ l, s: productMatchScore(ingredient.name, l.product) }))
          .filter(x => x.s > 0)
          .sort((a, b) => b.s - a.s || (a.l.item.expires_on ?? '9999').localeCompare(b.l.item.expires_on ?? '9999'))
          .map(x => x.l)
        if (found.length) {
          const available = availableFor(ingredient, found)
          // petite tolérance pour les arrondis de conversion
          const enough = available === null || available >= ingredient.quantity! - 1e-6
          matchList.push({ ingredient, lots: found, available, enough })
          if (!enough) toBuy.push({ ingredient, quantity: Math.round((ingredient.quantity! - available!) * 1000) / 1000 })
        } else if (staples.value.some(s => matches(ingredient.name, s.label))) {
          stapleList.push(ingredient)
        } else {
          missing.push(ingredient)
          toBuy.push({ ingredient, quantity: ingredient.quantity })
        }
        const opinions = opinionsOn(ingredient.name, found.map(l => l.product.barcode))
        for (const o of opinions) {
          if ((o.level === 'dislike' || o.level === 'allergy') && !conflicts.some(c => c.person.id === o.person.id && c.label === o.label)) conflicts.push(o)
        }
      }
      const urgency = matchList.reduce((sum, m) => sum + urgencyOf(m.lots[0]!.item.expires_on), 0)
      const score = matchList.reduce((sum, m) => sum + (m.enough ? 1 : 0.5), 0) + stapleList.length
      return {
        recipe,
        favoredBy,
        common,
        matches: matchList,
        staples: stapleList,
        missing,
        toBuy,
        available: matchList.length + stapleList.length,
        coverage: recipe.ingredients.length ? score / recipe.ingredients.length : 0,
        urgency,
        conflicts
      }
    })
  })

  const hasAllergy = (s: RecipeSuggestion) => s.conflicts.some(c => c.level === 'allergy') ? 1 : 0

  const rating = (s: RecipeSuggestion) => Number(s.recipe.rating ?? 0)

  /** Recettes réalisables avec le stock : les plus complètes d'abord, puis les mieux notées, puis les plus appréciées */
  const byStock = computed(() => recipes.value
    .filter(s => s.matches.length > 0)
    .sort((a, b) => hasAllergy(a) - hasAllergy(b)
      || b.coverage - a.coverage
      || rating(b) - rating(a)
      || b.favoredBy.length - a.favoredBy.length
      || a.conflicts.length - b.conflicts.length
      || b.urgency - a.urgency))

  /** Recettes qui utilisent des aliments bientôt périmés */
  const byExpiry = computed(() => recipes.value
    .filter(s => s.urgency > 0)
    .sort((a, b) => hasAllergy(a) - hasAllergy(b) || b.urgency - a.urgency || b.coverage - a.coverage || rating(b) - rating(a)))

  /** Aliments à consommer en priorité (date de péremption croissante) */
  const foods = computed(() => lots.value
    .filter(l => l.item.expires_on)
    .map(l => ({ lot: l, opinions: opinionsOn(l.product.name, [l.product.barcode]) })))

  return { byStock, byExpiry, foods, opinionsOn }
}
