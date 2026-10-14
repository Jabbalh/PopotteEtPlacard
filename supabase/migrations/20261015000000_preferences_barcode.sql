-- =====================================================================
--  Préférences d'aliments : code-barres facultatif
--  Une préférence saisie par scan correspond exactement au produit de même
--  code-barres dans le stock, même si les noms diffèrent. Sans code-barres,
--  le rapprochement se fait par le nom (comme avant).
--
--  À exécuter AVANT de déployer la version de l'application qui l'utilise :
--  la synchronisation envoie cette colonne.
-- =====================================================================

alter table public.pp_preferences
  add column barcode text check (barcode is null or barcode ~ '^[0-9]{8,14}$');
