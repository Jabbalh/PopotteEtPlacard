-- =====================================================================
--  Recettes du foyer et note des recettes
--  - Recette commune : rattachée au foyer sans personne particulière
--    (household_id renseigné, person_id et user_id vides).
--  - Note de 0 à 5 étoiles sur toute recette (0 = non notée).
--
--  À exécuter AVANT de déployer la version de l'application qui l'utilise :
--  la synchronisation envoie la colonne rating, et les recettes communes
--  seraient refusées par l'ancienne contrainte.
-- =====================================================================

-- Rattachement : compte seul, personne d'un foyer, ou foyer seul (recette commune)
alter table public.pp_recipes drop constraint pp_recipes_owner;
alter table public.pp_recipes add constraint pp_recipes_owner check (
  (user_id is not null and household_id is null and person_id is null)
  or (user_id is null and household_id is not null)
);

alter table public.pp_recipes
  add column rating smallint not null default 0 check (rating between 0 and 5);

-- Écriture : une recette de foyer sans personne est permise aux membres du foyer
drop policy "pp création" on public.pp_recipes;
drop policy "pp modification" on public.pp_recipes;

create policy "pp création" on public.pp_recipes for insert to authenticated with check (
  user_id = auth.uid()
  or (user_id is null and public.pp_is_member(household_id)
      and (person_id is null or public.pp_person_in_household(person_id, household_id)))
);

create policy "pp modification" on public.pp_recipes for update to authenticated
using (
  user_id = auth.uid()
  or (user_id is null and public.pp_is_member(household_id))
)
with check (
  user_id = auth.uid()
  or (user_id is null and public.pp_is_member(household_id)
      and (person_id is null or public.pp_person_in_household(person_id, household_id)))
);
