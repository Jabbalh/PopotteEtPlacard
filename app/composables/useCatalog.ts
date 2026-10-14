/** Aliment proposé à la saisie d'une préférence */
export interface CatalogItem {
  name: string
  barcode: string | null
  inStock: boolean
}

/**
 * Aliments connus, proposés à la saisie des préférences : produits du foyer
 * (ou de tous mes foyers sans foyer précisé), en stock d'abord.
 */
export function useFoodCatalog(householdId?: Ref<string>) {
  const db = useDb()

  const { data: catalog } = useLiveQuery(
    async () => {
      const id = householdId?.value
      const [products, items, movements] = await Promise.all([
        id ? db.products.where('household_id').equals(id).toArray() : db.products.toArray(),
        id ? db.stockItems.where('household_id').equals(id).toArray() : db.stockItems.toArray(),
        id ? db.movements.where('household_id').equals(id).toArray() : db.movements.toArray()
      ])
      const removed = new Map<string, number>()
      for (const m of movements) if (!m.deleted_at) removed.set(m.stock_item_id, (removed.get(m.stock_item_id) ?? 0) + Number(m.quantity))
      const inStock = new Set(items
        .filter(i => !i.deleted_at && Number(i.quantity) - (removed.get(i.id) ?? 0) > 0)
        .map(i => i.product_id))

      // un même aliment dans plusieurs foyers n'apparaît qu'une fois
      const byKey = new Map<string, CatalogItem>()
      for (const p of products) {
        if (p.deleted_at) continue
        const key = p.barcode || p.name.trim().toLowerCase()
        const existing = byKey.get(key)
        const stocked = inStock.has(p.id)
        if (existing) existing.inStock ||= stocked
        else byKey.set(key, { name: p.name, barcode: p.barcode, inStock: stocked })
      }
      return [...byKey.values()].sort((a, b) => Number(b.inStock) - Number(a.inStock) || a.name.localeCompare(b.name))
    },
    [] as CatalogItem[],
    householdId ? [householdId] : []
  )

  return { catalog }
}

/**
 * Nom d'un aliment à partir de son code-barres : produit déjà connu dans un de mes foyers,
 * sinon Open Food Facts (réseau requis). null si introuvable ; erreur si Open Food Facts est injoignable.
 */
export function useBarcodeLookup() {
  const db = useDb()
  const { online } = useSync()

  async function lookup(code: string): Promise<{ name: string, source: 'local' | 'off' } | null> {
    const known = await db.products.filter(p => p.barcode === code && !p.deleted_at).first()
    if (known) return { name: known.name, source: 'local' }
    if (!online.value) throw new Error('Hors connexion : produit introuvable localement')
    const off = await fetchOffProduct(code)
    return off?.name ? { name: off.name, source: 'off' } : null
  }

  return { lookup }
}
