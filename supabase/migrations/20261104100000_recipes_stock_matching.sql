-- =====================================================================
--  Recettes ↔ stock : rapprochement plus fin et liste de courses
--  - pp_products.generic_name : aliment générique du produit (« pâtes » pour
--    « Panzani Coquillettes »), utilisé en plus du nom pour reconnaître les
--    aliments des recettes. Prérempli depuis les catégories Open Food Facts.
--  - pp_pantry_staples : basiques du placard (sel, poivre, huile…), toujours
--    considérés comme disponibles pour les recettes.
--  - pp_shopping_items : liste de courses libre du foyer (aliments manquants
--    des recettes, ou saisis à la main). Acheté = supprimé (deleted_at).
--
--  À exécuter AVANT de déployer la version de l'application qui l'utilise :
--  la synchronisation lit et écrit ces tables et cette colonne.
-- =====================================================================

alter table public.pp_products
  add column generic_name text not null default '';

-- ---------------------------------------------------------------------
--  Basiques du placard
-- ---------------------------------------------------------------------
create table public.pp_pantry_staples (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.pp_households (id) on delete cascade,
  label         text not null check (length(trim(label)) > 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create index pp_pantry_staples_household_updated_idx on public.pp_pantry_staples (household_id, updated_at);

create trigger pp_pantry_staples_touch before insert or update on public.pp_pantry_staples
  for each row execute function public.pp_touch();

alter table public.pp_pantry_staples enable row level security;

create policy "pp lecture par les membres" on public.pp_pantry_staples
  for select to authenticated using (public.pp_is_member(household_id));
create policy "pp création par les membres" on public.pp_pantry_staples
  for insert to authenticated with check (public.pp_is_member(household_id));
create policy "pp modification par les membres" on public.pp_pantry_staples
  for update to authenticated
  using (public.pp_is_member(household_id))
  with check (public.pp_is_member(household_id));

grant select, insert, update on public.pp_pantry_staples to authenticated;
revoke all on public.pp_pantry_staples from anon;

-- ---------------------------------------------------------------------
--  Liste de courses
-- ---------------------------------------------------------------------
create table public.pp_shopping_items (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.pp_households (id) on delete cascade,
  label         text not null check (length(trim(label)) > 0),
  -- quantité et unité facultatives (reprises de l'ingrédient de la recette)
  quantity      numeric check (quantity is null or quantity >= 0),
  unit          text not null default '',
  -- recette d'origine (null = saisie à la main)
  recipe_name   text,
  created_by    uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create index pp_shopping_items_household_updated_idx on public.pp_shopping_items (household_id, updated_at);

create trigger pp_shopping_items_touch before insert or update on public.pp_shopping_items
  for each row execute function public.pp_touch_author();

alter table public.pp_shopping_items enable row level security;

create policy "pp lecture par les membres" on public.pp_shopping_items
  for select to authenticated using (public.pp_is_member(household_id));
create policy "pp création par les membres" on public.pp_shopping_items
  for insert to authenticated with check (public.pp_is_member(household_id));
create policy "pp modification par les membres" on public.pp_shopping_items
  for update to authenticated
  using (public.pp_is_member(household_id))
  with check (public.pp_is_member(household_id));

grant select, insert, update on public.pp_shopping_items to authenticated;
revoke all on public.pp_shopping_items from anon;
