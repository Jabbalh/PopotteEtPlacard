<script setup lang="ts">
/**
 * Lecture d'un code-barres avec la caméra arrière.
 * Utilise l'API native BarcodeDetector (Chrome Android) ou, à défaut (iOS, Firefox),
 * le décodeur ZXing en WebAssembly, embarqué dans l'app pour fonctionner hors ligne.
 */
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'

const emit = defineEmits<{ detected: [code: string], cancel: [] }>()

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e']

interface Detector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>
}

const video = ref<HTMLVideoElement | null>(null)
const error = ref<string | null>(null)
const starting = ref(true)
const manualCode = ref('')
let stream: MediaStream | null = null
let timer: ReturnType<typeof setTimeout> | null = null
let stopped = false

async function createDetector(): Promise<Detector> {
  const Native = (globalThis as { BarcodeDetector?: { new (o: { formats: string[] }): Detector, getSupportedFormats(): Promise<string[]> } }).BarcodeDetector
  if (Native) {
    const supported = await Native.getSupportedFormats()
    if (FORMATS.some(f => supported.includes(f))) return new Native({ formats: FORMATS.filter(f => supported.includes(f)) })
  }
  const { BarcodeDetector, prepareZXingModule } = await import('barcode-detector/ponyfill')
  prepareZXingModule({
    overrides: {
      locateFile: (path: string, prefix: string) => path.endsWith('.wasm') ? wasmUrl : prefix + path
    }
  })
  return new BarcodeDetector({ formats: FORMATS as never }) as unknown as Detector
}

async function start() {
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Caméra non disponible sur cet appareil')
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    })
    if (stopped) return stop()
    video.value!.srcObject = stream
    await video.value!.play()
    const detector = await createDetector()
    starting.value = false

    const loop = async () => {
      if (stopped || !video.value) return
      try {
        if (video.value.readyState >= 2) {
          const codes = await detector.detect(video.value)
          const code = codes.find(c => /^\d{8,14}$/.test(c.rawValue))?.rawValue
          if (code) {
            navigator.vibrate?.(80)
            stop()
            emit('detected', code)
            return
          }
        }
      } catch { /* image non exploitable : on réessaie */ }
      timer = setTimeout(loop, 200)
    }
    loop()
  } catch (e) {
    starting.value = false
    const name = (e as { name?: string }).name
    error.value = name === 'NotAllowedError'
      ? 'Accès à la caméra refusé. Autorisez-le dans les réglages du navigateur, ou saisissez le code ci-dessous.'
      : e instanceof Error ? e.message : String(e)
  }
}

function stop() {
  stopped = true
  if (timer) clearTimeout(timer)
  stream?.getTracks().forEach(t => t.stop())
  stream = null
}

function submitManual() {
  const code = manualCode.value.replace(/\D/g, '')
  if (code.length < 8) return
  stop()
  emit('detected', code)
}

onMounted(start)
onBeforeUnmount(stop)
</script>

<template>
  <div class="space-y-3">
    <div class="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-black">
      <video ref="video" class="size-full object-cover" playsinline muted />
      <div v-if="!error" class="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div class="relative w-4/5 h-1/3 rounded-lg border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]">
          <div class="absolute inset-x-2 top-1/2 h-0.5 -translate-y-1/2 bg-red-500/80 animate-pulse" />
        </div>
      </div>
      <div v-if="starting" class="absolute inset-0 flex items-center justify-center text-white">
        <UIcon name="i-lucide-loader-circle" class="size-8 animate-spin" />
      </div>
      <div v-if="error" class="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-white">
        <UIcon name="i-lucide-camera-off" class="size-8" />
        <p class="text-sm">
          {{ error }}
        </p>
      </div>
    </div>
    <p v-if="!error" class="text-xs text-muted text-center">
      Placez le code-barres dans le cadre
    </p>
    <form class="flex gap-2" @submit.prevent="submitManual">
      <UInput v-model="manualCode" inputmode="numeric" placeholder="Ou saisir le code-barres" class="flex-1" />
      <UButton type="submit" color="neutral" variant="soft" :disabled="manualCode.replace(/\D/g, '').length < 8">
        OK
      </UButton>
    </form>
    <UButton block color="neutral" variant="ghost" @click="stop(); emit('cancel')">
      Annuler le scan
    </UButton>
  </div>
</template>
