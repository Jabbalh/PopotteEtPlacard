import type { Ingredient } from '~/utils/db'

/** Arrondi lisible d'une quantité recalculée : 375 g, 37,5 cl, 1,33 pièce */
export function roundQuantity(q: number): number {
  const step = q >= 100 ? 1 : q >= 10 ? 0.5 : 0.01
  return Math.round(Math.round(q / step) * step * 100) / 100
}

/** Quantités des aliments recalculées pour un autre nombre de personnes (copie ; sans quantité = inchangé) */
export function scaleIngredients(ingredients: Ingredient[], from: number, to: number): Ingredient[] {
  const ratio = to / from
  return ingredients.map(i => ({ ...i, quantity: i.quantity ? roundQuantity(i.quantity * ratio) : i.quantity }))
}
