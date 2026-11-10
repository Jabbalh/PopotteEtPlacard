import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addMonths, daysUntil, expiryInfo, formatDate, formatPrice, formatQuantity, fromDateKey,
  isFreezerLike, movementLabel, preferenceLevel, toDateKey, todayKey, unitPrice
} from '~/utils/format'

/** Les espaces insécables de Intl (avant « € », entre milliers) ramenées à des espaces simples */
const plain = (text: string) => text.replace(/[  ]/g, ' ')

beforeEach(() => {
  vi.useFakeTimers()
  // mardi 10 novembre 2026, 15 h (heure locale)
  vi.setSystemTime(new Date(2026, 10, 10, 15, 0, 0))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('dates AAAA-MM-JJ', () => {
  it('todayKey donne la date locale du jour', () => {
    expect(todayKey()).toBe('2026-11-10')
  })

  it('toDateKey et fromDateKey sont réciproques', () => {
    expect(toDateKey(new Date(2026, 0, 5))).toBe('2026-01-05')
    expect(toDateKey(fromDateKey('2026-03-09'))).toBe('2026-03-09')
    const d = fromDateKey('2026-12-31')
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 11, 31])
  })

  it('todayKey ne bascule pas au lendemain en fin de soirée (heure locale, pas UTC)', () => {
    vi.setSystemTime(new Date(2026, 10, 10, 23, 30, 0))
    expect(todayKey()).toBe('2026-11-10')
  })
})

describe('addMonths', () => {
  it('ajoute des mois', () => {
    expect(addMonths('2026-11-10', 3)).toBe('2027-02-10')
    expect(addMonths('2026-01-15', 6)).toBe('2026-07-15')
  })

  it('ramène au dernier jour du mois quand le jour n\'existe pas', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29')
    expect(addMonths('2026-08-31', 1)).toBe('2026-09-30')
    expect(addMonths('2026-10-31', 4)).toBe('2027-02-28')
  })
})

describe('daysUntil', () => {
  it('compte les jours depuis aujourd\'hui', () => {
    expect(daysUntil('2026-11-10')).toBe(0)
    expect(daysUntil('2026-11-11')).toBe(1)
    expect(daysUntil('2026-11-03')).toBe(-7)
    expect(daysUntil('2027-11-10')).toBe(365)
  })

  it('reste juste à travers le changement d\'heure', () => {
    vi.setSystemTime(new Date(2026, 2, 27, 12, 0, 0))
    // passage à l'heure d'été dans la nuit du 28 au 29 mars 2026 (journée de 23 h)
    expect(daysUntil('2026-03-30')).toBe(3)
  })
})

describe('expiryInfo', () => {
  it('décrit la péremption et sa couleur', () => {
    expect(expiryInfo(null)).toEqual({ label: 'Sans date', color: 'neutral' })
    expect(expiryInfo('2026-11-07')).toEqual({ label: 'Périmé depuis 3 j', color: 'error' })
    expect(expiryInfo('2026-11-10')).toEqual({ label: 'Périme aujourd\'hui', color: 'error' })
    expect(expiryInfo('2026-11-11')).toEqual({ label: 'Périme demain', color: 'warning' })
    expect(expiryInfo('2026-11-13')).toEqual({ label: 'Périme dans 3 j', color: 'warning' })
  })

  it('passe à la date au-delà de 3 jours : orange jusqu\'à 7 jours, vert ensuite', () => {
    expect(expiryInfo('2026-11-17')).toEqual({ label: 'Jusqu\'au 17 nov.', color: 'warning' })
    expect(expiryInfo('2026-11-18')).toEqual({ label: 'Jusqu\'au 18 nov.', color: 'success' })
  })
})

describe('formatDate', () => {
  it('omet l\'année en cours', () => {
    expect(formatDate('2026-11-17')).toBe('17 nov.')
    expect(formatDate('2027-02-03')).toBe('3 févr. 2027')
  })

  it('accepte un horodatage et une valeur vide', () => {
    expect(formatDate('2026-11-17T08:30:00Z')).toBe('17 nov.')
    expect(formatDate(null)).toBe('')
    expect(formatDate(undefined)).toBe('')
  })
})

describe('formatQuantity', () => {
  it('accorde « pièce » et utilise la virgule', () => {
    expect(formatQuantity(1, 'pièce')).toBe('1 pièce')
    expect(formatQuantity(3, 'pièce')).toBe('3 pièces')
    expect(formatQuantity(0.5, 'pièce')).toBe('0,5 pièce')
    expect(formatQuantity(1.5, 'kg')).toBe('1,5 kg')
  })

  it('arrondit au centième', () => {
    expect(formatQuantity(0.30000000000000004, 'L')).toBe('0,3 L')
    expect(formatQuantity(1.005, 'kg')).toBe('1 kg')
  })
})

describe('prix', () => {
  it('formatPrice écrit en euros', () => {
    expect(plain(formatPrice(5.63))).toBe('5,63 €')
    expect(plain(formatPrice(2))).toBe('2,00 €')
  })

  it('unitPrice ramène au kilo et au litre', () => {
    const perKg = unitPrice(2.35, 250, 'g')!
    expect(perKg.value).toBeCloseTo(9.4)
    expect(perKg.unit).toBe('kg')
    expect(plain(perKg.label)).toBe('9,40 €/kg')

    expect(unitPrice(1.2, 75, 'cl')).toMatchObject({ unit: 'L' })
    expect(unitPrice(1.2, 75, 'cl')!.value).toBeCloseTo(1.6)
    expect(unitPrice(0.9, 1000, 'ml')!.value).toBeCloseTo(0.9)
  })

  it('unitPrice garde les autres unités', () => {
    expect(plain(unitPrice(3, 2, 'pièce')!.label)).toBe('1,50 €/pièce')
    expect(unitPrice(4, 2, 'kg')).toMatchObject({ value: 2, unit: 'kg' })
  })

  it('unitPrice vaut null sans prix ou sans quantité', () => {
    expect(unitPrice(null, 2, 'kg')).toBeNull()
    expect(unitPrice(undefined, 2, 'kg')).toBeNull()
    expect(unitPrice(3, 0, 'kg')).toBeNull()
    expect(unitPrice(0, 2, 'kg')).toMatchObject({ value: 0 })
  })
})

describe('libellés', () => {
  it('isFreezerLike reconnaît un congélateur à son icône ou à son nom', () => {
    expect(isFreezerLike('Autre', 'i-lucide-snowflake')).toBe(true)
    expect(isFreezerLike('Congélateur du garage', 'i-lucide-package')).toBe(true)
    expect(isFreezerLike(' congelateur', '')).toBe(true)
    expect(isFreezerLike('Frigo', 'i-lucide-refrigerator')).toBe(false)
  })

  it('movementLabel et preferenceLevel', () => {
    expect(movementLabel('used')).toBe('Utilisé')
    expect(movementLabel('adjusted')).toBe('Ajustement de stock')
    expect(preferenceLevel('allergy').color).toBe('error')
  })
})
