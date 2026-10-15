# Documentation technique

## Sommaire

1. [Stack](#1-stack)
2. [Architecture](#2-architecture)
3. [Arborescence](#3-arborescence)
4. [Authentification](#4-authentification)
5. [Données locales (Dexie)](#5-données-locales-dexie)
6. [Synchronisation](#6-synchronisation)
7. [Logique métier côté client](#7-logique-métier-côté-client)
8. [Scan de codes-barres et Open Food Facts](#8-scan-de-codes-barres-et-open-food-facts)
9. [PWA et hors connexion](#9-pwa-et-hors-connexion)
10. [Build et déploiement](#10-build-et-déploiement)
11. [Affichage adaptatif](#11-affichage-adaptatif)
12. [Conventions](#12-conventions)
13. [Points d'attention](#13-points-dattention)

---

## 1. Stack

| Domaine | Choix |
|---|---|
| Framework | Nuxt 4, **SPA** (`ssr: false`), généré en statique (`nuxt generate`, preset Nitro `static`) |
| UI | Nuxt UI 4 (couleurs `emerald` / `stone`), Tailwind CSS 4, icônes Lucide embarquées |
| Backend | Supabase : Auth (email + mot de passe, PKCE) et Postgres avec RLS, accès direct par `@supabase/supabase-js` (pas d'API intermédiaire) |
| Stockage local | IndexedDB via Dexie 4 |
| PWA | `@vite-pwa/nuxt` (Workbox), mise à jour sur demande |
| Codes-barres | `BarcodeDetector` natif, sinon `barcode-detector` (ponyfill) + `zxing-wasm` |
| Produits | API publique Open Food Facts v2 |
| Hébergement | Vercel (site statique) |

Le socle (auth, synchro, PWA, invitations admin) reprend celui de **Pas ce soir** ; la base Supabase est partagée (voir [base-de-donnees.md](base-de-donnees.md)).

## 2. Architecture

```
┌──────────────────────────── Navigateur (PWA) ────────────────────────────┐
│  Pages / composants Vue                                                   │
│        │ lectures réactives (liveQuery)      │ écritures                 │
│        ▼                                     ▼                            │
│  useStock / useHousehold / useSuggestions  useHouseholdActions            │
│        │                                     │ _dirty = 1                 │
│        └──────────────► IndexedDB (Dexie) ◄──┘                            │
│                              ▲   │                                        │
│                       pull   │   │ push (upsert)                          │
│                         useSync (30 s, retour réseau, premier plan…)      │
└──────────────────────────────┼───┼────────────────────────────────────────┘
                               │   ▼
                     Supabase PostgREST + RLS ──► Postgres (tables pp_*)
                     Supabase Auth
                     RPC : pp_invite_preview, pp_accept_invite, pp_leave_household

            Open Food Facts (fetch direct, CORS) ◄── popin d'ajout
```

Principe **local-first** : l'interface ne lit et n'écrit **que** dans IndexedDB. La synchronisation est un processus en arrière-plan. Seules quelques actions passent directement par Supabase et exigent le réseau : invitations (au foyer et admin), retrait d'accès, départ d'un foyer, profil, inscription.

## 3. Arborescence

```
app/
├── app.vue, app.config.ts          démarrage de la synchro à la connexion, thème
├── assets/css/main.css
├── plugins/supabase.client.ts      client Supabase (session persistée, PKCE)
├── middleware/auth.global.ts       routes publiques, redirections, garde /admin
├── layouts/
│   ├── default.vue                 en-tête, menu utilisateur, navigation du foyer (barre du bas / barre latérale PC)
│   └── auth.vue                    écrans de connexion / inscription
├── composables/
│   ├── useAuth.ts                  session, cache hors ligne, rôle admin
│   ├── useDb.ts                    base de l'utilisateur, useLiveQuery
│   ├── useSync.ts                  synchronisation IndexedDB <-> Supabase
│   ├── useHousehold.ts             actions d'écriture + foyer, personnes, rangements, types
│   ├── useStock.ts                 lots, restants, stock par produit, à commander, goûts par personne
│   ├── useSuggestions.ts           idées de recettes et d'aliments
│   └── useCatalog.ts               aliments proposés à la saisie des préférences, recherche par code-barres
├── utils/
│   ├── db.ts                       types des tables et schéma Dexie
│   ├── format.ts                   dates, quantités, libellés, valeurs par défaut
│   ├── matching.ts                 rapprochement approximatif de libellés
│   ├── openFoodFacts.ts            recherche produit par code-barres
│   ├── errors.ts                   traduction des messages d'erreur
│   └── token.ts                    jetons aléatoires, partage natif / copie
├── components/
│   ├── AddStockModal.vue           popin d'ajout (scan, produit, lot)
│   ├── TakeStockModal.vue          popin de sortie de stock (1 ou n lots)
│   ├── BarcodeScanner.vue          caméra + décodage
│   ├── TastesEditor.vue            préférences + liste de recettes
│   ├── RecipeModal.vue             édition d'une recette
│   ├── OptionsEditor.vue           rangements / types d'aliments
│   ├── StarRating.vue, NutriscoreBadge.vue
│   ├── SyncStatus.vue              état de la synchro (en-tête)
│   └── PwaPrompts.vue              mise à jour, installation
└── pages/                          voir docs/fonctionnel.md § 16
supabase/migrations/                migration SQL de l'application
public/                             icônes PWA (générées depuis icon.svg)
```

Les composables et utilitaires sont **auto-importés** par Nuxt.

## 4. Authentification

- `useAuth()` expose `user`, `isAdmin`, `signIn`, `signUp`, `signOut`, `resetPassword`, `updatePassword`.
- L'utilisateur est mis en cache dans `localStorage` (`pep:user`) : hors connexion, l'app reste utilisable même si le jeton ne peut pas être rafraîchi.
- Le rôle admin est lu dans `app_admins` et mis en cache (`pep:admin`). Il ne sert qu'à l'affichage : les droits sont vérifiés par RLS.
- `signUp` transmet le jeton d'invitation admin dans `options.data.app_invite`. Le contrôle est fait par les triggers `guard_signup` / `handle_new_user` (hérités de Pas ce soir) sur `auth.users`.
- Le middleware global redirige vers `/connexion?redirect=…` les routes non publiques ; `/connexion`, `/nouveau-mot-de-passe` et `/inscription/*` sont publiques.

## 5. Données locales (Dexie)

Une base IndexedDB **par utilisateur** : `popotte-<userId>` (`openDb(userId)`), pour ne jamais mélanger les données de deux comptes sur un même appareil.

| Table Dexie | Table Supabase | Index |
|---|---|---|
| `households` | `pp_households` | `id, _dirty` |
| `people` | `pp_people` | `id, household_id, user_id, _dirty` |
| `locations` | `pp_locations` | `id, household_id, _dirty` |
| `foodTypes` | `pp_food_types` | `id, household_id, _dirty` |
| `products` | `pp_products` | `id, household_id, [household_id+barcode], _dirty` |
| `stockItems` | `pp_stock_items` | `id, household_id, product_id, _dirty` |
| `movements` | `pp_stock_movements` | `id, household_id, stock_item_id, _dirty` |
| `preferences` | `pp_preferences` | `id, user_id, household_id, person_id, _dirty` |
| `recipes` | `pp_recipes` | `id, user_id, household_id, person_id, _dirty` |
| `profiles` | `profiles` (lecture seule) | `id` |
| `meta` | — | `key` (curseurs de synchro) |

Champs techniques de chaque ligne synchronisée :
- `_dirty` : `1` = modification locale non envoyée ;
- `_lmod` : horodatage local de la dernière modification, pour ne pas marquer « propre » une ligne modifiée pendant son envoi.

**Lecture réactive** : `useLiveQuery(query, initial, deps)` enveloppe `liveQuery` de Dexie. Le résultat se met à jour à chaque écriture locale, y compris celles de la synchro. Les lignes supprimées (`deleted_at`) restent en local et sont filtrées par les requêtes.

Pour faire évoluer le schéma local : ajouter un `db.version(n).stores({...})` dans `utils/db.ts` (avec `.upgrade()` si besoin), sans modifier les versions existantes.

| Version | Changement |
|---|---|
| 1 | Schéma initial |
| 2 | `products.reorder = false`, `products.ordered_at = null` sur les lignes existantes (la synchro envoie `null` pour un champ absent, refusé par `reorder not null`) |

## 6. Synchronisation

`useSync()` (état partagé au niveau module : `online`, `syncing`, `pendingCount`, `lastSyncAt`, `lastError`).

### Déclencheurs

- démarrage (connexion), retour du réseau, retour de l'app au premier plan, toutes les 30 s (si visible) ;
- `schedule(delay)` après chaque écriture locale (800 ms par défaut, 0 pour un foyer, 7 s pour une sortie de stock afin de laisser le temps d'annuler) ;
- les appels concurrents sont fusionnés (une seule synchro à la fois, relancée si demandée entre-temps).

### Envoi (push)

1. `households` : upsert unitaire. `deleted_at` n'est envoyé que si l'utilisateur est propriétaire (sinon refus serveur).
2. Puis, dans l'ordre des clés étrangères : `people`, `locations`, `foodTypes`, `products`, `stockItems`, `movements`, `preferences`, `recipes`, par lots de 100, en **upsert** des colonnes déclarées dans `TABLES[...].fields`.
3. Lot refusé pour droits (`42501`, `PGRST301`) : renvoi ligne par ligne pour isoler la ligne fautive, qui est journalisée puis marquée propre (ex. foyer quitté entre-temps). Toute autre erreur interrompt la synchro (`lastError`).

**Cas particulier `people`** : `user_id`, `role` et `invite_token` ne sont **jamais** envoyés, sauf `user_id` + `role` pour la personne du créateur d'un foyer (création hors ligne). Le lien personne ↔ compte est protégé côté serveur (voir [base-de-donnees.md § Règles](base-de-donnees.md#5-règles-métier-triggers)).

### Réception (pull)

1. `pp_households` complet (filtré par RLS). Foyer supprimé ou absent (plus membre) et non modifié localement → **purge** locale du foyer et de toutes ses lignes et curseurs.
2. Pour chaque foyer actif et chaque table rattachée au foyer : lignes `household_id = X` et `updated_at > curseur − 60 s`, paginées par 500, triées par `updated_at, id`. Curseur `meta['<table>:<householdId>']`.
3. Goûts de niveau compte : pour l'utilisateur et chaque compte lié à une personne de ses foyers, `preferences` et `recipes` avec `user_id = U`, curseur `meta['<table>:u:<userId>']`. Les lignes et curseurs des comptes qui ne sont plus visibles sont supprimés.
4. Noms affichés (`profiles`) des comptes visibles.

Une ligne reçue n'écrase **jamais** une ligne locale `_dirty`. Le recouvrement de 60 s évite de rater une ligne validée en retard.

### Résolution des conflits

| Situation | Résultat |
|---|---|
| Deux modifications de la même ligne | La dernière **envoyée** l'emporte |
| Modification locale non envoyée + changement distant | La modification locale est conservée puis envoyée |
| Consommations concurrentes d'un même lot | Sans conflit : chaque sortie est une ligne distincte |
| Suppression | Soft delete (`deleted_at`) propagé comme une modification |

## 7. Logique métier côté client

### Stock (`useStock`)

- `restant(lot) = quantity − Σ movements.quantity` (sorties non supprimées), arrondi au millième.
- `lots` : lots dont le restant est > 0, triés par `expires_on` croissant (sans date en dernier).
- `byProduct` : tous les produits non supprimés avec total, lots et péremption la plus proche (sert aux ruptures).
- Un ajustement d'inventaire crée un mouvement `adjusted` de quantité `restant actuel − restant voulu` (négatif = ajout).
- `toOrder` : produits `reorder` dont le total est ≤ `low_threshold`, rupture d'abord puis non commandés. `isOrdered(p)` : `ordered_at` renseigné et postérieur au `created_at` du dernier lot du produit (lots épuisés compris) ; ajouter un lot suffit donc à lever le statut, sans écriture supplémentaire.

### Goûts (`useHouseholdTastes`)

Pour chaque personne non supprimée du foyer : goûts de son compte (`user_id = person.user_id`, `fromAccount: true`) + goûts propres (`person_id = person.id`).

### Rapprochement (`utils/matching.ts`)

`tokens(texte)` : minuscules, sans accents, `œ → oe`, « pomme(s) de terre » fusionné, découpage sur les non-alphanumériques, suppression des mots vides et des nombres, singulier naïf (`s` / `x` final si > 3 lettres).

`matchScore(libellé, produit)` :
- `2` : tous les mots du libellé sont dans le produit et le premier mot correspond ;
- `1` : tous les mots du libellé sont dans le produit, ou tous ceux du produit dans le libellé ;
- `0` : aucune correspondance.

### Idées (`useSuggestions`)

- Recettes = union des recettes des personnes, dédoublonnées par id (`favoredBy` = personnes qui l'ont).
- Pour chaque aliment : lots correspondants triés par score puis péremption.
- `coverage = aliments trouvés / aliments`, `urgency = Σ urgencyOf(lot le plus pertinent)`, `conflicts` = préférences *dislike* / *allergy* d'une personne correspondant à un aliment.
- Avis d'une personne sur un aliment : `useOpinions(householdId).opinionsOn(nom, codesBarres)` — préférence de même code-barres que le produit (`byBarcode`), sinon `matches(libellé, nom)` ; `fromAccount` indique un goût de compte. Utilisé par les idées (pour un ingrédient de recette, les codes-barres sont ceux des produits trouvés en stock), la fiche produit et la liste du stock (une préférence par personne, la plus forte).

### Catalogue et code-barres (`useCatalog`)

- `useFoodCatalog(householdId?)` : produits non supprimés du foyer (ou de tous les foyers), dédoublonnés par code-barres ou nom, avec un indicateur « en stock » ; en stock d'abord.
- `useBarcodeLookup().lookup(code)` : produit déjà connu localement (tous foyers), sinon Open Food Facts.
- Tris : voir [fonctionnel.md § 10](fonctionnel.md#10-idées-recherches).

### Écritures (`useHouseholdActions`)

Toutes les écritures créent l'UUID côté client, posent `_dirty = 1` et `_lmod`, puis appellent `schedule()`. Les suppressions sont des mises à jour de `deleted_at`, ce qui rend l'annulation triviale (`deleted_at = null`).

## 8. Scan de codes-barres et Open Food Facts

### `BarcodeScanner.vue`

1. `getUserMedia` caméra arrière (1280×720 idéal).
2. Détecteur :
   - `BarcodeDetector` natif s'il gère un format EAN/UPC (Chrome Android) ;
   - sinon import dynamique de `barcode-detector/ponyfill` avec `prepareZXingModule` pointant vers `zxing_reader.wasm` **embarqué** (`?url`) au lieu du CDN par défaut, pour fonctionner hors connexion (iOS, Firefox).
3. Boucle de détection toutes les 200 ms ; code retenu s'il fait 8 à 14 chiffres ; arrêt de la caméra à la détection ou au démontage.
4. Saisie manuelle possible.

### `fetchOffProduct(code)`

`GET https://world.openfoodfacts.org/api/v2/product/<code>.json?fields=…`

| Champ OFF | Champ produit |
|---|---|
| `product_name_fr` › `product_name` › `generic_name` | `name` |
| `brands` (1ʳᵉ) | `brand` |
| `generic_name_fr` + `quantity` | `description` |
| `ingredients_text_fr` › `ingredients_text` | `ingredients` |
| `nutriscore_grade` (a à e uniquement) | `nutriscore` |
| `image_front_small_url` | `image_url` |

Renvoie `null` si inconnu (404 ou `status ≠ 1`), lève une erreur si le service est injoignable.

## 9. PWA et hors connexion

- `registerType: 'prompt'` : `PwaPrompts.vue` affiche « Nouvelle version disponible » ; recherche de mise à jour toutes les heures.
- Précache Workbox : `js, css, html, png, svg, ico, woff2, wasm` (limite 4 Mo par fichier, pour le décodeur ≈ 1 Mo).
- `navigateFallback: '/'` : toutes les routes fonctionnent hors connexion (SPA).
- Cache `CacheFirst` des photos `images.openfoodfacts.org` (500 entrées, 180 jours).
- Les appels Supabase ne sont jamais mis en cache par le service worker : c'est IndexedDB qui assure le hors connexion.
- Icônes : `clientBundle` de `@nuxt/icon` avec `provider: 'none'`. Les icônes référencées uniquement depuis `app/utils` (niveaux de préférence, rangements…) sont déclarées à la main dans `nuxt.config.ts > icon.clientBundle.icons`. **Toute nouvelle icône utilisée hors d'un composant doit y être ajoutée.**

## 10. Build et déploiement

```bash
npm install
cp .env.example .env     # NUXT_PUBLIC_SUPABASE_URL, NUXT_PUBLIC_SUPABASE_KEY
npm run dev              # http://localhost:3000
npm run typecheck
npm run generate         # .output/public
npm run preview
npm run icons            # régénère les icônes depuis public/icon.svg
```

- `vercel.json` : `npm ci`, `npm run generate`, sortie `.output/public`, réécriture de toutes les routes vers `index.html`, `sw.js` jamais mis en cache, `/_nuxt/*` immuable.
- Variables Vercel : `NUXT_PUBLIC_SUPABASE_URL`, `NUXT_PUBLIC_SUPABASE_KEY` (clé `anon`, publique par nature : la sécurité repose sur la RLS).
- Supabase : ajouter `https://popotte-et-placard.vercel.app/**` dans *Authentication → Redirect URLs* (liens de confirmation et de réinitialisation).

## 11. Affichage adaptatif

Mobile d'abord : les classes sans préfixe décrivent le mobile, qui ne doit pas changer ; tablette et PC sont ajoutés par les préfixes Tailwind `md:` (≥ 768 px) et `lg:` (≥ 1024 px).

| Élément | Mise en œuvre |
|---|---|
| Layout (`layouts/default.vue`) | Contenu `max-w-2xl` → `md:max-w-4xl` → `lg:max-w-7xl` (en-tête et page). Sur PC, `<aside>` collant (`lg:sticky`, `w-60`) avec le nom du foyer (lecture Dexie) ; la barre du bas est `lg:hidden`. |
| Listes | `grid grid-cols-1 gap-N md:grid-cols-2` |
| Écrans de détail | `lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]` (fiche produit, administration) ; sur la fiche produit, colonne gauche `lg:sticky` |
| Boutons d'ajout du stock | Boutons flottants `lg:hidden`, doublés dans l'en-tête par un bloc `hidden lg:flex` |
| Bandeau PWA | `bottom-24 lg:bottom-6` (pas de barre du bas sur PC) |

Deux règles à respecter :

- **Toujours `grid-cols-1` sur une grille** : sans nombre de colonnes explicite, les éléments d'une grille CSS ne rétrécissent pas sous la largeur de leur texte (`min-width: auto`) et la page déborde horizontalement sur mobile. `grid-cols-N` de Tailwind vaut `repeat(N, minmax(0, 1fr))`.
- **Garder l'ordre mobile** quand une page passe en deux colonnes (bilan, réglages) : conteneur `flex flex-col gap-5 lg:grid lg:grid-cols-2`, colonne de gauche `contents lg:flex lg:flex-col` (ses enfants participent au flux mobile), et classes `order-1`, `order-2`… sur les cartes pour fixer l'ordre mobile.

Contrôle : afficher l'app dans des iframes de 390 px et 820 px (les media queries s'appliquent à la largeur de l'iframe) et vérifier `scrollWidth === clientWidth` sur chaque écran.

## 12. Conventions

- Interface, commentaires et messages en **français**.
- Clés `localStorage` préfixées `pep:` ; état global de session via `useState('pep:…')`.
- Tables serveur préfixées `pp_`, fonctions `pp_*`.
- Dates métier en `AAAA-MM-JJ` (type `date`), horodatages techniques en ISO (`timestamptz`).
- Quantités en `numeric`, dans l'**unité du produit** (une seule unité par produit).
- Erreurs Supabase traduites par `errorMessage()` (`utils/errors.ts`).

## 13. Points d'attention

- **Fonctions partagées avec Pas ce soir** : `guard_signup` et `handle_new_user` (triggers sur `auth.users`) appartiennent à Pas ce soir. Une future migration de l'une des deux applications qui les redéfinit doit préserver le fonctionnement des invitations admin.
- **Invitation au foyer** : elle ne permet pas de créer un compte (choix délibéré : seul un admin invite à s'inscrire).
- **Foyer sans propriétaire** : si le compte du créateur est supprimé, le foyer est conservé mais plus personne ne peut le supprimer ni gérer les invitations (correction manuelle en base si besoin).
- **Unité unique par produit** : l'unité d'un produit n'est plus modifiable depuis la popin une fois le produit créé (modifiable depuis la fiche produit, sans conversion des lots existants).
- **Rapprochement approximatif** : basé sur les mots, sans synonymes (« gruyère » ≠ « emmental »). Nommer les aliments des recettes comme les produits améliore les propositions.
- **Volume** : tout le stock d'un foyer est chargé en mémoire pour les calculs ; prévu pour quelques milliers de lignes par foyer.
