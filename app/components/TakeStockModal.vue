<script setup lang="ts">
import type { MovementKind } from '~/utils/db'
import type { TakeLine } from '~/composables/useStock'

/**
 * Sortie de stock : un aliment (une ligne) ou les aliments d'une recette (plusieurs lignes).
 * Pour chaque lot : quantité retirée ou « tout ». Raison (utilisé, jeté, offert) et date modifiables.
 */
const props = defineProps<{
  householdId: string
  lines: TakeLine[]
  title?: string
  /** nom de la recette réalisée */
  recipeName?: string | null
}>()
const open = defineModel<boolean>('open', { default: false })

const toast = useToast()
const { addMovements, cancelMovements } = useHouseholdActions()

interface Row { line: TakeLine, selected: boolean, all: boolean, quantity: number | null }

const rows = ref<Row[]>([])
const kind = ref<Exclude<MovementKind, 'adjusted'>>('used')
const occurredOn = ref(todayKey())
const note = ref('')

watch(open, (o) => {
  if (!o) return
  kind.value = 'used'
  occurredOn.value = todayKey()
  note.value = ''
  rows.value = props.lines.map((line) => {
    const suggested = line.suggested && line.suggested > 0 ? Math.min(line.suggested, line.lot.remaining) : null
    return { line, selected: line.selected ?? true, all: !suggested, quantity: suggested ?? line.lot.remaining }
  })
}, { immediate: true })

const single = computed(() => props.lines.length === 1)

function qtyOf(r: Row) {
  return r.all ? r.line.lot.remaining : Math.min(r.quantity ?? 0, r.line.lot.remaining)
}

const selectedRows = computed(() => rows.value.filter(r => r.selected && qtyOf(r) > 0))
const saving = ref(false)

async function save() {
  if (!selectedRows.value.length) return
  saving.value = true
  try {
    const created = await addMovements(props.householdId, selectedRows.value.map(r => ({
      stock_item_id: r.line.lot.item.id,
      kind: kind.value,
      quantity: qtyOf(r),
      occurred_on: occurredOn.value || todayKey(),
      recipe_name: props.recipeName ?? null,
      note: note.value.trim()
    })))
    const k = MOVEMENT_KINDS.find(x => x.value === kind.value)!
    const first = selectedRows.value[0]!.line.lot.product.name
    toast.add({
      title: single.value ? `${first} : ${k.past}` : `${selectedRows.value.length} aliments retirés du stock`,
      icon: k.icon,
      color: 'success',
      duration: 6000,
      actions: [{ label: 'Annuler', color: 'neutral', variant: 'outline', onClick: () => cancelMovements(created.map(m => m.id)) }]
    })
    open.value = false
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="title ?? 'Modifier le stock'"
    :description="title ? undefined : single ? lines[0]?.lot.product.name : undefined"
    :ui="{ content: 'max-h-[92dvh]', body: 'overflow-y-auto' }">
    <template #body>
      <form id="take-stock" class="space-y-5" @submit.prevent="save">
        <UFormField label="Raison">
          <div class="grid grid-cols-3 gap-2">
            <UButton
              v-for="k in MOVEMENT_KINDS"
              :key="k.value"
              :icon="k.icon"
              :color="kind === k.value ? k.color : 'neutral'"
              :variant="kind === k.value ? 'solid' : 'outline'"
              class="justify-center"
              @click="kind = k.value"
            >
              {{ k.label }}
            </UButton>
          </div>
        </UFormField>

        <div class="space-y-2">
          <div
            v-for="r in rows"
            :key="r.line.lot.item.id"
            class="rounded-xl border p-3 space-y-2 transition"
            :class="r.selected ? 'border-default bg-elevated/40' : 'border-dashed border-default opacity-60'"
          >
            <div class="flex items-start gap-2">
              <UCheckbox v-if="!single" v-model="r.selected" class="mt-0.5" />
              <div class="flex-1 min-w-0">
                <p v-if="r.line.ingredient" class="text-xs text-muted">
                  {{ r.line.ingredient }}
                </p>
                <p class="font-medium truncate">
                  {{ r.line.lot.product.name }}
                </p>
                <p class="text-xs text-muted">
                  Reste {{ formatQuantity(r.line.lot.remaining, r.line.lot.product.unit) }}
                  <template v-if="r.line.lot.item.expires_on">
                    · {{ expiryInfo(r.line.lot.item.expires_on).label }}
                  </template>
                </p>
              </div>
            </div>
            <div v-if="r.selected" class="flex items-center gap-2">
              <UButton
                size="sm"
                :color="r.all ? 'primary' : 'neutral'"
                :variant="r.all ? 'solid' : 'outline'"
                @click="r.all = true"
              >
                Tout
              </UButton>
              <UInputNumber
                :model-value="r.all ? null : r.quantity"
                :min="0"
                :max="r.line.lot.remaining"
                :step="1"
                :step-snapping="false"
                placeholder="Quantité"
                size="sm"
                class="flex-1"
                @update:model-value="(v: number | null) => { r.quantity = v; r.all = false }"
                @focus="r.all = false"
              />
              <span class="text-sm text-muted w-16 truncate">{{ r.line.lot.product.unit }}</span>
            </div>
          </div>
          <p v-if="!rows.length" class="text-sm text-muted">
            Aucun aliment correspondant en stock.
          </p>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <UFormField label="Date">
            <UInput v-model="occurredOn" type="date" class="w-full" />
          </UFormField>
          <UFormField label="Note">
            <UInput v-model="note" placeholder="Optionnel" class="w-full" />
          </UFormField>
        </div>
      </form>
    </template>
    <template #footer>
      <div class="flex gap-2 w-full">
        <UButton color="neutral" variant="ghost" class="flex-1 justify-center" @click="open = false">
          Annuler
        </UButton>
        <UButton type="submit" form="take-stock" class="flex-1 justify-center" icon="i-lucide-check" :loading="saving" :disabled="!selectedRows.length">
          Valider
        </UButton>
      </div>
    </template>
  </UModal>
</template>
