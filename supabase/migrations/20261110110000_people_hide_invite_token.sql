-- =====================================================================
--  Invitations au foyer : le jeton n'est plus lu par tous les membres (2/2)
--  Retire aux membres le droit de lire pp_people.invite_token : la lecture de
--  la table est limitée, colonne par colonne, à tout sauf le jeton. Le
--  propriétaire le lit par pp_person_invite_token() ; il continue de le poser
--  et de l'effacer par une mise à jour directe (contrôlée par pp_guard_person).
--
--  À exécuter APRÈS le déploiement de la version de l'application qui
--  n'utilise plus invite_token, une fois les appareils mis à jour : les
--  versions précédentes lisent pp_people avec « select * », ce qui est refusé
--  (42501) dès cette migration — leur synchronisation ne reçoit alors plus
--  rien tant que la mise à jour proposée n'est pas acceptée.
--
--  Attention : toute colonne ajoutée ensuite à pp_people doit être ajoutée à
--  ce « grant select » (et à TABLES.people.columns dans useSync.ts).
-- =====================================================================

revoke select on public.pp_people from authenticated;

grant select (id, household_id, name, user_id, role, invite_pending, created_at, updated_at, deleted_at)
  on public.pp_people to authenticated;
