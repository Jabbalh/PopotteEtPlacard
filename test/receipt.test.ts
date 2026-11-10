import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Product, ReceiptAlias } from '~/utils/db'
import { parseReceipt, productNameFromLabel, receiptKey, STRONG_MATCH, suggestProducts } from '~/utils/receipt'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 10, 10, 15, 0, 0))
})

afterEach(() => {
  vi.useRealTimers()
})

const item = (label: string, quantity: number, price: number | null, weighed = false) => ({ label, quantity, weighed, price })

describe('parseReceipt — articles', () => {
  it('lit un prix en fin de ligne, avec ou sans « € » et code TVA', () => {
    const { items } = parseReceipt([
      'LAIT 1/2 ECR UHT 1L  1,15 €',
      'BEURRE DX 250G  2,35 B',
      'EMMENTAL RAPE  5,63 € 11',
      'PAIN DE MIE  1.89'
    ])
    expect(items).toEqual([
      item('LAIT 1/2 ECR UHT 1L', 1, 1.15),
      item('BEURRE DX 250G', 1, 2.35),
      item('EMMENTAL RAPE', 1, 5.63),
      item('PAIN DE MIE', 1, 1.89)
    ])
  })

  it('rattache une ligne « 2 x 0,89 » à l\'article précédent', () => {
    const { items } = parseReceipt(['YAOURT NATURE  1,78', '2 x 0,89', 'CAFE MOULU  3,20'])
    expect(items).toEqual([item('YAOURT NATURE', 2, 1.78), item('CAFE MOULU', 1, 3.2)])
  })

  it('rattache une ligne « 3 x 1,20 » à l\'article suivant quand le précédent ne convient pas', () => {
    const { items } = parseReceipt(['CAFE MOULU  3,20', '3 x 1,20', 'BAGUETTE  3,60'])
    expect(items).toEqual([item('CAFE MOULU', 1, 3.2), item('BAGUETTE', 3, 3.6)])
  })

  it('lit un article pesé', () => {
    const { items } = parseReceipt(['BANANES VRAC  1,53', '0,512 kg x 2,99 €/kg'])
    expect(items).toEqual([item('BANANES VRAC', 0.512, 1.53, true)])
  })

  it('lit les colonnes quantité / prix unitaire / total', () => {
    const { items } = parseReceipt(['POMMES GOLDEN  2  1,50  3,00', 'CAFE MOULU  3,20'])
    expect(items).toEqual([item('POMMES GOLDEN', 2, 3), item('CAFE MOULU', 1, 3.2)])
  })

  it('lit une quantité écrite dans le libellé', () => {
    const { items } = parseReceipt(['2 x COMPOTE POMME  2,40', 'YAOURT VANILLE x4  1,99'])
    expect(items).toEqual([item('COMPOTE POMME', 2, 2.4), item('YAOURT VANILLE', 4, 1.99)])
  })

  it('regroupe un même libellé passé plusieurs fois', () => {
    const { items } = parseReceipt(['LAIT UHT 1L  1,15', 'CAFE MOULU  3,20', 'Lait UHT 1L  1,15'])
    expect(items).toEqual([item('LAIT UHT 1L', 2, 2.3), item('CAFE MOULU', 1, 3.2)])
  })

  it('garde distincts un article pesé et le même à la pièce', () => {
    const { items } = parseReceipt(['TOMATES  1,50', '0,500 kg x 3,00 €/kg', 'TOMATES  2,10'])
    expect(items).toEqual([item('TOMATES', 0.5, 1.5, true), item('TOMATES', 1, 2.1)])
  })
})

describe('parseReceipt — lignes qui ne sont pas des articles', () => {
  it('écarte en-tête, remises, totaux et paiement', () => {
    const { items, others } = parseReceipt([
      'SUPER U RENNES',
      'TEL 02 99 00 00 00',
      'LAIT UHT 1L  1,15',
      'REMISE FIDELITE  -0,30',
      'CAFE MOULU  3,20',
      'TOTAL  4,05',
      'CB  4,05',
      'TVA 5,5%  0,21',
      'MERCI DE VOTRE VISITE'
    ])
    expect(items.map(i => i.label)).toEqual(['LAIT UHT 1L', 'CAFE MOULU'])
    expect(others.map(o => o.label)).toEqual([
      'SUPER U RENNES', 'TEL 02 99 00 00 00', 'REMISE FIDELITE', 'TOTAL', 'CB', 'TVA 5,5%', 'MERCI DE VOTRE VISITE'
    ])
  })

  it('ne lit plus d\'article après le premier total', () => {
    const { items } = parseReceipt(['LAIT UHT 1L  1,15', 'TOTAL  1,15', 'CAGNOTTE U  0,50', 'BON ACHAT PROCHAIN  2,00'])
    expect(items).toEqual([item('LAIT UHT 1L', 1, 1.15)])
  })

  it('ne s\'arrête pas sur un « total » placé avant les articles', () => {
    const { items } = parseReceipt(['TOTAL ACCESS RENNES', 'LAIT UHT 1L  1,15'])
    expect(items).toEqual([item('LAIT UHT 1L', 1, 1.15)])
  })

  it('n\'attache pas à un article la quantité qui précédait une ligne écartée', () => {
    const { items } = parseReceipt(['2 x 1,00', 'REMISE  2,00', 'JUS ORANGE  2,00'])
    expect(items).toEqual([item('JUS ORANGE', 1, 2)])
  })
})

