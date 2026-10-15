<script setup lang="ts">
import type { HouseholdOption } from '~/utils/db'
import type { OptionTable } from '~/composables/useHousehold'

/** Rangement (icône, congélateur) ou type d'aliment (conservation au congélateur) */
type Option = HouseholdOption & { icon?: string, freezer?: boolean, freezer_months?: number | null }

/** Liste paramétrable d'un foyer : lieux de stockage (avec icône) ou types d'aliments */
const props = defineProps<{
  householdId: string
  table: OptionTable
  /** éléments actifs, triés */
  options: Option[]
  /** éléments archivés */
  archived: Option[]
  /** nombre d'utilisations de chaque élément */
  usage: Map<string, number>
  placeholder: string
}>()

const { addOption, updateOption, reorderOptions } = useHouseholdActions()
const toast = useToast()

const withIcon = computed(() => props.table === 'locations')
const newLabel = ref('')
const newIcon = ref(LOCATION_ICONS[2]!)
const editingId = ref<string | null>(null)
const editingLabel = ref('')
const showArchived = ref(false)

async function add() {
  const label = newLabel.value.trim()
  if (!label) return
  await addOption(props.table, props.householdId, label, withIcon.value ? newIcon.value : '')
  newLabel.value = ''
}

function startEdit(o: { id: string, label: string }) {
  editingId.value = o.id
  editingLabel.value = o.label
}

async function commitEdit(o: { id: string, label: string }) {
  const label = editingLabel.value.trim()
  editingId.value = null
  if (!label || label === o.label) return
  if (props.options.some(x => x.id !== o.id && x.label.toLowerCase() === label.toLowerCase())) {
    toast.add({ title: 'Ce libellé existe déjà', color: 'warning' })
    return
  }
  await updateOption(props.table, o.id, { label })
}

async function cycleIcon(o: { id: string, icon?: string }) {
  const i = LOCATION_ICONS.indexOf(o.icon ?? '')
  await updateOption(props.table, o.id, { icon: LOCATION_ICONS[(i + 1) % LOCATION_ICONS.length] })
}

async function toggleFreezer(o: Option) {
  await updateOption(props.table, o.id, { freezer: !o.freezer })
}

/** Durée de conservation au congélateur d'un type (0 ou vide = non renseignée) */
async function setFreezerMonths(o: Option, months: number | null | undefined) {
  const value = months && months > 0 ? Math.min(60, Math.round(months)) : null
  if (value !== (o.freezer_months ?? null)) await updateOption(props.table, o.id, { freezer_months: value })
}

async function move(index: number, delta: -1 | 1) {
  const list = [...props.options]
  const target = index + delta
  if (target < 0 || target >= list.length) return
  ;[list[index], list[target]] = [list[target]!, list[index]!]
  await reorderOptions(props.table, list)
}

async function archive(o: { id: string, label: string }) {
  await updateOption(props.table, o.id, { deleted_at: new Date().toISOString() })
  toast.add({
    title: `« ${o.label} » retiré de la liste`,
    description: 'Les produits existants le conservent.',
    actions: [{ label: 'Annuler', color: 'neutral', variant: 'outline', onClick: () => updateOption(props.table, o.id, { deleted_at: null }) }]
  })
}

async function restore(o: { id: string }) {
  await updateOption(props.table, o.id, { deleted_at: null, position: Math.max(0, ...props.options.map(x => x.position)) + 1 })
}
</script>

