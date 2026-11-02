/**
 * Tickets de caisse : extraction du texte d'un ticket PDF (ticket dématérialisé),
 * découpage en articles (libellé, quantité, prix) et rapprochement des libellés
 * abrégés (« BEURRE DX PRES 250G ») avec les produits déjà achetés par le foyer.
 */
import type { Product, ReceiptAlias } from './db'
import { tokens } from './matching'

/** Article lu sur un ticket */
export interface ReceiptItem {
  label: string
  quantity: number
  /** quantité en kg (article pesé) */
  weighed: boolean
  /** prix total de la ligne */
  price: number | null
}

export interface ParsedReceipt {
  items: ReceiptItem[]
  /**
   * Autres lignes de texte du ticket, non retenues comme articles (en-tête, totaux, paiement,
   * ou format non reconnu) : proposées à l'utilisateur, qui les valide ou les exclut
   */
  others: ReceiptItem[]
  /** date d'achat trouvée sur le ticket (AAAA-MM-JJ) */
  date: string | null
}

// --- Texte d'un PDF ---

/**
 * Texte d'un PDF, ligne par ligne (les morceaux de texte de même hauteur sont réunis).
 * Fonctionne pour les tickets dématérialisés ; un PDF issu d'un scan (image) ne contient pas de texte.
 */
export async function extractPdfLines(file: File): Promise<string[]> {
  const [pdfjs, { default: workerUrl }] = await Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')
  ])
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
  const doc = await task.promise
  const lines: string[] = []
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      const content = await page.getTextContent()
      const rows: { y: number, parts: { x: number, end: number, str: string }[] }[] = []
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue
        const x = item.transform[4] as number
        const y = item.transform[5] as number
        // même ligne : hauteur identique à 2 points près
        let row = rows.find(r => Math.abs(r.y - y) <= 2)
        if (!row) rows.push(row = { y, parts: [] })
        row.parts.push({ x, end: x + item.width, str: item.str })
      }
      rows.sort((a, b) => b.y - a.y)
      for (const row of rows) {
        row.parts.sort((a, b) => a.x - b.x)
        let text = ''
        let end = -Infinity
        for (const p of row.parts) {
          // un écart visible entre deux morceaux = séparation de colonnes
          text += text && p.x - end > 1 ? '  ' : ''
          text += p.str
          end = p.end
        }
        lines.push(text.trim())
      }
    }
  } finally {
    // libère le document et le worker
    await task.destroy()
  }
  return lines
}

// --- Découpage en articles ---

const PRICE = String.raw`-?\d{1,4}[,.]\d{2}`
/** Prix en fin de ligne, éventuellement suivi de « € » et d'un code TVA (A, B, 1, 11…) */
const END_PRICE = new RegExp(String.raw`\s(${PRICE})\s*(?:€|eur)?(?:\s+[a-z*]{1,2}|\s+\d{1,2})?\s*$`, 'i')
/** « 2 x 1,15 » (quantité × prix unitaire), éventuellement suivi du total */
const QTY_LINE = new RegExp(String.raw`^(\d{1,3})\s*[x*]\s*(${PRICE})\s*(?:€|eur)?(?:\s*=?\s*(${PRICE}))?\s*(?:€|eur)?(?:\s+[a-z*]{1,2})?$`, 'i')
/** « 0,512 kg x 2,99 €/kg » */
const WEIGHT_LINE = new RegExp(String.raw`^(\d+[,.]\d{1,3})\s*kg\s*[x*]?\s*(${PRICE})\s*(?:€|eur)?\s*/\s*kg(?:\s*=?\s*(${PRICE}))?`, 'i')
/** Colonnes « libellé  quantité  prix unitaire  total » */
const COLUMNS = new RegExp(String.raw`^(.*?\S)\s+(\d{1,3})\s+(${PRICE})\s*(?:€)?\s+(${PRICE})\s*(?:€|eur)?(?:\s+[a-z*]{1,2}|\s+\d{1,2})?\s*$`, 'i')
/** Fin de la liste des articles : premier total (les lignes suivantes ne sont jamais des articles) */
const END_OF_ITEMS = /^(sous[- ]?total|total|nombre de lignes|nombre d.articles|nb articles?|net a payer|a payer)\b/

/** Lignes qui ne sont pas des articles (totaux, paiement, en-tête, fidélité…) */
const NOT_AN_ITEM = /\b(sous[- ]?total|total|tva|t\.v\.a|ttc|carte|cb|visa|mastercard|especes?|rendu|monnaie|a payer|montant|paiement|regle|remise|reduction|bon d.achat|fidelite|avantage|cagnotte|economie|points?|ticket|caisse|caissier|merci|siret|tel|www|http|magasin|client|nb articles?|nombre d.articles?|articles?|date|heure|transaction|autorisation|sans contact|emv|aid|solde|avoir|net)\b/

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/œ/g, 'oe')
}

