-- =====================================================================
--  Prix d'achat des lots (facultatif)
--  Prix total payé pour le lot (TTC, en euros), saisi à l'ajout ou lu sur le
--  ticket de caisse. Avec la date d'achat, il forme l'historique des prix
--  d'un produit.
--
--  À exécuter AVANT de déployer la version de l'application qui l'utilise :
--  la synchronisation envoie cette colonne.
-- =====================================================================

alter table public.pp_stock_items
  add column price numeric check (price is null or price >= 0);
