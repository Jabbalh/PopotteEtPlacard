-- =====================================================================
--  Invitations au foyer : le jeton n'est plus lu par tous les membres (1/2)
--  Jusqu'ici, la synchronisation lisait pp_people.invite_token sur l'appareil
--  de chaque membre : un membre non propriétaire pouvait donc transmettre le
--  lien d'invitation, alors que seul le propriétaire gère les invitations.
--
--  - pp_people.invite_pending : « une invitation est en cours », sans le jeton
--    (colonne calculée), pour l'indication « Invitation en attente ».
--  - pp_person_invite_token(person) : le jeton, pour le propriétaire seulement.
--
--  Cette migration n'enlève encore rien : les versions précédentes de
--  l'application continuent de fonctionner.
--
--  À exécuter AVANT de déployer la version de l'application qui l'utilise :
--  la synchronisation lit la colonne invite_pending.
--  Puis, une fois tous les appareils à jour : 20261110110000_people_hide_invite_token.sql
-- =====================================================================

alter table public.pp_people
  add column invite_pending boolean generated always as (invite_token is not null) stored;

-- Jeton d'invitation en cours d'une personne : réservé au propriétaire du foyer
create or replace function public.pp_person_invite_token(p_person_id uuid)
returns text
language sql
stable
security definer set search_path = public
as $$
  select p.invite_token
  from public.pp_people p
  where p.id = p_person_id and p.deleted_at is null and public.pp_is_owner(p.household_id);
$$;

revoke execute on function public.pp_person_invite_token(uuid) from public, anon;
grant execute on function public.pp_person_invite_token(uuid) to authenticated;