<template>
  <div class="space-y-3">
    <ul class="divide-y divide-default rounded-lg border border-default">
      <li v-for="(o, i) in options" :key="o.id" class="flex items-center gap-1 pl-2 pr-1 py-1.5">
        <UButton
          v-if="withIcon"
          :icon="o.icon || 'i-lucide-package'"
          size="sm"
          color="primary"
          variant="ghost"
          aria-label="Changer l'icône"
          @click="cycleIcon(o)"
        />
        <form v-if="editingId === o.id" class="flex-1 flex gap-1" @submit.prevent="commitEdit(o)">
          <UInput v-model="editingLabel" size="sm" class="flex-1" autofocus @blur="commitEdit(o)" @keydown.esc="editingId = null" />
        </form>
        <button v-else type="button" class="flex-1 min-w-0 text-left py-1 pl-1" @click="startEdit(o)">
          <span class="truncate">{{ o.label }}</span>
          <span v-if="usage.get(o.id)" class="text-xs text-muted ml-1.5">· {{ usage.get(o.id) }}</span>
          <UIcon v-if="o._dirty" name="i-lucide-cloud-upload" class="size-3 text-warning ml-1" />
        </button>
        <UButton
          v-if="withIcon"
          icon="i-lucide-thermometer-snowflake"
          size="xs"
          :color="o.freezer ? 'info' : 'neutral'"
          :variant="o.freezer ? 'soft' : 'ghost'"
          :class="o.freezer ? '' : 'opacity-40'"
          :aria-pressed="!!o.freezer"
          :title="o.freezer ? 'Congélateur (toucher pour retirer)' : 'Marquer comme congélateur'"
          aria-label="Congélateur"
          @click="toggleFreezer(o)"
        />
        <UPopover v-else>
          <UButton
            icon="i-lucide-snowflake"
            size="xs"
            :color="o.freezer_months ? 'info' : 'neutral'"
            :variant="o.freezer_months ? 'soft' : 'ghost'"
            :class="o.freezer_months ? '' : 'opacity-40'"
            title="Conservation au congélateur"
            :aria-label="`Conservation au congélateur : ${o.freezer_months ? `${o.freezer_months} mois` : 'non renseignée'}`"
          >
            {{ o.freezer_months ? `${o.freezer_months} mois` : '' }}
          </UButton>
          <template #content>
            <div class="p-3 space-y-2 w-60">
              <p class="text-sm font-medium">
                Au congélateur : {{ o.label }}
              </p>
              <UInputNumber
                :model-value="o.freezer_months ?? undefined"
                :min="0"
                :max="60"
                placeholder="Non renseignée"
                :format-options="{ style: 'unit', unit: 'month', unitDisplay: 'long' }"
                class="w-full"
                @update:model-value="v => setFreezerMonths(o, v)"
              />
              <p class="text-xs text-muted">
                Date limite proposée pour un lot rangé au congélateur. 0 = pas de date proposée.
              </p>
            </div>
          </template>
        </UPopover>
        <UButton icon="i-lucide-chevron-up" size="xs" color="neutral" variant="ghost" :disabled="i === 0" aria-label="Monter" @click="move(i, -1)" />
        <UButton icon="i-lucide-chevron-down" size="xs" color="neutral" variant="ghost" :disabled="i === options.length - 1" aria-label="Descendre" @click="move(i, 1)" />
        <UButton icon="i-lucide-x" size="xs" color="error" variant="ghost" aria-label="Retirer de la liste" @click="archive(o)" />
      </li>
      <li v-if="!options.length" class="px-3 py-3 text-sm text-muted">
        Aucun élément. Ajoutez-en ci-dessous.
      </li>
    </ul>

    <form class="flex gap-2" @submit.prevent="add">
      <UButton
        v-if="withIcon"
        :icon="newIcon"
        color="neutral"
        variant="outline"
        aria-label="Icône"
        @click="newIcon = LOCATION_ICONS[(LOCATION_ICONS.indexOf(newIcon) + 1) % LOCATION_ICONS.length]!"
      />
      <UInput v-model="newLabel" :placeholder="placeholder" class="flex-1" />
      <UButton type="submit" icon="i-lucide-plus" :disabled="!newLabel.trim()">
        Ajouter
      </UButton>
    </form>

    <div v-if="archived.length">
      <UButton
        size="xs"
        variant="link"
        color="neutral"
        :icon="showArchived ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
        @click="showArchived = !showArchived"
      >
        {{ archived.length }} élément(s) retiré(s)
      </UButton>
      <ul v-if="showArchived" class="mt-1 space-y-1">
        <li v-for="o in archived" :key="o.id" class="flex items-center gap-2 pl-3 text-sm text-muted">
          <span class="flex-1 line-through truncate">{{ o.label }}</span>
          <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-undo-2" @click="restore(o)">
            Remettre
          </UButton>
        </li>
      </ul>
    </div>
  </div>
</template>
