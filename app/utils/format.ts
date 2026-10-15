import type { MovementKind, Nutriscore, PreferenceLevel } from '~/utils/db'

/** Date du jour (AAAA-MM-JJ, heure locale) */
export function todayKey(): string {
  return toDateKey(new Date())
}

export function toDateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function fromDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y!, m! - 1, d!)
}

/** Ajoute des mois à une date AAAA-MM-JJ (31 janvier + 1 mois → fin février) */
export function addMonths(key: string, months: number): string {
  const d = fromDateKey(key)
  const day = d.getDate()
  d.setMonth(d.getMonth() + months)
  if (d.getDate() < day) d.setDate(0)
  return toDateKey(d)
}

/** Nombre de jours entre aujourd'hui et la date (négatif si passée) */
export function daysUntil(key: string): number {
  const today = fromDateKey(todayKey())
  return Math.round((fromDateKey(key).getTime() - today.getTime()) / 86_400_000)
}

const fmtDate = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
const fmtShort = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' })

export function formatDate(key: string | null | undefined): string {
  if (!key) return ''
  const d = fromDateKey(key.slice(0, 10))
  return d.getFullYear() === new Date().getFullYear() ? fmtShort.format(d) : fmtDate.format(d)
}

export function formatDateTime(date: string | Date): string {
  return new Date(date).toLocaleString('fr-FR', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
  })
}

export function formatTime(date: string | Date): string {
  return new Date(date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

/** Libellé et couleur de la date de péremption */
export function expiryInfo(key: string | null): { label: string, color: 'error' | 'warning' | 'success' | 'neutral' } {
  if (!key) return { label: 'Sans date', color: 'neutral' }
  const d = daysUntil(key)
  if (d < 0) return { label: `Périmé depuis ${-d} j`, color: 'error' }
  if (d === 0) return { label: 'Périme aujourd\'hui', color: 'error' }
  if (d === 1) return { label: 'Périme demain', color: 'warning' }
  if (d <= 3) return { label: `Périme dans ${d} j`, color: 'warning' }
  return { label: `Jusqu'au ${formatDate(key)}`, color: d <= 7 ? 'warning' : 'success' }
}

/** Quantité lisible : 1,5 kg ; 3 pièces */
export function formatQuantity(q: number, unit: string): string {
  const n = Math.round(q * 100) / 100
  const value = n.toLocaleString('fr-FR')
  if (unit === 'pièce') return `${value} pièce${Math.abs(n) > 1 ? 's' : ''}`
  return `${value} ${unit}`
}

export const UNITS = ['pièce', 'g', 'kg', 'ml', 'cl', 'L', 'paquet', 'boîte', 'bouteille', 'pot', 'sachet', 'tranche']

export const MOVEMENT_KINDS: { value: Exclude<MovementKind, 'adjusted'>, label: string, past: string, icon: string, color: 'primary' | 'error' | 'success' }[] = [
  { value: 'used', label: 'Utilisé', past: 'utilisé', icon: 'i-lucide-utensils', color: 'primary' },
  { value: 'thrown', label: 'Jeté', past: 'jeté', icon: 'i-lucide-trash-2', color: 'error' },
  { value: 'given', label: 'Offert', past: 'offert', icon: 'i-lucide-gift', color: 'success' }
]

export function movementLabel(kind: MovementKind): string {
  if (kind === 'adjusted') return 'Ajustement de stock'
  return MOVEMENT_KINDS.find(k => k.value === kind)!.label
}

export const PREFERENCE_LEVELS: { value: PreferenceLevel, label: string, icon: string, color: 'success' | 'primary' | 'warning' | 'error' }[] = [
  { value: 'love', label: 'Adore', icon: 'i-lucide-heart', color: 'success' },
  { value: 'like', label: 'Aime', icon: 'i-lucide-thumbs-up', color: 'primary' },
  { value: 'dislike', label: 'N\'aime pas', icon: 'i-lucide-thumbs-down', color: 'warning' },
  { value: 'allergy', label: 'Allergie / interdit', icon: 'i-lucide-ban', color: 'error' }
]

export function preferenceLevel(level: PreferenceLevel) {
  return PREFERENCE_LEVELS.find(l => l.value === level)!
}

export const NUTRISCORES: { value: Nutriscore, color: string }[] = [
  { value: 'a', color: 'bg-[#038141] text-white' },
  { value: 'b', color: 'bg-[#85bb2f] text-white' },
  { value: 'c', color: 'bg-[#fecb02] text-black' },
  { value: 'd', color: 'bg-[#ee8100] text-white' },
  { value: 'e', color: 'bg-[#e63e11] text-white' }
]

/** Lieux et types proposés à la création d'un foyer (modifiables ensuite) */
export const DEFAULT_LOCATIONS = [
  { label: 'Frigo', icon: 'i-lucide-refrigerator' },
  { label: 'Congélateur', icon: 'i-lucide-snowflake', freezer: true },
  { label: 'Autre', icon: 'i-lucide-package' }
]

/** Rangement qui ressemble à un congélateur (icône flocon ou libellé) */
export function isFreezerLike(label: string, icon: string): boolean {
  return icon === 'i-lucide-snowflake' || /^cong[eé]lateur/i.test(label.trim())
}

/**
 * Durée de conservation au congélateur proposée par type d'aliment (mois).
 * Valeurs prudentes, modifiables dans les réglages du foyer. Reprises par la migration serveur.
 */
export const FREEZER_MONTHS: Record<string, number> = {
  'Fruits et légumes': 8,
  'Viande': 6,
  'Poisson': 4,
  'Produits laitiers': 3,
  'Féculents': 3,
  'Épicerie sucrée': 3,
  'Plats préparés': 3
}

export const DEFAULT_FOOD_TYPES = [
  'Fruits et légumes', 'Viande', 'Poisson', 'Produits laitiers', 'Œufs', 'Féculents',
  'Conserves', 'Épicerie sucrée', 'Épicerie salée', 'Boissons', 'Plats préparés', 'Autre'
]

export const LOCATION_ICONS = [
  'i-lucide-refrigerator', 'i-lucide-snowflake', 'i-lucide-package', 'i-lucide-archive',
  'i-lucide-wine', 'i-lucide-cookie', 'i-lucide-warehouse', 'i-lucide-box'
]