describe('parseReceipt — liste sans prix', () => {
  it('donne un article par ligne, avec les quantités écrites', () => {
    const { items, others } = parseReceipt(['- 2 x Lait', '• Tomates', 'Pain x3', '', '12'])
    expect(items).toEqual([item('Lait', 2, null), item('Tomates', 1, null), item('Pain', 3, null)])
    expect(others).toEqual([])
  })
})

describe('parseReceipt — date', () => {
  it.each([
    ['Le 08/11/2026 à 14:32', '2026-11-08'],
    ['08.11.26 14:32', '2026-11-08'],
    ['Date : 10-11-2026', '2026-11-10']
  ])('lit « %s »', (line, expected) => {
    expect(parseReceipt([line, 'LAIT UHT 1L  1,15']).date).toBe(expected)
  })

  it('ignore une date future, trop ancienne ou impossible', () => {
    expect(parseReceipt(['15/12/2026', 'LAIT  1,15']).date).toBeNull()
    expect(parseReceipt(['01/01/2020', 'LAIT  1,15']).date).toBeNull()
    expect(parseReceipt(['31/02/2026', 'LAIT  1,15']).date).toBeNull()
  })

  it('retient la première date plausible', () => {
    expect(parseReceipt(['Ouvert depuis le 01/01/1998', 'Ticket du 05/11/2026', 'LAIT  1,15']).date).toBe('2026-11-05')
  })
})

describe('receiptKey', () => {
  it('normalise casse, accents et espaces', () => {
    expect(receiptKey('  LAIT   1/2 Écr. UHT 1L ')).toBe('lait 1/2 ecr. uht 1l')
    expect(receiptKey('Crème-Fraîche 30%')).toBe('creme fraiche 30%')
  })

  it('conserve les contenances : deux formats restent deux libellés', () => {
    expect(receiptKey('LAIT UHT 1L')).not.toBe(receiptKey('LAIT UHT 50CL'))
  })
})

describe('productNameFromLabel', () => {
  it('retire les contenances et met une majuscule', () => {
    expect(productNameFromLabel('LAIT UHT 1L')).toBe('Lait uht')
    expect(productNameFromLabel('BEURRE DOUX 250G')).toBe('Beurre doux')
    expect(productNameFromLabel('YAOURT NATURE 4X125G')).toBe('Yaourt nature')
    expect(productNameFromLabel('COMPOTE X4')).toBe('Compote')
  })

  it('sépare les abréviations à points', () => {
    expect(productNameFromLabel('BEUR.BRETAG.DOUX')).toBe('Beur bretag doux')
  })
})

describe('suggestProducts', () => {
  const product = (id: string, name: string, brand = '') => ({ id, name, brand }) as Product
  const alias = (label: string, productId: string | null) => ({ label, product_id: productId, deleted_at: null }) as ReceiptAlias

  const lait = product('lait', 'Lait demi-écrémé', 'Lactel')
  const beurre = product('beurre', 'Beurre doux', 'Président')
  const emmental = product('emmental', 'Emmental râpé')
  const products = [beurre, emmental, lait]

  it('reconnaît les abréviations et écarte les produits sans rapport', () => {
    const result = suggestProducts('LAIT 1/2 ECR UHT 1L', products, [])
    expect(result.map(r => r.product.id)).toEqual(['lait'])
    expect(result[0]!.score).toBeGreaterThanOrEqual(STRONG_MATCH)
  })

  it('accepte la marque sans l\'exiger', () => {
    const withBrand = suggestProducts('PRESIDENT BEURRE DOUX 250G', products, [])
    const without = suggestProducts('BEURRE DOUX 250G', products, [])
    expect(withBrand[0]!.product.id).toBe('beurre')
    expect(without[0]!.product.id).toBe('beurre')
    expect(without[0]!.score).toBeCloseTo(1)
  })

  it('classe du plus probable au moins probable et respecte la limite', () => {
    const cheeses = [product('a', 'Emmental râpé'), product('b', 'Emmental'), product('c', 'Fromage râpé emmental bio')]
    const result = suggestProducts('EMMENTAL RAPE 200G', cheeses, [])
    expect(result[0]!.product.id).toBe('a')
    expect(result.map(r => r.score)).toEqual([...result.map(r => r.score)].sort((x, y) => y - x))
    expect(suggestProducts('EMMENTAL RAPE 200G', cheeses, [], 1)).toHaveLength(1)
  })

  it('s\'appuie sur les libellés déjà associés au produit', () => {
    const tomme = product('tomme', 'Fromage de brebis')
    expect(suggestProducts('OSSAU IRATY AOP', [tomme], [])).toEqual([])
    const result = suggestProducts('OSSAU IRATY AOP 250G', [tomme], [alias('ossau iraty aop 200g', 'tomme')])
    expect(result[0]!.product).toBe(tomme)
    expect(result[0]!.score).toBeCloseTo(1)
  })

  it('ignore les libellés « à ignorer » et les associations supprimées', () => {
    const tomme = product('tomme', 'Fromage de brebis')
    const deleted = { ...alias('ossau iraty', 'tomme'), deleted_at: '2026-11-01T00:00:00Z' } as ReceiptAlias
    expect(suggestProducts('OSSAU IRATY', [tomme], [alias('ossau iraty', null), deleted])).toEqual([])
  })

  it('ne propose rien pour un libellé sans mot significatif', () => {
    expect(suggestProducts('6X125G', products, [])).toEqual([])
  })
})
