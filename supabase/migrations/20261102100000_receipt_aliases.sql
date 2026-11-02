-- =====================================================================
--  Tickets de caisse : libellés mémorisés
--  Un ticket ne porte pas de code-barres, seulement des libellés abrégés
--  (« LAIT 1/2 ECR UHT 1L »). Quand un membre du foyer associe un libellé à un
--  produit, l'association est mémorisée pour reconnaître les tickets suivants.
--  product_id null = libellé à ignorer (sac, consigne, article non alimentaire).
--
--  À exécuter AVANT de déployer la version de l'application qui l'utilise :
--  la synchronisation lit et écrit cette table.
-- =====================================================================

create table public.pp_receipt_aliases (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.pp_households (id) on delete cascade,
  -- libellé normalisé (minuscules, sans accents, espaces simples)
  label         text not null check (length(trim(label)) > 0),
  product_id    uuid references public.pp_products (id) on delete cascade,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create index pp_receipt_aliases_household_updated_idx on public.pp_receipt_aliases (household_id, updated_at);

create trigger pp_receipt_aliases_touch before insert or update on public.pp_receipt_aliases
  for each row execute function public.pp_touch();

alter table public.pp_receipt_aliases enable row level security;

create policy "pp lecture par les membres" on public.pp_receipt_aliases
  for select to authenticated using (public.pp_is_member(household_id));
create policy "pp création par les membres" on public.pp_receipt_aliases
  for insert to authenticated with check (public.pp_is_member(household_id));
create policy "pp modification par les membres" on public.pp_receipt_aliases
  for update to authenticated
  using (public.pp_is_member(household_id))
  with check (public.pp_is_member(household_id));

grant select, insert, update on public.pp_receipt_aliases to authenticated;
revoke all on public.pp_receipt_aliases from anon;
