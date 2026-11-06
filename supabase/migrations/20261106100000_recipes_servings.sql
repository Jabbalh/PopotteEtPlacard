-- =====================================================================
--  Nombre de personnes des recettes
--  - pp_recipes.servings : nombre de personnes pour lequel les quantités
--    des aliments sont saisies (null = non précisé).
--
--  À exécuter AVANT de déployer la version de l'application qui l'utilise :
--  la synchronisation envoie la colonne servings.
-- =====================================================================

alter table public.pp_recipes
  add column servings smallint check (servings is null or servings between 1 and 99);
