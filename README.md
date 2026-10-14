# Popotte & Placard 🍲

Le stock alimentaire du foyer (frigo, congélateur, placards…), les goûts de chacun et des idées de recettes — PWA mobile, utilisable hors connexion, partagée entre les membres du foyer.

**En ligne** : https://popotte-et-placard.vercel.app (déploiement automatique à chaque push sur `main`)

**Documentation** : [fonctionnelle](docs/fonctionnel.md) · [technique](docs/technique.md) · [base de données](docs/base-de-donnees.md)

**Stack** : Nuxt 4 (SPA) · Nuxt UI 4 · Tailwind CSS 4 · Supabase (auth + Postgres) · Dexie (IndexedDB) · Vite PWA · Vercel — même socle que [Pas ce soir](../PasCeSoir).

## Fonctionnalités

- **Comptes sur invitation** : seul un administrateur crée des liens d'inscription (`/inscription/<jeton>`, page *Administration*).
- **Mes goûts et recettes** (niveau compte) : préférences d'aliments (adore, aime, n'aime pas, allergie / interdit) et recettes préférées (liste d'aliments avec quantités et/ou texte libre).
- **Foyers** : des personnes, liées ou non à un compte.
  - Personne liée à un compte : ses goûts et recettes de compte sont repris **par lien** (pas de copie) ; le foyer peut les **compléter** (le complément n'existe que dans ce foyer).
  - Personne sans compte : prénom + préférences et recettes propres au foyer.
  - **Invitation** (`/rejoindre/<jeton>`, usage unique, gérée par le propriétaire) : lie un compte existant à une personne du foyer, qui obtient l'accès.
- **Stock** : liste filtrable par rangement (Frigo, Congélateur, Autre… paramétrables par foyer), recherche, tri par péremption ou par nom.
- **Ajout d'un produit** (popin) : scan du code-barres (caméra) → recherche sur [Open Food Facts](https://world.openfoodfacts.org) (nom, description, composition, Nutri-Score, photo), ou saisie libre (seul le nom est obligatoire). Date d'achat (aujourd'hui par défaut), date de péremption, type d'aliment (paramétrable), rangement, quantité et unité, favori (1 à 5 étoiles). Un produit déjà connu du foyer est réutilisé.
- **Sortie de stock** : utilisé, jeté ou offert, quantité ou totalité, date modifiable, annulable. **Correction d'inventaire** possible à tout moment (fiche produit → *Modifier / corriger*).
- **Idées** :
  - recettes du foyer réalisables avec le stock (les plus complètes d'abord, puis les plus appréciées) ;
  - recettes « anti-gaspi » utilisant les aliments qui périment bientôt ;
  - aliments à consommer, par date de péremption croissante.
  - Sur une recette : *Je la cuisine* liste les aliments correspondants avec la quantité à retirer ; sur un aliment : seul celui-ci est proposé. Les allergies et aversions des personnes sont signalées.
- **Bilan** : état des stocks par rangement (types d'aliments, périmés, à consommer vite), favoris en rupture ou sous leur seuil d'alerte, sorties des 30 derniers jours.
- **Hors connexion** : toutes les données sont dans IndexedDB ; les modifications sont envoyées à Supabase dès que le réseau revient. Le décodeur de codes-barres (WebAssembly) est embarqué ; seule la recherche Open Food Facts nécessite le réseau.

## Base de données partagée avec « Pas ce soir »

L'application utilise **le même projet Supabase** que Pas ce soir :

- **communs** : comptes (`auth.users`), `profiles`, `app_admins`, `app_invites`, `signup_allowlist` — un compte, un administrateur ou une invitation d'inscription vaut pour les deux applications ;
- **propres à Popotte & Placard** : les tables préfixées `pp_` (`pp_households`, `pp_people`, `pp_locations`, `pp_food_types`, `pp_products`, `pp_stock_items`, `pp_stock_movements`, `pp_preferences`, `pp_recipes`) et les fonctions `pp_*` ;
- la migration ajoute une politique de lecture sur `profiles` (voir les co-membres d'un foyer) sans modifier les existantes ;
- supprimer son compte depuis Pas ce soir supprime aussi ses goûts de compte ; ses foyers sont conservés (sans propriétaire) et sa personne y reste, sans compte.

## Installation

```bash
npm install
cp .env.example .env   # mêmes valeurs que Pas ce soir
npm run dev
```

### Supabase (projet existant)

1. **SQL Editor** → exécuter, dans l'ordre, les fichiers de `supabase/migrations/` (après les migrations de Pas ce soir).
2. **Authentication → URL Configuration → Redirect URLs** : ajouter `https://popotte-et-placard.vercel.app/**` (et `http://localhost:3000/**` s'il n'y est pas déjà), pour les liens de confirmation d'email et de mot de passe oublié.

Les administrateurs sont ceux de `public.app_admins` (communs aux deux apps).

### Vercel

1. Importer le dépôt dans Vercel (le `vercel.json` configure le build statique `nuxt generate`).
2. Variables d'environnement : `NUXT_PUBLIC_SUPABASE_URL` et `NUXT_PUBLIC_SUPABASE_KEY` (mêmes valeurs que Pas ce soir).
3. Déployer.

## Synchronisation

- Chaque écriture est d'abord locale (`_dirty = 1`), puis poussée par `upsert` (identifiants UUID générés côté client).
- Le serveur horodate `updated_at` ; curseur de synchro par foyer et par table (et par compte pour les goûts de niveau compte), avec 60 s de recouvrement.
- Suppression = *soft delete* (`deleted_at`).
- Les sorties de stock sont des lignes en ajout seul : le restant d'un lot = quantité initiale − somme des sorties. Deux appareils hors ligne peuvent consommer le même lot sans conflit.
- Le lien personne ↔ compte, le rôle et les invitations ne passent jamais par la synchro : uniquement par invitation (`pp_accept_invite`), départ (`pp_leave_household`) ou action du propriétaire en ligne — contrôlé par trigger côté serveur.
- Une base IndexedDB par utilisateur (`popotte-<userId>`).

## Icônes PWA

Modifier `public/icon.svg` puis `npm run icons`.
