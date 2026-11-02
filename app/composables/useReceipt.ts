import type { Product, ReceiptAlias, ReceiptLine } from '~/utils/db'
import type { ReceiptItem } from '~/utils/receipt'

/** Quantité d'une ligne dans l'unité du produit (article pesé : kg → g si besoin) */
export function lineQuantity(line: Pick<ReceiptLine, 'quantity' | 'weighed'>, unit: string): number {
  if (line.weighed && unit === 'g') return Math.round(line.quantity * 1000)
  return line.quantity
}

/** État d'une ligne de ticket */
export function lineStatus(line: ReceiptLine): 'ignored' | 'ready' | 'todo' {
  if (line.ignored) return 'ignored'
  if ((line.product_id || line.new_product?.name.trim()) && line.quantity > 0) return 'ready'
  return 'todo'
}

/**
 * Ticket de caisse en cours d'un foyer (« stock temporaire ») : lignes en attente sur cet appareil,
 * libellés mémorisés par le foyer, rapprochement avec les produits déjà achetés,
 * puis ajout au stock des lignes complètes.
 */
export function useReceipt(householdId: Ref<string>) {
  const db = useDb()
  const { schedule } = useSync()
  const { addProduct, addStockItem } = useHouseholdActions()
  const { products, productById, allLots } = useStock(householdId)
  const { locations, foodTypes } = useHouseholdOptions(householdId)

  const { data: lines, loading } = useLiveQuery(
    async () => (await db.receiptLines.where('household_id').equals(householdId.value).toArray())
      .sort((a, b) => a.position - b.position),
    [] as ReceiptLine[],
    [householdId]
  )
  const { data: allAliases } = useLiveQuery(
    () => db.receiptAliases.where('household_id').equals(householdId.value).toArray(),
    [] as ReceiptAlias[],
    [householdId]
  )
  /** Libellés mémorisés dont le produit existe toujours (ou libellés à ignorer) */
  const aliases = computed(() => allAliases.value.filter(a => !a.deleted_at && (!a.product_id || (productById.value.get(a.product_id) && !productById.value.get(a.product_id)!.deleted_at))))
  const aliasByKey = computed(() => {
    const map = new Map<string, ReceiptAlias>()
    // le plus récent l'emporte (deux appareils ont pu mémoriser le même libellé)
    for (const a of [...aliases.value].sort((x, y) => x.updated_at.localeCompare(y.updated_at))) map.set(a.label, a)
    return map
  })

  /** Rangement du dernier lot du produit, sinon le premier rangement */
  const lastLocationByProduct = computed(() => {
    const map = new Map<string, { at: string, location: string | null }>()
    for (const l of allLots.value) {
      const prev = map.get(l.product.id)
      if (!prev || l.item.created_at > prev.at) map.set(l.product.id, { at: l.item.created_at, location: l.item.location_id })
    }
    return map
  })
  function locationOf(line: ReceiptLine): string | null {
    if (line.location_id) return line.location_id
    const last = line.product_id ? lastLocationByProduct.value.get(line.product_id)?.location : null
    if (last && locations.value.some(l => l.id === last)) return last
    return locations.value[0]?.id ?? null
  }

  /** Date limite proposée au congélateur (rangement congélateur + durée du type d'aliment) */
  function freezerLimitOf(line: ReceiptLine): { months: number, type: string, date: string } | null {
    const location = locations.value.find(l => l.id === locationOf(line))
    if (!location?.freezer) return null
    const typeId = line.product_id ? productById.value.get(line.product_id)?.food_type_id : line.new_product?.food_type_id
    const type = foodTypes.value.find(t => t.id === typeId)
    if (!type?.freezer_months) return null
    return { months: type.freezer_months, type: type.label, date: addMonths(line.purchased_on, type.freezer_months) }
  }

  function suggestionsFor(line: ReceiptLine) {
    return suggestProducts(line.label, products.value, aliases.value)
  }

  /** Ajoute les articles d'un ticket à la liste en attente, en reconnaissant les libellés connus */
  async function importItems(items: ReceiptItem[], purchasedOn: string) {
    const start = Math.max(0, ...lines.value.map(l => l.position)) + 1
    let recognized = 0
    let guessed = 0
    const rows: ReceiptLine[] = items.map((item, i) => {
      const alias = aliasByKey.value.get(receiptKey(item.label))
      let productId: string | null = null
      let match: ReceiptLine['match'] = null
      if (alias?.product_id) {
        productId = alias.product_id
        match = 'alias'
        recognized++
      } else if (!alias) {
        const best = suggestProducts(item.label, products.value, aliases.value, 2)
        // présélection seulement si la proposition est nette (à vérifier par l'utilisateur)
        if (best[0] && best[0].score >= STRONG_MATCH && (!best[1] || best[1].score < best[0].score - 0.15)) {
          productId = best[0].product.id
          match = 'guess'
          guessed++
        }
      }
      return {
        id: crypto.randomUUID(),
        household_id: householdId.value,
        position: start + i,
        label: item.label,
        quantity: item.quantity,
        weighed: item.weighed,
        price: item.price,
        purchased_on: purchasedOn,
        product_id: productId,
        match,
        new_product: null,
        ignored: !!alias && !alias.product_id,
        location_id: null,
        expires_on: null,
        created_at: new Date().toISOString()
      }
    })
    await db.receiptLines.bulkAdd(rows)
    return { added: rows.length, recognized, guessed, ignored: rows.filter(r => r.ignored).length }
  }

  async function addLine(label: string, purchasedOn: string) {
    return importItems([{ label: label.trim(), quantity: 1, weighed: false, price: null }], purchasedOn)
  }

  const updateLine = (id: string, changes: Partial<ReceiptLine>) => db.receiptLines.update(id, changes)
  const removeLine = (id: string) => db.receiptLines.delete(id)
  const clear = () => db.receiptLines.where('household_id').equals(householdId.value).delete()

  /** Associe un libellé à un produit (ou null = à ignorer) pour les prochains tickets */
  async function remember(label: string, productId: string | null) {
    const key = receiptKey(label)
    if (!key) return
    const existing = aliasByKey.value.get(key) ?? allAliases.value.find(a => a.label === key && !a.deleted_at)
    if (existing) {
      if (existing.product_id === productId) return
      await db.receiptAliases.update(existing.id, { product_id: productId, _dirty: 1, _lmod: Date.now() })
      return
    }
    const now = new Date().toISOString()
    await db.receiptAliases.add({
      id: crypto.randomUUID(), household_id: householdId.value, label: key, product_id: productId,
      created_at: now, updated_at: now, deleted_at: null, _dirty: 1, _lmod: Date.now()
    })
  }

  /**
   * Ajoute au stock les lignes complètes (produit existant ou nouveau produit, quantité > 0),
   * mémorise leurs libellés, et retire de la liste les lignes ajoutées et les lignes ignorées.
   */
  async function validate() {
    const ready = lines.value.filter(l => lineStatus(l) === 'ready')
    const ignored = lines.value.filter(l => l.ignored)
    /** nouveaux produits de même nom créés une seule fois */
    const created = new Map<string, Product>()
    for (const line of ready) {
      let product = line.product_id ? productById.value.get(line.product_id) : undefined
      if (!product && line.new_product) {
        const np = line.new_product
        const key = np.barcode || np.name.trim().toLowerCase()
        product = created.get(key)
        if (!product) {
          product = await addProduct(householdId.value, { ...np })
          created.set(key, product)
        }
      }
      if (!product) continue
      const freezer = freezerLimitOf(line)
      await addStockItem(householdId.value, {
        product_id: product.id,
        location_id: locationOf(line),
        quantity: lineQuantity(line, product.unit),
        purchased_on: line.purchased_on,
        expires_on: line.expires_on || freezer?.date || null,
        price: line.price,
        note: ''
      })
      await remember(line.label, product.id)
      await db.receiptLines.delete(line.id)
    }
    for (const line of ignored) {
      await remember(line.label, null)
      await db.receiptLines.delete(line.id)
    }
    schedule()
    return { added: ready.length, ignored: ignored.length }
  }

  return {
    loading, lines, aliases, products, productById, locations, foodTypes,
    locationOf, freezerLimitOf, suggestionsFor,
    importItems, addLine, updateLine, removeLine, clear, validate
  }
}

/** Nombre de lignes de ticket en attente pour un foyer (bandeau du stock) */
export function usePendingReceipt(householdId: Ref<string>) {
  const db = useDb()
  const { data } = useLiveQuery(
    () => db.receiptLines.where('household_id').equals(householdId.value).count(),
    0,
    [householdId]
  )
  return { pendingLines: data }
}
