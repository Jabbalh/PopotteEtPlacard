-- =====================================================================
--  Produits à commander
--  reorder    : le produit est à recommander quand il est épuisé (ou sous
--               son seuil d'alerte) ; il apparaît alors dans « À commander ».
--  ordered_at : date à laquelle il a été marqué « commandé ». Il ne l'est
--               plus dès qu'un lot est ajouté après cette date.
--
--  À exécuter AVANT de déployer la version de l'application qui l'utilise :
--  la synchronisation envoie ces colonnes.
-- =====================================================================

alter table public.pp_products
  add column reorder boolean not null default false,
  add column ordered_at timestamptz;
