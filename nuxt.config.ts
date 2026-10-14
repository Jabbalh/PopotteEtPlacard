// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',
  devtools: { enabled: true },

  // SPA : indispensable pour un fonctionnement hors connexion complet (PWA)
  ssr: false,

  modules: ['@nuxt/ui', '@vite-pwa/nuxt'],

  css: ['~/assets/css/main.css'],

  // Site 100 % statique dans .output/public (sinon Nitro choisit le preset vercel-static sur Vercel)
  nitro: {
    preset: 'static'
  },

  app: {
    head: {
      htmlAttrs: { lang: 'fr' },
      title: 'Popotte & Placard',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'description', content: 'Le stock alimentaire du foyer, les goûts de chacun et des idées de recettes' },
        { name: 'theme-color', content: '#065f46' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' }
      ],
      link: [
        { rel: 'icon', href: '/favicon.ico', sizes: '48x48' },
        { rel: 'icon', href: '/icon.svg', type: 'image/svg+xml' },
        { rel: 'apple-touch-icon', href: '/apple-touch-icon-180x180.png' }
      ]
    }
  },

  // Icônes embarquées dans le bundle : indispensable hors connexion
  icon: {
    // le scan ne couvre que les composants : icônes déclarées dans app/utils ajoutées à la main
    clientBundle: {
      scan: true,
      icons: [
        'lucide:utensils', 'lucide:trash-2', 'lucide:gift', 'lucide:heart', 'lucide:thumbs-up',
        'lucide:thumbs-down', 'lucide:ban', 'lucide:refrigerator', 'lucide:snowflake', 'lucide:package',
        'lucide:archive', 'lucide:wine', 'lucide:cookie', 'lucide:warehouse', 'lucide:box'
      ],
      sizeLimitKb: 512
    },
    provider: 'none'
  },

  colorMode: {
    preference: 'system'
  },

  runtimeConfig: {
    public: {
      supabaseUrl: process.env.NUXT_PUBLIC_SUPABASE_URL || '',
      supabaseKey: process.env.NUXT_PUBLIC_SUPABASE_KEY || ''
    }
  },

  pwa: {
    // Nouvelle version : on demande à l'utilisateur avant de recharger (évite de perdre une saisie)
    registerType: 'prompt',
    manifest: {
      name: 'Popotte & Placard — Stock et recettes du foyer',
      short_name: 'Popotte',
      description: 'Le stock alimentaire du foyer, les goûts de chacun et des idées de recettes',
      lang: 'fr',
      theme_color: '#065f46',
      background_color: '#fafaf9',
      display: 'standalone',
      orientation: 'portrait',
      start_url: '/',
      icons: [
        { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
        { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
        { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
        { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
      ]
    },
    workbox: {
      navigateFallback: '/',
      // wasm : décodeur de codes-barres (iOS / Firefox), disponible hors connexion
      globPatterns: ['**/*.{js,css,html,png,svg,ico,woff2,wasm}'],
      maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      // Les appels Supabase ne sont jamais mis en cache par le SW : la synchro est gérée par l'app (IndexedDB)
      navigateFallbackDenylist: [/^\/api\//],
      // Photos des produits (Open Food Facts) : consultables hors connexion une fois vues
      runtimeCaching: [{
        urlPattern: /^https:\/\/images\.openfoodfacts\.org\/.*/,
        handler: 'CacheFirst',
        options: {
          cacheName: 'off-images',
          expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 180 },
          cacheableResponse: { statuses: [0, 200] }
        }
      }]
    },
    client: {
      // bandeau d'installation maison à la place de la mini-barre native
      installPrompt: true,
      // une PWA reste ouverte longtemps : recherche de mise à jour toutes les heures
      periodicSyncForUpdates: 3600
    },
    devOptions: {
      enabled: false,
      type: 'module'
    }
  }
})
