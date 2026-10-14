import type { Ingredient, Person, PreferenceLevel, Recipe } from '~/utils/db'
import type { Lot } from '~/composables/useStock'

export interface IngredientMatch {
  ingredient: Ingredient
  /** lots correspondants, du plus urgent au moins urgent */
  lots: Lot[]
}

export interface PersonOpinion {
  person: Person
  level: PreferenceLevel
  label: string
}

export interface RecipeSuggestion {
  recipe: Recipe
  /** personnes qui ont cette recette dans leurs favorites */
  favoredBy: Person[]
  matches: IngredientMatch[]
  /** part des ingrédients disponibles (0 à 1) */
  coverage: number
  missing: Ingredient[]
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
 * Idées de recettes et d'aliments pour le foyer, à partir du stock,
 * des recettes favorites et des préférences de chaque personne.
 */
export function useSuggestions(householdId: Ref<string>) {
  const { lots } = useStock(householdId)
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
        if ((p.barcode && codes.has(p.barcode)) || matches(p.label, name)) result.push({ person: t.person, level: p.level, label: p.label })
      }
    }
    return result
  }

  const recipes = computed<RecipeSuggestion[]>(() => {
    const byId = new Map<string, { recipe: Recipe, favoredBy: Person[] }>()
    for (const t of tastes.value) {
      for (const r of t.recipes) {
        const entry = byId.get(r.id) ?? { recipe: r, favoredBy: [] }
        entry.favoredBy.push(t.person)
        byId.set(r.id, entry)
      }
    }

    return [...byId.values()].map(({ recipe, favoredBy }) => {
      const matchList: IngredientMatch[] = []
      const missing: Ingredient[] = []
      const conflicts: PersonOpinion[] = []
      for (const ingredient of recipe.ingredients) {
        const found = lots.value
          .map(l => ({ l, s: matchScore(ingredient.name, l.product.name) }))
          .filter(x => x.s > 0)
          .sort((a, b) => b.s - a.s || (a.l.item.expires_on ?? '9999').localeCompare(b.l.item.expires_on ?? '9999'))
          .map(x => x.l)
        if (found.length) matchList.push({ ingredient, lots: found })
        else missing.push(ingredient)
        const opinions = opinionsOn(ingredient.name, found.map(l => l.product.barcode))
        for (const o of opinions) {
          if ((o.level === 'dislike' || o.level === 'allergy') && !conflicts.some(c => c.person.id === o.person.id && c.label === o.label)) conflicts.push(o)
        }
      }
      const urgency = matchList.reduce((sum, m) => sum + urgencyOf(m.lots[0]!.item.expires_on), 0)
      return {
        recipe,
        favoredBy,
        matches: matchList,
        missing,
        coverage: recipe.ingredients.length ? matchList.length / recipe.ingredients.length : 0,
        urgency,
        conflicts
      }
    })
  })

  const hasAllergy = (s: RecipeSuggestion) => s.conflicts.some(c => c.level === 'allergy') ? 1 : 0

  /** Recettes réalisables avec le stock : les plus complètes d'abord, puis les plus appréciées */
  const byStock = computed(() => recipes.value
    .filter(s => s.matches.length > 0)
    .sort((a, b) => hasAllergy(a) - hasAllergy(b)
      || b.coverage - a.coverage
      || b.favoredBy.length - a.favoredBy.length
      || a.conflicts.length - b.conflicts.length
      || b.urgency - a.urgency))

  /** Recettes qui utilisent des aliments bientôt périmés */
  const byExpiry = computed(() => recipes.value
    .filter(s => s.urgency > 0)
    .sort((a, b) => hasAllergy(a) - hasAllergy(b) || b.urgency - a.urgency || b.coverage - a.coverage))

  /** Aliments à consommer en priorité (date de péremption croissante) */
  const foods = computed(() => lots.value
    .filter(l => l.item.expires_on)
    .map(l => ({ lot: l, opinions: opinionsOn(l.product.name, [l.product.barcode]) })))

  return { byStock, byExpiry, foods, opinionsOn }
}
