# Documentation fonctionnelle

Popotte & Placard gère le stock alimentaire d'un foyer (frigo, congélateur, placards…), les goûts de chaque personne et propose des idées de recettes à partir du stock et des dates de péremption.

L'application est une PWA : elle s'installe sur l'écran d'accueil et fonctionne hors connexion. Elle est conçue d'abord pour le mobile et s'adapte à la tablette et au PC (voir § 15).

## Sommaire

1. [Acteurs et rôles](#1-acteurs-et-rôles)
2. [Comptes et authentification](#2-comptes-et-authentification)
3. [Goûts et recettes du compte](#3-goûts-et-recettes-du-compte)
4. [Foyers](#4-foyers)
5. [Personnes du foyer](#5-personnes-du-foyer)
6. [Invitations au foyer](#6-invitations-au-foyer)
7. [Stock](#7-stock)
8. [Ajout d'un produit](#8-ajout-dun-produit)
9. [Sortie de stock et corrections](#9-sortie-de-stock-et-corrections)
10. [Idées (recherches)](#10-idées-recherches)
11. [À commander](#11-à-commander)
12. [Bilan](#12-bilan)
13. [Réglages du foyer](#13-réglages-du-foyer)
14. [Hors connexion](#14-hors-connexion)
15. [Affichage mobile, tablette et PC](#15-affichage-mobile-tablette-et-pc)
16. [Plan des écrans](#16-plan-des-écrans)

---

## 1. Acteurs et rôles

| Rôle | Qui | Ce qu'il peut faire |
|---|---|---|
| **Administrateur** | Compte inscrit dans `app_admins` (géré depuis Supabase) | Créer, partager et révoquer les invitations à créer un compte |
| **Utilisateur** | Tout compte | Gérer ses goûts et recettes, créer des foyers, rejoindre un foyer sur invitation |
| **Propriétaire du foyer** | Créateur du foyer | Tout ce que fait un membre + inviter une personne, retirer l'accès d'un membre, retirer une personne liée à un compte, supprimer le foyer |
| **Membre du foyer** | Compte lié à une personne du foyer | Gérer le stock, les personnes sans compte, les goûts du foyer, les réglages ; quitter le foyer |
| **Personne sans compte** | Prénom saisi dans le foyer (enfant, invité régulier…) | Aucun accès ; ses goûts sont gérés par les membres |

Les administrateurs et les comptes sont **communs avec l'application « Pas ce soir »** (même base Supabase).

## 2. Comptes et authentification

- **Inscription sur invitation uniquement.** Un administrateur crée un lien depuis *Administration* :
  - note libre (« pour qui ? »), validité de 24 h, 7 jours ou 30 jours ;
  - lien à usage unique `/inscription/<jeton>`, partagé via le partage natif du téléphone ou copié ;
  - statut : active, utilisée (par qui), expirée, révoquée.
- La personne invitée saisit prénom, email, mot de passe (6 caractères minimum). Selon la configuration Supabase, elle confirme son email avant de se connecter.
- **Connexion** par email + mot de passe ; **mot de passe oublié** par lien envoyé par email (`/nouveau-mot-de-passe`).
- **Profil** : nom affiché, visible par les membres de ses foyers.
- **Déconnexion** : si des modifications ne sont pas encore synchronisées, une confirmation est demandée.
- La suppression de compte n'est pas proposée dans cette application (elle supprimerait aussi les données « Pas ce soir »).

## 3. Goûts et recettes du compte

Écran *Mes goûts et recettes* (menu utilisateur).

### Préférences d'aliments

Chaque préférence est un libellé libre (ex. « brocoli ») avec un niveau :

| Niveau | Usage dans les idées |
|---|---|
| Adore | Affiché sur les aliments à consommer |
| Aime | Affiché sur les aliments à consommer |
| N'aime pas | Signalé en orange sur les recettes qui contiennent l'aliment |
| Allergie / interdit | Signalé en rouge ; la recette est classée en dernier |

- Toucher une préférence fait défiler son niveau ; la croix la retire (annulable).
- Ajouter un libellé (ou un code-barres) déjà présent change son niveau au lieu de créer un doublon.

### Saisie d'un aliment

L'aliment peut être **en stock ou non** :

- **saisie libre** : n'importe quel libellé, même pour un aliment jamais acheté ;
- **propositions** : tant que rien n'est saisi, les aliments en stock (icône frigo) ; en tapant, les produits connus du foyer qui ressemblent à la saisie, en stock ou non (dans *Mes goûts*, ceux de tous les foyers de l'utilisateur) ;
- **scan du code-barres** (ou saisie du code) : le nom est repris d'un produit déjà connu, sinon d'Open Food Facts (réseau requis). Produit introuvable : le code-barres est conservé et l'utilisateur saisit le nom.

Une préférence avec code-barres (icône code-barres) correspond **exactement** au produit de même code-barres, même si les noms diffèrent (« Nutella » ↔ « Pâte à tartiner noisettes cacao »). Sans code-barres, elle est rapprochée par le nom (voir § 10).

### Recettes préférées

Une recette a :
- un **nom** (obligatoire) ;
- une **liste d'aliments** (facultative) : nom, quantité et unité facultatives ;
- un **texte libre** (préparation, notes).
- une **note** de 0 à 5 étoiles (facultative) : à couverture du stock égale, les recettes les mieux notées sont proposées en premier dans les idées.

Les aliments de la recette servent à la rapprocher du stock. Une recette en texte seul est conservée mais n'apparaît pas dans les idées.

Ces goûts et recettes sont **liés au compte** : ils apparaissent automatiquement dans chaque foyer où le compte est lié à une personne. Ce n'est pas une copie : une modification est visible partout.

## 4. Foyers

- Écran d'accueil *Mes foyers* : liste des foyers avec le nombre de personnes et de produits.
- **Création** : nom du foyer + prénom de l'utilisateur dans ce foyer (proposé depuis le profil). Sont créés automatiquement :
  - la personne de l'utilisateur, liée à son compte, propriétaire ;
  - les rangements **Frigo**, **Congélateur** (marqué comme congélateur), **Autre** ;
  - douze types d'aliments (Fruits et légumes, Viande, Poisson, Produits laitiers, Œufs, Féculents, Conserves, Épicerie sucrée, Épicerie salée, Boissons, Plats préparés, Autre), avec une durée de conservation au congélateur pour certains (voir § 8).
- La création fonctionne hors connexion.
- Au lancement, l'application ouvre directement le dernier foyer consulté (ou le seul foyer existant).

## 5. Personnes du foyer

Écran *Personnes*.

- Liste des personnes avec leur statut : *Propriétaire*, *Compte : <nom>*, *Invitation en attente*, *Sans compte*, et le nombre de préférences et recettes.
- **Ajouter une personne** : prénom seul. Elle n'a pas de compte.
- **Fiche d'une personne** :
  - renommer (toucher le prénom) ;
  - préférences d'aliments et recettes préférées.

### Goûts d'une personne liée à un compte

| Origine | Affichage | Modifiable par |
|---|---|---|
| Goûts du compte | Bordure pointillée, icône 🔗 | Le titulaire du compte uniquement |
| Complément du foyer | Normal | Tous les membres du foyer |

Ce qu'on ajoute depuis la fiche d'une personne est un **complément propre à ce foyer** : il n'apparaît pas dans les autres foyers ni dans *Mes goûts*.

### Goûts d'une personne sans compte

Tous les goûts sont propres au foyer et modifiables par les membres.

### Retirer

- **Retirer l'accès** (propriétaire, personne liée) : le compte perd l'accès au foyer ; la personne reste avec ses goûts propres au foyer ; les goûts du compte ne sont plus repris.
- **Retirer du foyer** (propriétaire) : la personne et ses goûts propres au foyer sont supprimés ; si elle était liée, le compte perd l'accès.
- **Quitter le foyer** (membre, sur sa propre fiche ou dans les réglages) : même effet que le retrait d'accès. Le propriétaire ne peut pas quitter son foyer : il doit le supprimer.

## 6. Invitations au foyer

Une invitation lie **un compte existant** à **une personne du foyer**.

1. Le propriétaire ouvre la fiche d'une personne sans compte → *Inviter <prénom> à lier son compte* (connexion requise).
2. Un lien `/rejoindre/<jeton>` est créé et partagé. Il peut être annulé.
3. Le destinataire ouvre le lien :
   - non connecté → page de connexion avec un message expliquant l'invitation ;
   - connecté → aperçu « foyer X, en tant que Y » → *Rejoindre le foyer*.
4. Le compte est lié à la personne et obtient l'accès au foyer ; le lien devient inutilisable.

Règles :
- lien à **usage unique** ;
- un compte ne peut être lié qu'à **une seule personne par foyer** ;
- **l'invitation au foyer ne permet pas de créer un compte** : si la personne n'en a pas, un administrateur doit d'abord lui envoyer une invitation d'inscription.

## 7. Stock

Écran *Stock* (accueil d'un foyer).

- **Filtre par rangement** : *Tout* ou un rangement, avec le nombre de lots.
- **Recherche** par nom ou marque (accents et pluriels ignorés).
- **Tri** : par date de péremption la plus proche (défaut) ou par nom.
- Une ligne par produit, regroupant ses lots :
  - photo ou icône, nom, Nutri-Score, étoiles si favori ;
  - quantité totale, nombre de lots, type d'aliment, rangement(s) ;
  - badge de péremption du lot le plus urgent ;
  - préférences des personnes du foyer : un badge par personne (prénom, couleur et icône du niveau), avec sa préférence la plus forte, allergies et aversions d'abord, 3 au maximum puis « +N » ; le survol affiche la préférence saisie. Le détail complet est sur la fiche produit.
- Bouton **−** en bout de ligne : *Retirer du stock* (le lot le plus urgent est présélectionné). Toucher le reste de la ligne ouvre la fiche produit.
- Boutons d'ajout **Scanner** (ouvre la caméra), **+ Manuel** (saisie libre) et **Ticket** (ticket de caisse, § 8) : flottants en bas à droite sur mobile et tablette, dans l'en-tête de la page sur PC.
- Un ticket de caisse en cours de saisie dans le foyer est signalé en haut de la liste (*Continuer*), sur tous les appareils.

### Badges de péremption

| Situation | Libellé | Couleur |
|---|---|---|
| Date dépassée | Périmé depuis N j | Rouge |
| Aujourd'hui | Périme aujourd'hui | Rouge |
| Demain | Périme demain | Orange |
| 2 à 3 jours | Périme dans N j | Orange |
| 4 à 7 jours | Jusqu'au <date> | Orange |
| Plus de 7 jours | Jusqu'au <date> | Vert |
| Pas de date | Sans date | Gris |

### Fiche produit

- Informations : photo, marque, Nutri-Score, type, code-barres, description, composition.
- **Note de favori** (0 à 5 étoiles), enregistrée immédiatement.
- **À commander quand épuisé** (interrupteur, enregistré immédiatement) ; sous le seuil, encart *À commander* avec le bouton *Commandé* (voir § 11).
- **Préférences du foyer** : les personnes qui ont une préférence sur cet aliment, avec la préférence telle qu'elle l'a saisie (ex. « Nutella »), son niveau, et son origine (goût du compte ou propre au foyer). Allergies et aversions d'abord. Rapprochement par code-barres (icône), sinon par le nom. Toucher une ligne ouvre la fiche de la personne.
- **Lots en stock** : quantité restante (et initiale), rangement, date d'achat, prix payé s'il est connu, péremption ; actions *Retirer* et *Modifier / corriger* (dont le prix).
- **Historique des prix** (si au moins un lot a un prix) : chaque achat, épuisé compris, avec sa date, sa quantité, le prix payé et le prix unitaire (€/kg pour un produit en g, €/L en ml ou cl) ; à partir de deux achats, dernier prix, prix le plus bas (avec sa date) et moyenne pondérée par les quantités.
- **Alerte rupture** pour un favori ou un produit à commander dont le stock est sous le seuil.
- **Historique** des sorties (type, quantité, recette, date, auteur, note), chaque sortie pouvant être annulée.
- **Modifier le produit** : nom, aliment (pour les recettes, avec les catégories Open Food Facts proposées si le produit a un code-barres), marque, description, composition, Nutri-Score, type, unité, seuil d'alerte rupture (favoris et produits à commander).
- **Supprimer le produit** (annulable).

## 8. Ajout d'un produit

La popin s'ouvre depuis le stock, la fiche produit (ajout d'un lot), le bilan (racheter un favori) ou *À commander*.

### Scan

- Caméra arrière, codes EAN-13, EAN-8, UPC-A, UPC-E ; vibration à la détection.
- Saisie manuelle du code possible (caméra refusée ou indisponible).
- Après lecture :
  1. si le code-barres est **déjà connu du foyer**, le produit existant est réutilisé ;
  2. sinon recherche sur **Open Food Facts** (produits de grande distribution) : nom, marque, description (dénomination + contenance), composition, Nutri-Score, photo ;
  3. produit inconnu ou hors connexion : message, le code est conservé et l'utilisateur saisit le produit.

### Champs

| Champ | Obligatoire | Défaut |
|---|---|---|
| Nom du produit | ✅ | Open Food Facts |
| Aliment (pour les recettes) | | Catégorie Open Food Facts la plus précise ; les autres catégories sont proposées en raccourcis |
| Marque, description, composition, Nutri-Score | | Open Food Facts (section dépliable) |
| Aliment favori (étoiles) | | 0 (non favori) |
| À commander quand épuisé | | Non |
| Quantité | ✅ (> 0) | 1 |
| Unité | | pièce (g, kg, ml, cl, L, paquet, boîte, bouteille, pot, sachet, tranche) |
| Date d'achat | | Aujourd'hui |
| Date de péremption | | Vide (au congélateur : date limite selon le type, voir ci-dessous) |
| Prix payé | | Vide (facultatif) ; prix total du lot, le prix unitaire est affiché si la quantité n'est pas 1 |
| Type d'aliment | | Vide |
| Rangé dans | | Rangement filtré dans la liste, sinon le premier |

- En tapant un nom, les produits du foyer qui y ressemblent sont proposés : en choisir un réutilise le produit (son unité n'est alors plus modifiable).
- **+ Autre produit** enregistre et rouvre une popin vide (saisie de courses à la chaîne).

### Conservation au congélateur

Chaque type d'aliment peut avoir une **durée de conservation au congélateur** (en mois), et chaque rangement peut être marqué **congélateur** (réglages du foyer, § 13).

Quand le lot est rangé dans un congélateur et que le type d'aliment a une durée, la **date de péremption est proposée** : date d'achat + N mois (ex. Viande, 6 mois, achetée le 15 octobre → jusqu'au 15 avril). Un message sous les dates le rappelle (« ❄ Viande au congélateur : 6 mois, soit jusqu'au … »).

- La date proposée suit les changements de rangement, de type ou de date d'achat tant qu'elle n'a pas été modifiée à la main ; une date saisie est conservée (*Appliquer* reprend la date proposée).
- Congélateur sans durée pour le type choisi : un message invite à choisir un type ou à régler sa durée.
- Le lot est ensuite traité comme les autres : badges de péremption, *À consommer*, *Anti-gaspi*, bilan.

Durées proposées à la création d'un foyer (modifiables) :

| Type | Durée |
|---|---|
| Fruits et légumes | 8 mois |
| Viande | 6 mois |
| Poisson | 4 mois |
| Produits laitiers, Féculents, Épicerie sucrée, Plats préparés | 3 mois |
| Œufs, Conserves, Épicerie salée, Boissons, Autre | — |

### Ticket de caisse

Écran *Ticket de caisse* (bouton **Ticket** du stock) : ajoute d'un coup tous les articles d'un ticket. Un ticket ne porte pas de code-barres, seulement des libellés abrégés (« BEURRE DX PRES 250G ») : chaque article est donc **associé à un produit** avant d'entrer dans le stock.

**Import**
- **Ticket PDF** : ticket dématérialisé envoyé par le magasin (courriel, appli de fidélité). Son texte est lu **sur l'appareil**, sans envoi ni connexion. Un PDF issu d'un scan ou d'une photo ne contient pas de texte : un message le signale.
- **Coller le texte** : texte d'un ticket, ou simple liste (un article par ligne, « Lait x2 » ou « 2 x yaourts » pour la quantité).
- Sont reconnus : le prix en fin de ligne, la ligne « 2 x 0,89 » avant ou après l'article, les articles pesés (« 0,512 kg x 2,99 €/kg » → 0,512 kg), les colonnes quantité / prix unitaire / total. Un article passé plusieurs fois en caisse est regroupé.
- **Rien n'est perdu** : les lignes non reconnues comme articles (en-tête, totaux, paiement, ou format de ticket inconnu) restent à disposition.
  - Aucun article reconnu : **toutes les lignes du ticket sont listées**, à associer, ignorer ou retirer.
  - Sinon, seuls les articles sont listés. Le message de fin d'import propose *Voir les lignes* : une fenêtre liste les autres lignes (avec leur prix éventuel), on coche celles qui sont des articles (article mal lu) et *Ajouter* les intègre à la liste. Elle reste accessible pendant la session par le bouton *N non reconnues* au-dessus de la liste.
- **Date d'achat** : celle du ticket si elle y figure, sinon la date choisie (aujourd'hui par défaut). Elle reste **modifiable au-dessus de la liste** (ticket saisi après coup, date absente ou mal lue) et s'applique à toutes les lignes en attente ; la date limite proposée au congélateur en tient compte.

**Liste en attente (« stock temporaire »)**

Les articles forment une liste **partagée par le foyer** : un membre peut importer le ticket et un autre le compléter plus tard, sur un autre appareil (le stock signale un ticket en cours). Si deux membres ajoutent la même ligne au stock en même temps, le second la saute dès que la synchronisation lui a appris qu'elle était déjà ajoutée (message « déjà ajoutée par un autre membre »). Pour chaque ligne :

| État | Signification |
|---|---|
| Reconnu | Libellé déjà associé à un produit par un membre du foyer : le produit est repris |
| Proposé, à vérifier | Pas d'association connue, mais un produit déjà acheté ressemble nettement au libellé |
| À compléter | Choisir parmi les produits **déjà achetés** proposés, **Chercher** un produit, **Scanner** l'article (produit du foyer ou Open Food Facts), ou créer un **Nouveau produit** (nom proposé d'après le libellé, unité, type) |
| Ignoré | Sac, consigne, article non alimentaire… (*Rétablir* pour annuler) |

- La comparaison des noms comprend les abréviations des tickets (« ECR » → écrémé, « PRES » → Président, « 1/2 » → demi) et s'appuie aussi sur les autres libellés déjà associés à un produit.
- Quantité modifiable (en kg pour un article pesé, convertie en grammes si le produit se compte en g), **prix payé** (lu sur le ticket, modifiable ou effaçable ; enregistré sur le lot pour l'historique des prix), péremption facultative, rangement (celui du dernier lot du produit, sinon le premier). Au congélateur, la date limite est proposée selon le type d'aliment, comme à l'ajout d'un produit.
- **Ajouter au stock** : crée un lot pour chaque ligne prête (et les nouveaux produits), puis les retire de la liste ; les lignes à compléter restent. Les associations libellé → produit, et les libellés ignorés, sont **mémorisées pour tout le foyer** : le ticket suivant les reconnaît, quel que soit le membre qui l'importe.
- **Tout effacer** vide la liste sans rien ajouter.

## 9. Sortie de stock et corrections

### Sortie (utilisé, jeté, offert)

Fenêtre **« Retirer du stock »** (nom de l'aliment en sous-titre ; nom de la recette en titre depuis *Je la cuisine*), ouverte par le bouton **−** du stock et de *À consommer*, ou par *Retirer* sur la fiche produit.

- **Raison** : Utilisé, Jeté ou Offert.
- Pour chaque lot : **Tout** ou une quantité (plafonnée au restant).
- **Date** : aujourd'hui par défaut, modifiable ; **note** facultative.
- Pour une recette, plusieurs lots sont listés avec une case à cocher.
- Toast avec **Annuler** ; une sortie reste annulable depuis l'historique du produit.

### Correction d'inventaire

Fiche produit → lot → *Modifier / corriger* :
- **quantité restante** : l'écart est enregistré comme un *ajustement de stock* (visible dans l'historique) ;
- rangement, date d'achat, date de péremption ;
- **transfert vers un congélateur** (depuis un rangement qui n'en est pas un) : le lot est considéré congelé le jour même, la date de péremption devient aujourd'hui + la durée de conservation du type ; revenir au rangement d'origine rétablit la date initiale ;
- **supprimer le lot** (erreur de saisie, annulable).

Un lot dont le restant atteint 0 disparaît du stock mais reste dans l'historique.

## 10. Idées (recherches)

Écran *Idées*, trois onglets. Les recettes proposées sont **les recettes du foyer** et **les recettes préférées de toutes les personnes du foyer** (goûts du compte + compléments du foyer).

### Recettes du foyer

Bouton **Recettes du foyer** (en-tête de l'écran *Idées*, avec leur nombre) : recettes **communes**, rattachées au foyer et à aucune personne particulière (ex. le plat du dimanche). La fenêtre les liste avec leur note ; *Nouvelle recette* et un appui sur une recette ouvrent la même fenêtre d'édition que pour une personne (nom, note, aliments, texte libre, suppression annulable). Tous les membres du foyer peuvent les modifier.

Dans les idées, une recette commune porte la mention « Recette du foyer » (icône maison) ; les allergies et aversions de toutes les personnes du foyer y sont signalées comme pour les autres recettes.

### Note des recettes

Chaque recette a une note de 0 à 5 étoiles, affichée sur les idées et dans les listes de recettes. Elle se donne dans la fenêtre d'édition, ou directement sur une idée dépliée (*Note* ; toucher l'étoile courante remet à 0). La note d'une recette du compte d'un autre membre n'est modifiable que par lui.

### Rapprochement aliment ↔ produit

Une préférence enregistrée avec un code-barres correspond d'abord au produit de même code-barres. Sinon, le rapprochement se fait par le nom, comme pour les aliments des recettes.


Un aliment de recette correspond à un produit en stock si ses mots significatifs se retrouvent dans le nom du produit (ou l'inverse), sans tenir compte des accents, des majuscules, du pluriel et des mots vides (« de », « bio », « frais »…). Exemples :

| Aliment de la recette | Produit en stock | Correspond |
|---|---|---|
| Tomates | Tomates cerises bio | ✅ |
| crème fraîche | Crème fraîche épaisse 30 % | ✅ |
| beurre doux | Beurre | ✅ |
| Pomme | Pomme de terre Charlotte | ❌ |
| gruyère râpé | Emmental râpé | ❌ |
| pâtes | Coquillettes (aliment : « Pâtes sèches ») | ✅ |

Le rapprochement se fait sur le nom du produit **et** sur son **aliment** (champ *Aliment (pour les recettes)* : « pâtes » pour « Coquillettes Panzani »), prérempli depuis les catégories Open Food Facts au scan.

Un aliment absent du stock mais parmi les **basiques du placard** du foyer (sel, poivre, huile…, voir § 13) est considéré disponible : « Huile » couvre « huile d'olive ».

**Quantités** : si l'aliment de la recette a une quantité et que l'unité est comparable avec celle du produit (g / kg, ml / cl / L, pièce ; sans unité = pièces), le stock restant est comparé à la quantité demandée. En quantité insuffisante, l'aliment est signalé (⚠ « pas assez : 200 g en stock ») et compte pour moitié dans la part des aliments disponibles.

### Onglet « Avec le stock »

Recettes dont au moins un aliment est en stock, classées par :
1. sans allergie d'abord ;
2. part des aliments disponibles (ex. 4/5) ;
3. note de la recette (étoiles) ;
4. nombre de personnes qui l'ont en favori ;
5. nombre d'aversions ;
6. urgence de péremption.

### Onglet « Anti-gaspi »

Recettes utilisant des aliments qui périment dans les 14 jours, classées par urgence. Points par aliment (lot le plus urgent) :

| Péremption | Points |
|---|---|
| Dépassée ou aujourd'hui | 5 |
| Demain | 4 |
| 2 à 3 jours | 3 |
| 4 à 7 jours | 2 |
| 8 à 14 jours | 1 |

### Détail d'une recette

- Aliments disponibles (avec le produit et le restant ; ⚠ si la quantité est insuffisante), basiques du placard, et aliments manquants (« à acheter », ou « dans la liste de courses ») ;
- **Ajouter aux courses (n)** : place dans la liste de courses les aliments manquants (avec la quantité de la recette) et les compléments des aliments insuffisants, sauf ceux déjà dans la liste. Annulable ;
- texte de préparation ;
- personnes qui l'aiment ; aversions et allergies signalées ;
- **Je la cuisine** : popin de sortie listant les lots correspondants, le plus urgent coché par aliment, avec la quantité de la recette convertie dans l'unité du produit si elles sont comparables (500 g → 0,5 kg ; sinon « Tout »). La recette est mémorisée dans l'historique.

### Onglet « À consommer »

Tous les lots avec une date de péremption, du plus proche au plus lointain, avec les avis des personnes (adore, n'aime pas…). Bouton **−** : sortie de ce seul aliment.

## 11. À commander

Écran *Courses* (navigation du foyer).

### Liste de courses

Liste libre partagée par le foyer, en tête de l'écran :
- alimentée par *Ajouter aux courses* d'une idée de recette (aliment, quantité, nom de la recette) ou par saisie libre (champ *Ajouter un aliment*, un aliment déjà présent n'est pas ajouté deux fois) ;
- bouton **✓ Acheté** : retire l'article de la liste (annulable).

### Produits à commander

Un produit peut être marqué **« À commander quand épuisé »** : interrupteur sur la fiche produit (enregistré immédiatement) ou dans la popin d'ajout. Il apparaît alors dans cet écran dès que son stock est inférieur ou égal à son seuil d'alerte (1 par défaut, modifiable dans *Modifier le produit* ; 0 pour ne le voir qu'une fois épuisé).

- Deux groupes : **En rupture** (plus rien) puis **Bientôt épuisés** (*Reste X*).
- Bouton **✓ Commandé** : le produit reste dans la liste, barré, avec *Commandé le <date>*, pour éviter de le commander deux fois. Annulable (bouton ↶).
- Le statut « commandé » disparaît de lui-même dès qu'un lot du produit est ajouté au stock après la commande.
- Bouton **+** : ajouter un lot (popin d'ajout sur ce produit).
- **Partager** : la liste de courses puis les produits non encore commandés (nom et marque), par le partage natif du téléphone ou copiée dans le presse-papiers.
- Toucher un produit ouvre sa fiche.

Sur la fiche produit, un encart *À commander* / *Commandé le …* propose les mêmes actions.

Indépendant des **Favoris à racheter** du bilan (fondés sur les étoiles).

## 12. Bilan

- **Chiffres clés** : produits en stock, lots périmant sous 3 jours, lots périmés.
- **Favoris à racheter** : produits notés d'au moins une étoile dont le stock est inférieur ou égal au seuil d'alerte (1 par défaut). *Rupture* si plus rien, sinon *Reste X*. Bouton **+** pour racheter.
- **Par rangement** : nombre de produits et de lots, périmés, à consommer vite, répartition par type d'aliment. Toucher un rangement ouvre le stock filtré.
- **30 derniers jours** : nombre de sorties utilisées, jetées, offertes.

## 13. Réglages du foyer

- **Nom du foyer**.
- **Basiques du placard** : aliments toujours considérés disponibles dans les idées de recettes (sel, poivre, huile…), sans être suivis dans le stock. Ajout par saisie ou par les suggestions (Sel, Poivre, Huile, Eau, Sucre, Farine, Vinaigre, Moutarde) ; retrait par la croix.
- **Rangements** (icône + libellé) et **types d'aliments** :
  - ajouter, renommer (toucher le libellé), changer l'icône (toucher l'icône), réordonner ;
  - retirer : l'élément est archivé (masqué des choix, conservé sur les produits existants), restaurable ;
  - le nombre d'utilisations est affiché ;
  - rangement : bouton thermomètre ❄ pour le marquer **congélateur** (un rangement nommé « Congélateur » ou à l'icône flocon l'est d'office à sa création) ;
  - type d'aliment : bouton flocon pour régler sa **durée de conservation au congélateur** (en mois, 0 = aucune).
- **Zone sensible** : *Supprimer le foyer* (propriétaire : stock, personnes et goûts du foyer supprimés pour tous ; les goûts de compte sont conservés) ou *Quitter le foyer* (membre).

## 14. Hors connexion

| Fonction | Hors connexion |
|---|---|
| Consulter, ajouter, retirer, corriger le stock | ✅ |
| Goûts, recettes, personnes, réglages | ✅ |
| Créer un foyer | ✅ |
| Scanner un code-barres | ✅ (lecture) |
| Ticket de caisse (PDF ou texte collé) | ✅ (lu sur l'appareil) |
| Recherche Open Food Facts | ❌ (saisie manuelle proposée) |
| Photos des produits | ✅ si déjà affichées une fois |
| Invitations, retrait d'accès, quitter un foyer | ❌ |
| Administration, profil | ❌ |

L'icône nuage de l'en-tête indique l'état : à jour, envoi en attente (nombre de modifications), synchronisation en cours, hors ligne, erreur. La toucher lance une synchronisation.

Quand une nouvelle version est disponible, un bandeau propose de mettre à jour (rechargement), pour ne pas perdre une saisie en cours.

## 15. Affichage mobile, tablette et PC

| | Mobile (< 768 px) | Tablette (768 à 1023 px) | PC (≥ 1024 px) |
|---|---|---|---|
| Navigation du foyer | Barre en bas (Stock, Idées, Courses, Bilan, Personnes, Réglages) | Barre en bas | Barre latérale à gauche, avec le nom du foyer et un retour à *Mes foyers* |
| Listes (foyers, stock, à commander, personnes, recettes, aliments à consommer) | 1 colonne | 2 colonnes | 2 colonnes (personnes : 3 sur grand écran) |
| Filtres de rangement du stock | Défilement horizontal | Passage à la ligne | Passage à la ligne |
| Ajout au stock | Boutons flottants *Ticket* / *+ Manuel* / *Scanner* | Boutons flottants | Boutons dans l'en-tête de la page |
| Ticket de caisse | 1 colonne, *Ajouter au stock* fixé en bas | Lignes sur 2 colonnes | Lignes sur 2 colonnes, bouton en fin de liste |
| Fiche produit | 1 colonne | 1 colonne | Informations et préférences du foyer à gauche (restent visibles au défilement), lots et historique à droite |
| Bilan | 1 colonne | Rangements sur 2 colonnes | Favoris et activité à gauche, rangements à droite |
| Réglages | 1 colonne | 1 colonne | Foyer, membres, zone sensible à gauche ; rangements et types à droite |
| Fiche personne, *Mes goûts* | 1 colonne | 1 colonne | Préférences et recettes côte à côte |
| Administration | 1 colonne | 1 colonne | Création d'invitation à gauche, liste à droite |

L'affichage mobile est la référence : les écrans plus larges réorganisent les mêmes éléments, sans fonction en plus ou en moins. Les popins (ajout, sortie de stock, recette…) sont identiques sur tous les écrans.

## 16. Plan des écrans

| Route | Écran |
|---|---|
| `/connexion` | Connexion, mot de passe oublié |
| `/inscription/<jeton>` | Création de compte sur invitation admin |
| `/nouveau-mot-de-passe` | Nouveau mot de passe |
| `/` | Mes foyers |
| `/mes-gouts` | Mes goûts et recettes |
| `/profil` | Mon profil |
| `/admin` | Invitations à l'application (administrateurs) |
| `/rejoindre/<jeton>` | Rejoindre un foyer |
| `/foyer/<id>` | Stock |
| `/foyer/<id>/produit/<id>` | Fiche produit |
| `/foyer/<id>/ticket` | Ticket de caisse |
| `/foyer/<id>/idees` | Idées |
| `/foyer/<id>/courses` | À commander |
| `/foyer/<id>/bilan` | Bilan |
| `/foyer/<id>/personnes` | Personnes |
| `/foyer/<id>/personnes/<id>` | Fiche d'une personne |
| `/foyer/<id>/reglages` | Réglages du foyer |
