<script setup lang="ts">
/** Note de 0 à 5 étoiles ; toucher l'étoile courante remet à 0 (non favori) */
const model = defineModel<number>({ default: 0 })
const props = withDefaults(defineProps<{ readonly?: boolean, size?: 'sm' | 'md' | 'lg' }>(), { size: 'md' })

const sizeClass = computed(() => ({ sm: 'size-3.5', md: 'size-6', lg: 'size-8' })[props.size])

function set(n: number) {
  if (props.readonly) return
  model.value = model.value === n ? 0 : n
}
</script>

<template>
  <div class="inline-flex items-center" :class="readonly ? 'gap-0' : 'gap-1'" :role="readonly ? 'img' : 'radiogroup'" :aria-label="`${model} étoile(s) sur 5`">
    <component
      :is="readonly ? 'span' : 'button'"
      v-for="n in 5"
      :key="n"
      :type="readonly ? undefined : 'button'"
      :aria-label="readonly ? undefined : `${n} étoile${n > 1 ? 's' : ''}`"
      class="leading-none"
      :class="readonly ? '' : 'p-0.5 active:scale-90 transition'"
      @click="set(n)"
    >
      <svg
        viewBox="0 0 24 24"
        :class="[sizeClass, n <= model ? 'text-amber-400' : 'text-dimmed']"
        :fill="n <= model ? 'currentColor' : 'none'"
        stroke="currentColor"
        stroke-width="2"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M12 2.5l2.94 5.96 6.56.95-4.75 4.63 1.12 6.54L12 17.5l-5.87 3.08 1.12-6.54L2.5 9.41l6.56-.95z" />
      </svg>
    </component>
  </div>
</template>
