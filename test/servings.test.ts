import { describe, expect, it } from 'vitest'
import { roundQuantity, scaleIngredients } from '~/utils/servings'

describe('roundQuantity', () => {
  it('arrondit à l\'unité à partir de 100', () => {
    expect(roundQuantity(374.6)).toBe(375)
    expect(roundQuantity(100.4)).toBe(100)
  })

  it('arrondit au demi entre 10 et 100', () => {
    expect(roundQuantity(37.4)).toBe(37.5)
    expect(roundQuantity(12.2)).toBe(12)
  })

  it('arrondit au centième en dessous de 10', () => {
    expect(roundQuantity(4 / 3)).toBe(1.33)
    expect(roundQuantity(0.125)).toBe(0.13)
  })
})

describe('scaleIngredients', () => {
  const ingredients = [
    { name: 'Farine', quantity: 250, unit: 'g' },
    { name: 'Œufs', quantity: 3, unit: '' },
    { name: 'Sel', quantity: null, unit: '' }
  ]

  it('adapte les quantités au nombre de personnes', () => {
    expect(scaleIngredients(ingredients, 4, 6)).toEqual([
      { name: 'Farine', quantity: 375, unit: 'g' },
      { name: 'Œufs', quantity: 4.5, unit: '' },
      { name: 'Sel', quantity: null, unit: '' }
    ])
  })

  it('réduit aussi', () => {
    expect(scaleIngredients(ingredients, 4, 2).map(i => i.quantity)).toEqual([125, 1.5, null])
  })

  it('renvoie une copie sans modifier l\'original', () => {
    const scaled = scaleIngredients(ingredients, 4, 8)
    expect(scaled).not.toBe(ingredients)
    expect(ingredients[0]!.quantity).toBe(250)
    expect(scaled[0]!.quantity).toBe(500)
  })
})
