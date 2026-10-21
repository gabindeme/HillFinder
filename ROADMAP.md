# Pistes d'amélioration

Idées pour la suite de HillFinder, classées par priorité.

**Déjà fait :** PWA installable et hors ligne, version française, profils LiDAR HD, données mobiles divisées par environ 3, partie la plus raide des longues côtes, escaliers, lieux récents.

## 1. Priorité haute : conformité et robustesse

Ces points comptent dès que l'app a de vrais utilisateurs.

- **Changer de fond de carte.** Les tuiles `tile.openstreetmap.org` ne sont pas prévues pour une app publique : leur [politique d'usage](https://operations.osmfoundation.org/policies/tiles/) limite l'usage intensif. Passer au style vectoriel OpenFreeMap (gratuit, sans clé, déjà utilisé pour les chemins) donnerait aussi une carte plus nette, plus légère et compatible avec un mode sombre.
- **Limiter la taille du cache.** IndexedDB ne fait aujourd'hui aucun ménage. Chaque nouvelle zone ajoute environ 20 Mo, ce qui peut saturer le stockage d'un téléphone. Il faut une limite globale qui supprime d'abord les données les plus anciennes, et un bouton « Vider le cache » dans les réglages.
- **Géocodage en production.** Nominatim public n'accepte qu'une requête par seconde pour toute l'app. Au-delà d'un petit nombre d'utilisateurs, passer à un service dédié (Photon, ou l'API Adresse de l'État, gratuite et très bonne pour la France) ou héberger son propre Nominatim.
- **Prévoir les quotas IGN.** Les services de la Géoplateforme sont gratuits mais pas illimités. Il faut surveiller les erreurs 429, réessayer en douceur, et éventuellement pré-calculer les villes populaires.

## 2. Sur le terrain

- **Mode séance.** Compteur de répétitions et chrono à la côte, avec le GPS pour détecter le bas et le haut de la côte, l'allure et la pente en direct, et un signal sonore ou une vibration à chaque répétition. Garder l'écran allumé pendant la séance.
- **Envoi vers la montre.** Exporter la séance en fichier d'entraînement FIT (COROS, Garmin, Suunto), et exporter le tracé de la côte en GPX pour le suivre sur la montre.
- **Temps de répétition personnalisés.** Utiliser les allures réelles (import Strava ou COROS, ou simple saisie de l'allure 10 km) à la place de l'effort « soutenu » générique. Dans l'app, cela demande une connexion OAuth et un petit serveur.
- **Partager une côte.** Un lien direct vers une côte (`…/HillFinder/#climb=lat,lon,lat,lon`) pour l'envoyer à son club ou à un partenaire.

## 3. Données et précision

- **Hors de France.** Ajouter un relief mondial de secours (Copernicus GLO-30 ou tuiles Terrarium, environ 30 m) avec un avertissement clair sur la précision. Le LiDAR HD reste utilisé en France.
- **Vrais temps de trajet.** Calculer les itinéraires à pied ou à vélo (OSRM, GraphHopper ou Valhalla) au lieu de l'estimation « distance × 1,3 ».
- **Mode Rapide plus riche.** Récupérer l'éclairage, les horaires et les barrières par une petite requête Overpass limitée aux côtes affichées, pour avoir le meilleur des deux sources sans tout télécharger. Retrouver les noms des parcs à partir des zones de parc (`landcover`) croisées avec les points d'intérêt.
- **Horaires d'ouverture interprétés.** Utiliser la bibliothèque `opening_hours` pour dire « ouvert maintenant » ou « ferme à 20 h 30 » plutôt que d'afficher le texte brut. Proposer un filtre « ouvert à l'heure de ma séance ».
- **Noms en bon français.** « près de l'allée Jeanne Guillon » plutôt que « près de Allée Jeanne Guillon » : élision et article selon le type de voie (rue, allée, avenue…).
- **Profils encore plus fiables.**
  - Repérer les échantillons isolés et aberrants dans le LiDAR, par exemple au passage sous un pont non tagué.
  - Ajouter des coupes transversales (±3 m de part et d'autre du chemin) pour détecter les murs et talus.
  - Proposer aux utilisateurs de confirmer ou corriger une côte.

## 4. Confort d'utilisation

- **Mode sombre**, plus pratique pour courir le soir. Il dépend du passage au fond de carte vectoriel.
- **Accessibilité.** Audit complet : lecteur d'écran sur la carte et le profil, contraste, navigation au clavier. Proposer une description textuelle du profil (« monte doucement puis 80 m à 12 % »).
- **Comparer des côtes.** Afficher deux ou trois profils superposés.
- **Retours des coureurs.** Votes « top pour le fractionné » ou « impraticable », et photos. Cela nécessite un serveur ; à garder pour plus tard.

## 5. Technique

- **Tests de bout en bout dans la CI.** Les scénarios Playwright lancés à la main pendant le développement (recherche, filtres, favoris, hors ligne, français) pourraient tourner sur chaque push, avec des réponses réseau simulées pour ne pas dépendre des services publics.
- **Lighthouse CI.** Suivre le poids, les performances et l'accessibilité à chaque déploiement.
- **Pré-calcul statique.** Générer à l'avance les côtes des grandes villes et les publier sur GitHub Pages : la première recherche y serait instantanée.
- **Remontée d'erreurs.** Journaliser les échecs des services publics (Overpass, IGN, Nominatim) pour savoir ce qui casse réellement.
- **Notes de version** affichées dans l'app après une mise à jour.
