-- =====================================================================
--  Conservation au congélateur
--  pp_locations.freezer         : le rangement est un congélateur.
--  pp_food_types.freezer_months : durée de conservation au congélateur (mois)
--                                 de ce type d'aliment ; null = non renseignée.
--  Un lot rangé dans un congélateur reçoit une date limite
--  = date de congélation (achat, ou jour du transfert) + freezer_months.
--
--  Les valeurs initiales reprennent celles de l'application
--  (utils/format.ts > DEFAULT_LOCATIONS, FREEZER_MONTHS).
--
--  À exécuter AVANT de déployer la version de l'application qui l'utilise :
--  la synchronisation envoie ces colonnes.
-- =====================================================================

alter table public.pp_locations
  add column freezer boolean not null default false;

alter table public.pp_food_types
  add column freezer_months smallint check (freezer_months is null or freezer_months between 1 and 60);

update public.pp_locations
set freezer = true
where icon = 'i-lucide-snowflake' or label ilike 'cong_lateur%';

update public.pp_food_types t
set freezer_months = d.months
from (values
  ('Fruits et légumes', 8),
  ('Viande', 6),
  ('Poisson', 4),
  ('Produits laitiers', 3),
  ('Féculents', 3),
  ('Épicerie sucrée', 3),
  ('Plats préparés', 3)
) as d(label, months)
where t.label = d.label and t.freezer_months is null;
