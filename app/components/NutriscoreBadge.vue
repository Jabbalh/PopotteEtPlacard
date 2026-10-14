<script setup lang="ts">
import type { Nutriscore } from '~/utils/db'

const props = defineProps<{ value: Nutriscore | null, size?: 'sm' | 'md' }>()
const info = computed(() => NUTRISCORES.find(n => n.value === props.value))
</script>

<template>
  <span
    v-if="info"
    class="inline-flex items-center justify-center rounded font-extrabold uppercase shrink-0"
    :class="[info.color, size === 'sm' ? 'size-5 text-xs' : 'size-7 text-sm']"
    :title="`Nutri-Score ${value!.toUpperCase()}`"
  >{{ value }}</span>
</template>