function toNumber(text: string): number {
  return Number(text.replace(',', '.'))
}

function near(a: number, b: number) {
  return Math.abs(a - b) < 0.02
}

/** Quantité écrite dans le libellé : « 2 x LAIT », « LAIT x2 » */
function inlineQuantity(label: string): { label: string, quantity: number } {
  let m = label.match(/^(\d{1,2})\s*[x*]\s+(.+)$/i)
  if (m) return { label: m[2]!.trim(), quantity: Number(m[1]) }
  m = label.match(/^(.+?)\s+[x*]\s?(\d{1,2})$/i)
  if (m) return { label: m[1]!.trim(), quantity: Number(m[2]) }
  return { label, quantity: 1 }
}

/** Date du ticket : JJ/MM/AAAA, JJ/MM/AA, JJ.MM.AAAA ou JJ-MM-AAAA (plausible : ni future, ni trop ancienne) */
function findDate(lines: string[]): string | null {
  const today = new Date()
  for (const line of lines) {
    for (const m of line.matchAll(/\b(\d{2})[/.-](\d{2})[/.-](\d{4}|\d{2})\b/g)) {
      const day = Number(m[1])
      const month = Number(m[2])
      const year = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3])
      const date = new Date(year, month - 1, day)
      if (date.getMonth() !== month - 1 || date.getDate() !== day) continue
      const days = (today.getTime() - date.getTime()) / 86_400_000
      if (days < -1 || days > 365) continue
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    }
  }
  return null
}

/**
 * Articles d'un ticket. Reconnaît les formats courants : prix en fin de ligne,
 * ligne « 2 x 1,15 » avant ou après l'article, articles pesés, colonnes
 * quantité / prix unitaire / total. Un texte sans aucun prix (liste saisie à la main)
 * donne un article par ligne. Un même libellé présent plusieurs fois est regroupé.
 * Les autres lignes de texte sont conservées à part (`others`).
 */
export function parseReceipt(lines: string[]): ParsedReceipt {
  const clean = lines.map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean)
  const date = findDate(clean)
  const items: ReceiptItem[] = []
  const hasPrices = clean.some(l => END_PRICE.test(l))

  if (!hasPrices) {
    for (const line of clean) {
      // ligne qui ne contient qu'un prix (« 1,15 EUR ») : pas un article
      if (new RegExp(String.raw`^${PRICE}\s*(?:€|eur)?$`, 'i').test(line)) continue
      const { label, quantity } = inlineQuantity(line.replace(/^[-•*]\s*/, ''))
      if (/[a-z]{2}/i.test(label)) items.push({ label, quantity, weighed: false, price: null })
    }
    return { items: merge(items), others: [], date }
  }

  const others: ReceiptItem[] = []
  /** ligne de texte non retenue comme article (avec son prix éventuel, s'il est positif) */
  const other = (label: string, price: number | null = null) => {
    if (/[a-z]{2}/i.test(label)) others.push({ label, quantity: 1, weighed: false, price: price !== null && price > 0 ? price : null })
  }

  /** quantité lue avant son article */
  let pending: { quantity: number, weighed: boolean, unit: number } | null = null
  let previous: ReceiptItem | null = null
  /** l'article précédent a déjà reçu sa quantité */
  let previousSet = false
  /** premier total passé : fin des articles (fidélité, paiement, TVA… ne sont plus lus comme articles) */
  let ended = false

  for (const line of clean) {
    const n = normalize(line)
    if (!ended && items.length && END_OF_ITEMS.test(n)) ended = true
    if (ended) {
      other(line.replace(END_PRICE, '').trim() || line)
      continue
    }
    const qty = n.match(QTY_LINE)
    const weight = n.match(WEIGHT_LINE)
    if (qty || weight) {
      const quantity = toNumber((qty ?? weight)![1]!)
      const unit = toNumber((qty ?? weight)![2]!)
      const weighed = !!weight
      if (previous && !previousSet && previous.price !== null && near(previous.price, Math.round(quantity * unit * 100) / 100)) {
        previous.quantity = quantity
        previous.weighed = weighed
        previousSet = true
      } else {
        pending = { quantity, weighed, unit }
      }
      continue
    }

    const columns = line.match(COLUMNS)
    const end = line.match(END_PRICE)
    if (!end) {
      other(line)
      continue
    }
    let label = (columns ? columns[1]! : line.slice(0, end.index)).trim()
    const price = toNumber(columns ? columns[4]! : end[1]!)
    if (price <= 0 || NOT_AN_ITEM.test(normalize(label)) || !/[a-z]{2}/i.test(label)) {
      other(label, price)
      pending = null
      continue
    }

    let quantity = 1
    let weighed = false
    if (columns && near(Number(columns[2]) * toNumber(columns[3]!), price)) {
      quantity = Number(columns[2])
    } else if (pending && near(Math.round(pending.quantity * pending.unit * 100) / 100, price)) {
      quantity = pending.quantity
      weighed = pending.weighed
    } else {
      const inline = inlineQuantity(label)
      label = inline.label
      quantity = inline.quantity
    }
    pending = null
    previous = { label, quantity, weighed, price }
    previousSet = quantity !== 1 || weighed
    items.push(previous)
  }
  return { items: merge(items), others, date }
}

