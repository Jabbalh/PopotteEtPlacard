-- =====================================================================
--  Popotte & Placard — schéma initial
--
--  Base partagée avec « Pas ce soir » (même projet Supabase) :
--   - réutilisés tels quels : auth.users, public.profiles, public.app_admins,
--     public.app_invites, public.signup_allowlist, public.is_app_admin()
--     (les comptes et les invitations admin sont donc communs aux deux apps)
--   - toutes les tables propres à l'application sont préfixées « pp_ »
--
--  Prérequis : les migrations de Pas ce soir (profiles, app_admins, app_invites…)
--  À exécuter dans Supabase (SQL Editor).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Horodatage serveur (base de la synchronisation hors ligne)
-- ---------------------------------------------------------------------
create or replace function public.pp_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

-- Variante pour les tables avec auteur : l'auteur est toujours l'utilisateur connecté
-- et ne change plus ensuite (sauf effacement en cascade à la suppression d'un compte)
create or replace function public.pp_touch_author()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
  else
    if not (new.created_by is null and pg_trigger_depth() > 1) then
      new.created_by := old.created_by;
    end if;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Foyers et personnes
-- ---------------------------------------------------------------------
create table public.pp_households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_by  uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- Une personne du foyer : simple prénom, ou liée à un compte (qui a alors accès au foyer)
create table public.pp_people (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.pp_households (id) on delete cascade,
  name          text not null,
  user_id       uuid references public.profiles (id) on delete set null,
  role          text not null default 'member' check (role in ('owner', 'member')),
  -- lien d'invitation (usage unique) permettant à un compte de se lier à cette personne
  invite_token  text unique,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create index pp_people_household_updated_idx on public.pp_people (household_id, updated_at);
create index pp_people_user_idx on public.pp_people (user_id) where user_id is not null;
-- un compte n'est lié qu'à une seule personne par foyer
create unique index pp_people_one_link_per_household
  on public.pp_people (household_id, user_id)
  where user_id is not null and deleted_at is null;

-- ---------------------------------------------------------------------
-- Paramétrage du foyer : lieux de stockage et types d'aliments
-- ---------------------------------------------------------------------
create table public.pp_locations (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.pp_households (id) on delete cascade,
  label         text not null,
  icon          text not null default '',
  position      integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- archivé : masqué des choix, conservé pour l'historique
  deleted_at    timestamptz
);

create index pp_locations_household_updated_idx on public.pp_locations (household_id, updated_at);

create table public.pp_food_types (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.pp_households (id) on delete cascade,
  label         text not null,
  position      integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create index pp_food_types_household_updated_idx on public.pp_food_types (household_id, updated_at);

-- ---------------------------------------------------------------------
-- Produits (catalogue du foyer) et stock
-- ---------------------------------------------------------------------
create table public.pp_products (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references public.pp_households (id) on delete cascade,
  barcode        text,
  name           text not null check (length(trim(name)) > 0),
  brand          text not null default '',
  description    text not null default '',
  ingredients    text not null default '',
  nutriscore     text check (nutriscore in ('a', 'b', 'c', 'd', 'e')),
  image_url      text,
  food_type_id   uuid references public.pp_food_types (id) on delete set null,
  unit           text not null default 'pièce',
  -- aliment favori : 0 = non favori, 1 à 5 étoiles
  rating         smallint not null default 0 check (rating between 0 and 5),
  -- « proche de la rupture » en dessous de ce seuil (quantité restante)
  low_threshold  numeric not null default 1 check (low_threshold >= 0),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);

create index pp_products_household_updated_idx on public.pp_products (household_id, updated_at);
create index pp_products_barcode_idx on public.pp_products (household_id, barcode) where barcode is not null;

-- Un lot en stock : quantité initiale ; le restant = quantité - somme des sorties
create table public.pp_stock_items (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.pp_households (id) on delete cascade,
  product_id    uuid not null references public.pp_products (id) on delete cascade,
  location_id   uuid references public.pp_locations (id) on delete set null,
  quantity      numeric not null check (quantity >= 0),
  purchased_on  date not null default current_date,
  expires_on    date,
  note          text not null default '',
  created_by    uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create index pp_stock_items_household_updated_idx on public.pp_stock_items (household_id, updated_at);

-- Sorties de stock (utilisé, jeté, offert) et ajustements d'inventaire.
-- Lignes en ajout seul : deux appareils hors ligne peuvent consommer le même lot sans conflit.
create table public.pp_stock_movements (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references public.pp_households (id) on delete cascade,
  stock_item_id  uuid not null references public.pp_stock_items (id) on delete cascade,
  kind           text not null check (kind in ('used', 'thrown', 'given', 'adjusted')),
  -- quantité retirée (négative pour un ajustement à la hausse)
  quantity       numeric not null,
  occurred_on    date not null default current_date,
  recipe_name    text,
  note           text not null default '',
  created_by     uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);

create index pp_stock_movements_household_updated_idx on public.pp_stock_movements (household_id, updated_at);

-- ---------------------------------------------------------------------
-- Préférences alimentaires et recettes
--  - niveau compte : user_id renseigné (household_id et person_id vides), visibles
--    dans chaque foyer où le compte est lié à une personne (lien, pas copie)
--  - niveau foyer  : person_id + household_id (personne sans compte, ou complément
--    propre au foyer pour une personne liée à un compte)
-- ---------------------------------------------------------------------
create table public.pp_preferences (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references public.profiles (id) on delete cascade,
  household_id  uuid references public.pp_households (id) on delete cascade,
  person_id     uuid references public.pp_people (id) on delete cascade,
  label         text not null check (length(trim(label)) > 0),
  level         text not null check (level in ('love', 'like', 'dislike', 'allergy')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  constraint pp_preferences_owner check (
    (user_id is not null and household_id is null and person_id is null)
    or (user_id is null and household_id is not null and person_id is not null)
  )
);

create index pp_preferences_user_updated_idx on public.pp_preferences (user_id, updated_at) where user_id is not null;
create index pp_preferences_household_updated_idx on public.pp_preferences (household_id, updated_at) where household_id is not null;

create table public.pp_recipes (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references public.profiles (id) on delete cascade,
  household_id  uuid references public.pp_households (id) on delete cascade,
  person_id     uuid references public.pp_people (id) on delete cascade,
  name          text not null check (length(trim(name)) > 0),
  -- [{ "name": "Tomate", "quantity": 3, "unit": "pièce" }]
  ingredients   jsonb not null default '[]'::jsonb check (jsonb_typeof(ingredients) = 'array'),
  instructions  text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  constraint pp_recipes_owner check (
    (user_id is not null and household_id is null and person_id is null)
    or (user_id is null and household_id is not null and person_id is not null)
  )
);

create index pp_recipes_user_updated_idx on public.pp_recipes (user_id, updated_at) where user_id is not null;
create index pp_recipes_household_updated_idx on public.pp_recipes (household_id, updated_at) where household_id is not null;

-- ---------------------------------------------------------------------
-- Fonctions utilitaires (utilisées par les politiques RLS)
-- ---------------------------------------------------------------------
create or replace function public.pp_is_member(p_household_id uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.pp_people
    where household_id = p_household_id and user_id = auth.uid() and deleted_at is null
  ) or exists (
    -- le créateur est membre avant même que sa personne soit synchronisée
    select 1 from public.pp_households
    where id = p_household_id and created_by = auth.uid()
  );
$$;

create or replace function public.pp_is_owner(p_household_id uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.pp_people
    where household_id = p_household_id and user_id = auth.uid() and role = 'owner' and deleted_at is null
  ) or exists (
    select 1 from public.pp_households
    where id = p_household_id and created_by = auth.uid()
  );
$$;

-- Le compte p_user_id est lié à un foyer dont je suis membre
create or replace function public.pp_shares_household_with(p_user_id uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1
    from public.pp_people a
    join public.pp_people b on a.household_id = b.household_id
    join public.pp_households h on h.id = a.household_id
    where a.user_id = auth.uid() and a.deleted_at is null
      and b.user_id = p_user_id and b.deleted_at is null
      and h.deleted_at is null
  );
$$;

create or replace function public.pp_person_in_household(p_person_id uuid, p_household_id uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.pp_people where id = p_person_id and household_id = p_household_id
  );
$$;

-- ---------------------------------------------------------------------
-- Triggers d'horodatage
-- ---------------------------------------------------------------------
create trigger pp_households_touch before insert or update on public.pp_households
  for each row execute function public.pp_touch_author();
create trigger pp_people_touch before insert or update on public.pp_people
  for each row execute function public.pp_touch();
create trigger pp_locations_touch before insert or update on public.pp_locations
  for each row execute function public.pp_touch();
create trigger pp_food_types_touch before insert or update on public.pp_food_types
  for each row execute function public.pp_touch();
create trigger pp_products_touch before insert or update on public.pp_products
  for each row execute function public.pp_touch();
create trigger pp_stock_items_touch before insert or update on public.pp_stock_items
  for each row execute function public.pp_touch_author();
create trigger pp_stock_movements_touch before insert or update on public.pp_stock_movements
  for each row execute function public.pp_touch_author();
create trigger pp_preferences_touch before insert or update on public.pp_preferences
  for each row execute function public.pp_touch();
create trigger pp_recipes_touch before insert or update on public.pp_recipes
  for each row execute function public.pp_touch();

-- ---------------------------------------------------------------------
-- Règles métier
-- ---------------------------------------------------------------------

-- Seul le propriétaire peut supprimer le foyer
create or replace function public.pp_guard_household()
returns trigger
language plpgsql
as $$
begin
  if new.deleted_at is distinct from old.deleted_at and not public.pp_is_owner(old.id) then
    raise exception 'Seul le propriétaire du foyer peut le supprimer' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger pp_households_guard before update on public.pp_households
  for each row execute function public.pp_guard_household();

-- Le lien personne <-> compte ne se fait que :
--  - à la création du foyer (le créateur se lie lui-même, propriétaire),
--  - via une invitation acceptée (pp_accept_invite) ou un départ (pp_leave_household),
--  - le propriétaire peut retirer l'accès d'un membre ou supprimer sa personne.
create or replace function public.pp_guard_person()
returns trigger
language plpgsql
as $$
declare
  v_trusted boolean := coalesce(current_setting('pp.trusted', true), '') = 'on';
  v_creator boolean;
begin
  if v_trusted then
    return new;
  end if;

  -- Suppression d'un compte (y compris depuis « Pas ce soir ») : la contrainte
  -- « on delete set null » délie la personne (mise à jour en cascade, pg_trigger_depth() > 1)
  if tg_op = 'UPDATE' and pg_trigger_depth() > 1 and new.user_id is null and old.user_id is not null
     and new.role is not distinct from old.role and new.invite_token is not distinct from old.invite_token then
    return new;
  end if;

  if tg_op = 'INSERT' then
    v_creator := exists (select 1 from public.pp_households where id = new.household_id and created_by = auth.uid());
    if new.user_id is not null and not (new.user_id = auth.uid() and v_creator) then
      raise exception 'Une personne ne peut être liée à un compte que par invitation' using errcode = '42501';
    end if;
    if new.role = 'owner' and not (new.user_id = auth.uid() and v_creator) then
      raise exception 'Rôle non autorisé' using errcode = '42501';
    end if;
    if new.invite_token is not null and not public.pp_is_owner(new.household_id) then
      raise exception 'Seul le propriétaire du foyer gère les invitations' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.household_id <> old.household_id or new.role is distinct from old.role then
    raise exception 'Modification non autorisée' using errcode = '42501';
  end if;

  if new.invite_token is distinct from old.invite_token and not public.pp_is_owner(old.household_id) then
    raise exception 'Seul le propriétaire du foyer gère les invitations' using errcode = '42501';
  end if;

  -- Suppression d'une personne liée : réservée au propriétaire (jamais sa propre personne)
  if new.deleted_at is not null and old.deleted_at is null and old.user_id is not null then
    if old.role = 'owner' or not public.pp_is_owner(old.household_id) then
      raise exception 'Seul le propriétaire peut retirer un membre du foyer' using errcode = '42501';
    end if;
    new.user_id := null;
    new.invite_token := null;
  end if;

  if new.user_id is distinct from old.user_id then
    -- seul retrait d'accès possible ici : par le propriétaire, pour un autre membre
    if new.user_id is not null or old.role = 'owner' or not public.pp_is_owner(old.household_id) then
      raise exception 'Une personne ne peut être liée à un compte que par invitation' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

create trigger pp_people_guard before insert or update on public.pp_people
  for each row execute function public.pp_guard_person();

-- ---------------------------------------------------------------------
-- Invitations au foyer (lier un compte existant à une personne)
-- La création de compte reste réservée aux invitations des administrateurs.
-- ---------------------------------------------------------------------
create or replace function public.pp_invite_preview(p_token text)
returns table (household_name text, person_name text)
language sql
stable
security definer set search_path = public
as $$
  select h.name, p.name
  from public.pp_people p
  join public.pp_households h on h.id = p.household_id
  where p.invite_token = p_token and p.deleted_at is null and p.user_id is null and h.deleted_at is null;
$$;

create or replace function public.pp_accept_invite(p_token text)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_person public.pp_people;
begin
  if auth.uid() is null then
    raise exception 'Non authentifié' using errcode = '42501';
  end if;

  select p.* into v_person
  from public.pp_people p
  join public.pp_households h on h.id = p.household_id
  where p.invite_token = p_token and p.deleted_at is null and p.user_id is null and h.deleted_at is null;

  if v_person.id is null then
    raise exception 'Lien d''invitation invalide ou déjà utilisé' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.pp_people
    where household_id = v_person.household_id and user_id = auth.uid() and deleted_at is null
  ) then
    raise exception 'Vous faites déjà partie de ce foyer' using errcode = 'P0001';
  end if;

  perform set_config('pp.trusted', 'on', true);
  update public.pp_people
  set user_id = auth.uid(), invite_token = null
  where id = v_person.id;
  perform set_config('pp.trusted', 'off', true);

  return v_person.household_id;
end;
$$;

-- Quitter un foyer : la personne reste (avec ses préférences de foyer), sans compte lié
create or replace function public.pp_leave_household(p_household_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if exists (
    select 1 from public.pp_people
    where household_id = p_household_id and user_id = auth.uid() and role = 'owner' and deleted_at is null
  ) then
    raise exception 'Le propriétaire ne peut pas quitter son foyer : supprimez-le' using errcode = 'P0001';
  end if;

  perform set_config('pp.trusted', 'on', true);
  update public.pp_people
  set user_id = null
  where household_id = p_household_id and user_id = auth.uid();
  perform set_config('pp.trusted', 'off', true);
end;
$$;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.pp_households      enable row level security;
alter table public.pp_people          enable row level security;
alter table public.pp_locations       enable row level security;
alter table public.pp_food_types      enable row level security;
alter table public.pp_products        enable row level security;
alter table public.pp_stock_items     enable row level security;
alter table public.pp_stock_movements enable row level security;
alter table public.pp_preferences     enable row level security;
alter table public.pp_recipes         enable row level security;

-- Profils (table partagée) : visibles aussi entre membres d'un même foyer
create policy "profils visibles : co-membres d'un foyer" on public.profiles
  for select to authenticated
  using (public.pp_shares_household_with(id));

-- Foyers
create policy "pp foyers visibles par les membres" on public.pp_households
  for select to authenticated
  using (created_by = auth.uid() or public.pp_is_member(id));

create policy "pp création de foyer" on public.pp_households
  for insert to authenticated
  with check (created_by = auth.uid());

create policy "pp modification de foyer par les membres" on public.pp_households
  for update to authenticated
  using (public.pp_is_member(id))
  with check (public.pp_is_member(id));

-- Tables rattachées à un foyer : accès complet pour les membres
do $$
declare
  t text;
begin
  foreach t in array array['pp_people', 'pp_locations', 'pp_food_types', 'pp_products', 'pp_stock_items', 'pp_stock_movements'] loop
    execute format('create policy "pp lecture par les membres" on public.%I for select to authenticated using (public.pp_is_member(household_id))', t);
    execute format('create policy "pp création par les membres" on public.%I for insert to authenticated with check (public.pp_is_member(household_id))', t);
    execute format('create policy "pp modification par les membres" on public.%I for update to authenticated using (public.pp_is_member(household_id)) with check (public.pp_is_member(household_id))', t);
  end loop;
end;
$$;

-- Préférences et recettes : celles de mon compte, celles des comptes liés à mes foyers
-- (lecture seule), et celles des personnes de mes foyers
do $$
declare
  t text;
begin
  foreach t in array array['pp_preferences', 'pp_recipes'] loop
    execute format($f$
      create policy "pp lecture" on public.%I for select to authenticated using (
        user_id = auth.uid()
        or (user_id is not null and public.pp_shares_household_with(user_id))
        or (household_id is not null and public.pp_is_member(household_id))
      )$f$, t);
    execute format($f$
      create policy "pp création" on public.%I for insert to authenticated with check (
        user_id = auth.uid()
        or (user_id is null and public.pp_is_member(household_id) and public.pp_person_in_household(person_id, household_id))
      )$f$, t);
    execute format($f$
      create policy "pp modification" on public.%I for update to authenticated
      using (
        user_id = auth.uid()
        or (user_id is null and public.pp_is_member(household_id))
      )
      with check (
        user_id = auth.uid()
        or (user_id is null and public.pp_is_member(household_id) and public.pp_person_in_household(person_id, household_id))
      )$f$, t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- Droits (les projets Supabase récents n'en accordent plus par défaut)
-- ---------------------------------------------------------------------
grant select, insert, update on
  public.pp_households, public.pp_people, public.pp_locations, public.pp_food_types,
  public.pp_products, public.pp_stock_items, public.pp_stock_movements,
  public.pp_preferences, public.pp_recipes
to authenticated;

revoke all on
  public.pp_households, public.pp_people, public.pp_locations, public.pp_food_types,
  public.pp_products, public.pp_stock_items, public.pp_stock_movements,
  public.pp_preferences, public.pp_recipes
from anon;

revoke execute on function public.pp_is_member(uuid)                  from public, anon;
revoke execute on function public.pp_is_owner(uuid)                   from public, anon;
revoke execute on function public.pp_shares_household_with(uuid)      from public, anon;
revoke execute on function public.pp_person_in_household(uuid, uuid)  from public, anon;
revoke execute on function public.pp_invite_preview(text)             from public, anon;
revoke execute on function public.pp_accept_invite(text)              from public, anon;
revoke execute on function public.pp_leave_household(uuid)            from public, anon;

grant execute on function public.pp_is_member(uuid)                   to authenticated;
grant execute on function public.pp_is_owner(uuid)                    to authenticated;
grant execute on function public.pp_shares_household_with(uuid)       to authenticated;
grant execute on function public.pp_person_in_household(uuid, uuid)   to authenticated;
grant execute on function public.pp_invite_preview(text)              to authenticated;
grant execute on function public.pp_accept_invite(text)               to authenticated;
grant execute on function public.pp_leave_household(uuid)             to authenticated;
