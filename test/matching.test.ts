import { describe, expect, it } from 'vitest'
import { convertQuantity, matches, matchScore, productMatchScore, sameFood, tokens } from '~/utils/matching'

describe('tokens', () => {
  it('retire accents, mots vides et nombres, et met au singulier', () => {
    expect(tokens('Tomates cerises bio')).toEqual(['tomate', 'cerise'])
    expect(tokens('Crème fraîche épaisse 30 %')).toEqual(['creme', 'epaisse'])
    expect(tokens('Œufs frais x6')).toEqual(['oeuf', 'x6'])
  })

  it('garde tels quels les mots courts finissant par s ou x', () => {
    expect(tokens('Riz')).toEqual(['riz'])
    expect(tokens('Pois')).toEqual(['poi'])
    expect(tokens('Jus')).toEqual(['jus'])
  })

  it('fusionne « pomme de terre »', () => {
    expect(tokens('Pommes de terre')).toEqual(['pommedeterre'])
    expect(tokens('pomme de terre nouvelle')).toEqual(['pommedeterre', 'nouvelle'])
  })

  it('ne renvoie rien pour un libellé sans mot significatif', () => {
    expect(tokens('')).toEqual([])
    expect(tokens('de la 250 g')).toEqual([])
  })
})

describe('matchScore', () => {
  it('vaut 2 quand le produit commence par le libellé', () => {
    expect(matchScore('tomates', 'Tomates cerises bio')).toBe(2)
    expect(matchScore('lait', 'Lait demi-écrémé')).toBe(2)
    expect(matchScore('beurre', 'Beurre doux Président')).toBe(2)
  })

  it('vaut 1 quand le libellé est contenu ailleurs dans le produit', () => {
    expect(matchScore('cerise', 'Tomates cerises')).toBe(1)
    expect(matchScore('coco', 'Lait de coco')).toBe(1)
  })

  it('vaut 1 quand le produit est plus court que le libellé', () => {
    expect(matchScore('beurre doux', 'Beurre')).toBe(1)
    expect(matchScore('huile d\'olive', 'Huile')).toBe(1)
  })

  it('vaut 0 sans mot commun, ou si un seul mot manque', () => {
    expect(matchScore('gruyère', 'Emmental râpé')).toBe(0)
    expect(matchScore('tomates cerises', 'Tomates grappe')).toBe(0)
    expect(matchScore('', 'Lait')).toBe(0)
    expect(matchScore('lait', '')).toBe(0)
  })

  it('ne confond pas « pomme » et « pomme de terre »', () => {
    expect(matchScore('pomme', 'Pommes de terre')).toBe(0)
    expect(matchScore('pommes de terre', 'Pommes Golden')).toBe(0)
    expect(matchScore('pomme de terre', 'Pommes de terre nouvelles')).toBe(2)
  })

  describe('aliments composés', () => {
    it.each([
      ['lait de coco', 'Lait'],
      ['lait de coco', 'Lait demi-écrémé UHT'],
      ['lait', 'Lait de coco Suzi Wan'],
      ['lait d’amande', 'Lait de coco'],
      ['beurre de cacahuète', 'Beurre'],
      ['beurre de cacahuètes', 'Beurre doux Président'],
      ['pâte feuilletée', 'Pâtes'],
      ['pâtes', 'Pâte brisée Herta'],
      ['noix', 'Noix de coco râpée'],
      ['noix de Saint-Jacques', 'Noix'],
      ['chou-fleur', 'Chou'],
      ['eau de fleur d\'oranger', 'Eau']
    ])('« %s » ne correspond pas à « %s »', (label, product) => {
      expect(matchScore(label, product)).toBe(0)
    })

    it('correspond quand les deux nomment le même aliment composé', () => {
      expect(matchScore('Lait de coco', 'Lait de coco Suzi Wan')).toBe(2)
      expect(matchScore('pâte à tarte', 'Pâte à tarte Herta')).toBe(2)
      expect(matchScore('choux de Bruxelles', 'Choux de Bruxelles')).toBe(2)
    })

    it('reste trouvé par son complément (allergies)', () => {
      expect(matches('cacahuète', 'Beurre de cacahuète')).toBe(true)
      expect(matches('coco', 'Noix de coco')).toBe(true)
    })

    it('laisse les vraies variétés du premier mot', () => {
      expect(matches('lait', 'Lait de chèvre')).toBe(true)
      expect(matches('lait de chèvre', 'Lait')).toBe(true)
      expect(matches('noix', 'Noix de cajou')).toBe(true)
      expect(matches('chou', 'Chou rouge')).toBe(true)
    })
  })
})

describe('productMatchScore', () => {
  it('retient le meilleur du nom et de l\'aliment générique', () => {
    const product = { name: 'Coquillettes Panzani', generic_name: 'Pâtes' }
    expect(productMatchScore('pâtes', product)).toBe(2)
    expect(productMatchScore('coquillettes', product)).toBe(2)
    expect(productMatchScore('riz', product)).toBe(0)
  })

  it('ignore un aliment générique vide', () => {
    expect(productMatchScore('pâtes', { name: 'Coquillettes Panzani', generic_name: '' })).toBe(0)
    expect(productMatchScore('pâtes', { name: 'Coquillettes Panzani' })).toBe(0)
  })
})

describe('sameFood', () => {
  it('reconnaît le même aliment au pluriel, avec accents ou mots vides', () => {
    expect(sameFood('Tomates', 'tomate')).toBe(true)
    expect(sameFood('Crème fraîche', 'creme')).toBe(true)
    expect(sameFood('Huile d\'olive', 'olive huile')).toBe(true)
  })

  it('distingue un aliment plus précis', () => {
    expect(sameFood('Tomates', 'Tomates cerises')).toBe(false)
    expect(sameFood('Lait', 'Lait de coco')).toBe(false)
    expect(sameFood('', '')).toBe(false)
  })
})

describe('convertQuantity', () => {
  it('convertit les masses et les volumes', () => {
    expect(convertQuantity(1.5, 'kg', 'g')).toBe(1500)
    expect(convertQuantity(250, 'g', 'kg')).toBe(0.25)
    expect(convertQuantity(50, 'cl', 'L')).toBe(0.5)
    expect(convertQuantity(1, 'L', 'ml')).toBe(1000)
    expect(convertQuantity(2, 'dl', 'cl')).toBe(20)
  })

  it('accepte les variantes d\'écriture', () => {
    expect(convertQuantity(2, 'Kilos', 'grammes')).toBe(2000)
    expect(convertQuantity(1, 'litre', 'cl')).toBe(100)
    expect(convertQuantity(3, 'gr.', 'g')).toBe(3)
  })

  it('compte en pièces une quantité sans unité', () => {
    expect(convertQuantity(3, '', 'pièce')).toBe(3)
    expect(convertQuantity(6, 'pièces', '')).toBe(6)
  })

  it('renvoie la quantité pour deux unités identiques, même inconnues', () => {
    expect(convertQuantity(2, 'paquet', 'Paquet')).toBe(2)
  })

  it('renvoie null pour des unités non comparables', () => {
    expect(convertQuantity(100, 'g', 'ml')).toBeNull()
    expect(convertQuantity(1, 'pièce', 'g')).toBeNull()
    expect(convertQuantity(1, 'paquet', 'boîte')).toBeNull()
  })
})
