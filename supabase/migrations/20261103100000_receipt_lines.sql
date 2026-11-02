-- =====================================================================
--  Tickets de caisse : liste en attente partagée par le foyer
--  Les articles d'un ticket importé restent « en attente » jusqu'à leur ajout
--  au stock. Synchronisés, ils peuvent être importés par un membre du foyer et
--  complétés par un autre, sur un autre appareil.
--  Une ligne ajoutée au stock, retirée ou effacée est supprimée en douceur
--  (deleted_at), comme le reste des données.
--
--  À exécuter AVANT de déployer la version de l'application qui l'utilise :
--  la synchronisation lit et écrit cette table.
-- =====================================================================

create table public.pp_receipt_lines (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.pp_households (id) on delete cascade,
  -- ordre d'affichage (ordre du ticket)
  position      integer not null default 0,
  -- libellé lu sur le ticket
  label         text not null check (length(trim(label)) > 0),
  quantity      numeric not null default 1 check (quantity >= 0),
  -- quantité lue en kg (article pesé)
  weighed       boolean not null default false,
  -- prix total de la ligne (facultatif)
  price         numeric check (price is null or price >= 0),
  purchased_on  date not null default current_date,
  -- produit existant associé
  product_id    uuid references public.pp_products (id) on delete set null,
  -- origine de l'association : libellé mémorisé, proposition, choix de l'utilisateur
  match         text check (match in ('alias', 'guess', 'manual')),
  -- nouveau produit à créer à l'ajout au stock (nom, code-barres, unité, type…)
  new_product   jsonb,
  ignored       boolean not null default false,
  location_id   uuid references public.pp_locations (id) on delete set null,
  expires_on    date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create index pp_receipt_lines_household_updated_idx on public.pp_receipt_lines (household_id, updated_at);

create trigger pp_receipt_lines_touch before insert or update on public.pp_receipt_lines
  for each row execute function public.pp_touch();

alter table public.pp_receipt_lines enable row level security;

create policy "pp lecture par les membres" on public.pp_receipt_lines
  for select to authenticated using (public.pp_is_member(household_id));
create policy "pp création par les membres" on public.pp_receipt_lines
  for insert to authenticated with check (public.pp_is_member(household_id));
create policy "pp modification par les membres" on public.pp_receipt_lines
  for update to authenticated
  using (public.pp_is_member(household_id))
  with check (public.pp_is_member(household_id));

grant select, insert, update on public.pp_receipt_lines to authenticated;
revoke all on public.pp_receipt_lines from anon;