/** Regroupe les articles de même libellé (passés plusieurs fois en caisse) */
function merge(items: ReceiptItem[]): ReceiptItem[] {
  const byKey = new Map<string, ReceiptItem>()
  for (const item of items) {
    // un article pesé et un article à la pièce de même libellé restent distincts
    const key = `${item.weighed ? 'kg' : 'u'}:${receiptKey(item.label)}`
    const existing = byKey.get(key)
    if (existing) {
      existing.quantity = Math.round((existing.quantity + item.quantity) * 1000) / 1000
      existing.price = existing.price !== null && item.price !== null ? Math.round((existing.price + item.price) * 100) / 100 : null
    } else {
      byKey.set(key, { ...item })
    }
  }
  return [...byKey.values()]
}

// --- Rapprochement avec les produits du foyer ---

/** Clé d'un libellé de ticket, pour mémoriser les associations : minuscules, sans accents, espaces simples */
export function receiptKey(label: string): string {
  return normalize(label).replace(/[^a-z0-9%/,.]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Mots significatifs d'un libellé de ticket : sans contenance (1L, 250G, 6X125G), sans nombres */
function receiptTokens(label: string): string[] {
  return tokens(normalize(label)
    .replace(/\b1\/2\b/g, ' demi ')
    .replace(/\b(x\s*)?\d+([,.]\d+)?\s*(x\s*\d+([,.]\d+)?\s*)?(kg|g|gr|l|cl|ml|pc|pcs|p)?\b/g, ' '))
}

/** Un mot du ticket correspond à un mot du produit : identique, ou abréviation (« ecr » → « ecreme ») */
function wordMatch(a: string, b: string): boolean {
  if (a === b) return true
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  return short.length >= 3 && long.startsWith(short)
}

/**
 * Similarité (0 à 1) entre les mots d'un ticket et ceux d'un produit (`extra` : marque,
 * qui peut expliquer un mot du ticket sans être exigée)
 */
function similarity(receipt: string[], target: string[], extra: string[] = []): number {
  if (!receipt.length || !target.length) return 0
  const found = receipt.filter(w => target.some(t => wordMatch(w, t)) || extra.some(t => wordMatch(w, t))).length
  const covered = target.filter(t => receipt.some(w => wordMatch(w, t))).length
  if (!found) return 0
  const first = wordMatch(receipt[0]!, target[0]!) ? 0.1 : 0
  return Math.min(1, (found / receipt.length) * 0.6 + (covered / target.length) * 0.3 + first)
}

export interface ProductMatch {
  product: Product
  score: number
}

/**
 * Produits du foyer qui ressemblent à un libellé de ticket, du plus probable au moins probable :
 * comparaison avec le nom et la marque du produit, et avec les autres libellés de ticket
 * déjà associés à ce produit (même façon d'abréger).
 */
export function suggestProducts(label: string, products: Product[], aliases: ReceiptAlias[], limit = 4): ProductMatch[] {
  const words = receiptTokens(label)
  if (!words.length) return []
  const aliasWords = new Map<string, string[][]>()
  for (const a of aliases) {
    if (!a.product_id || a.deleted_at) continue
    const list = aliasWords.get(a.product_id) ?? []
    list.push(receiptTokens(a.label))
    aliasWords.set(a.product_id, list)
  }
  const result: ProductMatch[] = []
  for (const product of products) {
    let score = similarity(words, tokens(product.name), tokens(product.brand))
    for (const other of aliasWords.get(product.id) ?? []) score = Math.max(score, similarity(words, other))
    if (score >= 0.35) result.push({ product, score })
  }
  return result.sort((a, b) => b.score - a.score || a.product.name.localeCompare(b.product.name)).slice(0, limit)
}

/** Proposition assez sûre pour être présélectionnée (à vérifier par l'utilisateur) */
export const STRONG_MATCH = 0.8

/** Nom proposé pour un nouveau produit : libellé sans contenance, en minuscules avec majuscule initiale */
export function productNameFromLabel(label: string): string {
  const text = label
    .replace(/\b\d+([,.]\d+)?\s*(x\s*\d+([,.]\d+)?\s*)?(kg|g|gr|l|cl|ml)\b/gi, ' ')
    .replace(/\bx\s?\d+\b/gi, ' ')
    // abréviations à points (« BEUR.BRETAG. ») : mots séparés
    .replace(/(?<=[a-z])\.(?=[a-z])/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
  return text.charAt(0).toUpperCase() + text.slice(1)
}
