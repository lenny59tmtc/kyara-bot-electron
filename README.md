# Kyara Bot — application de bureau Electron

Application de bureau (Windows / Linux / macOS) qui encapsule **le bot Kyara et son tableau de bord** :
un serveur local démarre en arrière-plan, l'interface de pilotage s'affiche dans une fenêtre native,
et le navigateur Chromium piloté par Playwright ouvre le site pour les ouvertures de boosters et les échanges.

> Projet personnel, non affilié à kyara.games. L'automatisation d'un site peut contrevenir à ses conditions
> d'utilisation : tu restes responsable de l'usage que tu en fais.

## Nouveautés de la version 1.8.0

- **Vente automatique par valeur décroissante** : les doublons sont vendus **de la carte qui rapporte le plus de
  chakra à la moins rentable**, selon le prix calculé par la stratégie choisie (`Vite`, `Normal`, `Patient`).
- L'ordre est recalculé à chaque scan : les cartes les plus rentables passent toujours en premier.
- À **valeur égale**, l'ordre reste mélangé pour ne pas être parfaitement déterministe ; le mode discret
  (pauses, sessions, activité souris) reste actif.

## Nouveautés de la version 1.7.2

- **Correction de la version affichée par le bouton de mise à jour** : le bouton prend désormais la version la plus
  récente entre la dernière Release GitHub et l'état de l'auto-update, au lieu de se fier à un état périmé.
- Un état auto-update écrit par une **version précédente** est ignoré (assaini côté serveur), et un téléchargement
  obsolète n'est plus installé : le bouton affiche toujours la version réellement proposée.
- Cas couverts : état « idle » périmé, téléchargement d'une ancienne version, mise à jour déjà installée.

## Nouveautés de la version 1.7.1

- **Ouverture automatique désactivée par défaut** (`autoOpen: false`). Les configurations existantes sont migrées
  une seule fois vers ce nouveau défaut ; l'option peut être réactivée dans **Ouvertures → Configuration des ouvertures**.
- **Option « Vérifier les mises à jour »** dans le panneau **Mises à jour** de l'onglet Ouvertures : vérifie
  immédiatement la dernière Release, indique la version installée et le résultat (« à jour » ou « mise à jour vX
  disponible »). Le bouton d'installation apparaît le cas échéant.
- Nouvel endpoint `POST /api/update/check`.

## Nouveautés de la version 1.7.0

- **Nouvel onglet « Séries »** : albums d'anime avec cartes possédées / total, progression, exemplaires et
  répartition par rareté.
- **Tri croissant par nombre de cartes possédées** (aussi tri par taille d'album, complétion ou nom).
- **Filtres** : possédées (≥ 1), **≥ 5 cartes possédées**, albums de ≥ 5 cartes, **complétés**, **non complétés**,
  toutes les séries — plus une recherche par nom.
- Compteurs : albums affichés, complétés, cartes uniques possédées, exemplaires.
- API : `GET /api/series` (lecture collection + catalogue, sans requête marché).

## Nouveautés de la version 1.6.1

- **Limite de 10 annonces actives** : le moteur de vente ne tente **aucune nouvelle vente** lorsque les
  annonces actives ont atteint la limite du compte (10 par défaut, valeur lue dans `marketLimits`). Le compteur
  local est incrémenté après chaque mise en vente et le prochain scan vérifie la valeur réelle.
- **Comptage des annonces actives corrigé** : les annonces sont lues directement dans `/me/market`
  (`isMine` + `status === "active"`), avec cache court et invalidation après vente. Le nombre exact est exposé dans
  `/api/sales` (`market.activeListings`, `market.maxListings`) et dans l'analyse (`/api/duplicates`).
- **Dashboard** : carte « Annonces actives » au format `X / 10`, compteur aussi affiché dans l'onglet Doublons ;
  statut « limite d'annonces actives atteinte » dans le suivi de la vente automatique.

## Nouveautés de la version 1.6.0

- **Mise à jour avant démarrage** : au lancement, l'application vérifie les mises à jour **avant** de démarrer le
  serveur et l'interface. Si une version est trouvée, elle est téléchargée (progression sur l'écran de démarrage)
  puis installée immédiatement ; l'application redémarre ensuite sur la nouvelle version.
- **Bouton de mise à jour réellement actif** : le bouton sticky ne redirige plus vers GitHub ; il lance le
  téléchargement puis l'installation (« Installer la mise à jour », « Installer et redémarrer »).
- **Réglages répartis par onglet** : les paramètres d'ouverture sont dans **Ouvertures**, les réglages de vente
  manuelle dans **Doublons à vendre**, la vente automatique dans **Ventes & bilan**, les échanges dans **Échanges**.
  Chaque section a son propre bouton Enregistrer ; plus de bouton « Configurer la vente ».

## Nouveautés de la version 1.5.1

- **Analyse de marché sans rate limit** : les prix proviennent directement de `/me/collection` (médianes et
  dernière vente). Les centaines de requêtes `/market/listings` par personnage ont été supprimées : l'analyse
  prend environ 1 seconde, même avec des centaines de doublons, et peut donc alimenter la vente auto.
- **Mode discret de vente auto (activé par défaut)** : pauses humaines aléatoires (plancher 25 s), ordre des
  annonces mélangé, activité souris/scroll, variation de prix ±3 %, sessions limitées à 2–6 annonces puis pause
  de 2 à 7 minutes — pour éviter les schémas réguliers détectables.
- **Résumé corrigé** : « Cartes en trop » compte désormais les exemplaires réellement en trop (et non la quantité totale).
- Le panneau Ventes & bilan indique le mode discret actif.

## Nouveautés de la version 1.5.0

- **Analyse de marché fiabilisée** : la page est vérifiée/ramenée sur `kyara.games` avant l'analyse, les erreurs
  `rate_limited` sont gérées avec un backoff global, le cache marché expire réellement (3 min) et l'analyse
  est moins agressive (2 requêtes parallèles, étalement des appels).
- **Chromium ne se ferme plus sur une erreur transitoire** : le bot conserve le navigateur en cas de limitation
  API, détecte sa fermeture/crash et le relance automatiquement ; nouvel endpoint et bouton **« Relancer Chromium »**.
- **Ergonomie du tableau de bord** : messages d'erreur contextuels (connexion requise, limite API, Chromium fermé),
  progression de l'analyse en secondes, compte à rebours avant nouvelle analyse, bannière système, indicateur
  « API limitée », onglet actif mémorisé dans l'URL et indicateur de configuration non enregistrée.
- **Aucune fermeture de page** sur erreur API : les pages/contextes ne sont recréés qu'en cas de fermeture réelle.

## Nouveautés de la version 1.4.1

- **Correction du démarrage** : la boucle de veille de la vente automatique pouvait s'exécuter sans pause lorsque
  la fonctionnalité était désactivée (par défaut), bloquant l'event loop du serveur local et provoquant l'erreur
  « Le serveur local n'a pas démarré à temps ». La boucle respecte désormais une temporisation.
- **Démarrage plus robuste** : le serveur HTTP répond avant le lancement du bot ; nettoyage des verrous/profils
  Chromium résiduels après une mise à jour ; récupération automatique du profil si Chromium reste bloqué.
- **Dialogue d'erreur amélioré** : extrait du journal du serveur + boutons « Réessayer » / « Ouvrir le journal ».

## Nouveautés de la version 1.4.0

- **Vente automatique des doublons**, **désactivée par défaut**, avec réglages dans l'onglet **Ventes & bilan** :
  rareté maximale à vendre, stratégie de prix (Vite / Normal / Patient) et délai aléatoire min/max entre deux ventes.
- **Bilan chakra** dans un nouvel onglet **Ventes & bilan** : chakra gagné sur 24 h / 60 min / moyenne par heure,
  graphique des 24 dernières heures, ventes récentes et journal des ventes.
- Le moteur détecte les annonces réellement **soldées** (`/me/market`) pour compter le chakra gagné, y compris les
  ventes manuelles.
- **Interface responsive** : onglets, badges, tableaux et graphiques adaptés aux écrans mobiles/tablettes.

## Nouveautés de la version 1.3.0

- **Mise à jour automatique** : `electron-updater` vérifie les Releases au lancement puis toutes les 4 h,
  **télécharge la mise à jour en arrière-plan** et l'installe automatiquement à la fermeture de l'application.
- **Progression dans le tableau de bord** : bouton sticky « Téléchargement… 42 % » puis
  « Mise à jour prête — Redémarrer », et état repris dans la barre de version en bas de page.
- **Redémarrage en un clic** : le bouton prévient le processus principal, qui installe la mise à jour et relance l'app.
- **Menu Aide → Rechercher une mise à jour** pour forcer une vérification.
- **Manifeste `latest.yml`** publié et recalculé après signature pour que le hash corresponde à l'installateur signé.

## Nouveautés de la version 1.2.1

- **Guide SmartScreen complet** ([SMARTSCREEN.md](SMARTSCREEN.md)) : pourquoi Windows bloque, contournements
  immédiats (déblocage, ZIP) et solutions durables (certificat EV/OV, Azure Trusted Signing).
- **Distribution ZIP** `Kyara-Bot-<version>-win-x64.zip` : débloque l'archive **avant** extraction pour éviter
  la marque Mark-of-the-Web sur les fichiers extraits.
- **Script d'aide** `scripts/fix-smartscreen.ps1` : déblocage fichier/dossier, installation des certificats,
  exclusion Defender optionnelle.
- **CI signable avec un vrai certificat** : secrets `WINDOWS_CSC_LINK` / `WINDOWS_CSC_KEY_PASSWORD`
  (certificat OV/EV) ou variables `AZURE_*` (Azure Trusted Signing) — signature automatique des builds.

## Nouveautés de la version 1.2.0

- **Exécutables signés** : application, installateur et version portable embarquent une signature Authenticode
  (chaîne « Kyara Bot Root CA » → certificat « Kyara Bot ») et une **licence EULA** affichée par l'installateur.
- **Version courante affichée en pied de page** du tableau de bord, avec le statut des mises à jour.
- Certificats publics fournis (`build/kyara-bot-root-ca.cer` et `build/kyara-bot-codesign.cer`) +
  script d'installation pour faire confiance à l'éditeur sur un PC.

## Nouveautés de la version 1.1.0

- **Mise à jour automatique** : vérification de la dernière Release GitHub au lancement puis toutes les 5 minutes ;
  un bouton sticky « Mise à jour disponible » apparaît en bas à droite du tableau de bord.
- **Connexion Discord obligatoire au premier démarrage** : les comptes invités créés automatiquement par le site
  sont détectés, l'automatisation reste en pause et l'application ouvre la connexion Discord dans Chromium.
- **Ouverture automatique commutable** : nouveau réglage pour activer ou désactiver les ouvertures de boosters.
- **Échanges automatiques désactivés par défaut** et désactivation automatique lorsqu'aucun doublon n'est présent
  sur le compte.
- **Interface et écran de setup** aux couleurs du logo (palette rose) : icône de l'application dans le splash et
  dans le programme d'installation (sidebar, en-tête, icônes, couleurs de texte).

---

## Sommaire

- [Téléchargement](#téléchargement)
- [Installation (utilisateur final)](#installation-utilisateur-final)
- [Premier démarrage et connexion](#premier-démarrage-et-connexion)
- [Vente automatique des doublons et bilan chakra](#vente-automatique-des-doublons-et-bilan-chakra)
- [Signature Windows et Defender](#signature-windows-et-defender)
- [Où sont stockées les données](#où-sont-stockées-les-données)
- [Menu et barre de notification](#menu-et-barre-de-notification)
- [Installation depuis les sources](#installation-depuis-les-sources)
- [Fabriquer l'installateur](#fabriquer-linstallateur)
- [Publier une nouvelle version](#publier-une-nouvelle-version)
- [Migration depuis l'ancienne version (dossier `bot kyara`)](#migration-depuis-lancienne-version-dossier-bot-kyara)
- [Dépannage](#dépannage)
- [Structure du dépôt](#structure-du-dépôt)

---

## Téléchargement

Les binaires sont publiés dans **[Releases](https://github.com/lenny59tmtc/kyara-bot-electron/releases)** :

| Fichier | Description |
|---|---|
| `Kyara-Bot-Setup-<version>.exe` | Installateur Windows (installation par utilisateur, sans droits admin) |
| `Kyara-Bot-Portable-<version>.exe` | Version portable Windows (aucune installation) |
| `Kyara-Bot-<version>-win-x64.zip` | Version ZIP (à débloquer avant extraction si SmartScreen bloque) |
| `kyara-bot-root-ca.cer` / `kyara-bot-codesign.cer` | Certificats publics pour faire reconnaître l'éditeur |
| `SHA256SUMS.txt` | Empreintes SHA-256 des fichiers publiés |

Le certificat utilisé par défaut est **auto-signé** : il identifie l'éditeur mais ne suffit pas toujours à
supprimer SmartScreen. Pour un contournement immédiat, la Release fournit aussi un **ZIP** : télécharge-le,
débloque-le (clic droit → Propriétés → Débloquer) **avant** de l'extraire, puis lance `Kyara Bot.exe`.
Toutes les solutions (ZIP, certificats, exclusion Defender, Azure Trusted Signing, EV/OV) sont détaillées
dans [SMARTSCREEN.md](SMARTSCREEN.md).

---

## Installation (utilisateur final)

### Windows 10/11

1. Télécharge `Kyara-Bot-Setup-<version>.exe` depuis la page **Releases**.
2. Double-clique dessus, puis suis l'assistant (dossier d'installation modifiable, raccourcis créés).
   L'installation se fait **par utilisateur**, aucun droit administrateur n'est nécessaire.
3. Lance **Kyara Bot** depuis le menu Démarrer ou le raccourci bureau.

### Premier lancement (automatique)

1. Une fenêtre de démarrage s'ouvre ; au tout premier lancement, l'application **télécharge Chromium**
   (~150 Mo) dans son dossier de données. Une connexion Internet est donc nécessaire la première fois.
2. Le tableau de bord s'affiche dès que le serveur local est prêt.
3. Le bot démarre automatiquement et ouvre une fenêtre Chromium sur `kyara.games`.
4. Si le site crée automatiquement un **compte invité**, l'application le détecte : les automatismes restent en
   pause et la fenêtre Chromium est amenée sur la **connexion Discord** (bouton « Se connecter » du tableau de bord
   pour la relancer).
5. Au lancement puis **toutes les 4 heures**, l'application vérifie les mises à jour et **télécharge automatiquement**
   la nouvelle version en arrière-plan ; la progression s'affiche en bas à droite du tableau de bord.

### Se connecter à Kyara

Tant qu'aucun compte Discord n'est connecté, le journal affiche un avertissement et la fenêtre Chromium reste
ouverte : termine la connexion Discord dans cette fenêtre (le bouton « Se connecter » du tableau de bord ouvre
automatiquement le menu de connexion du site). Dès que la session est détectée, le bot reprend
automatiquement (vérification toutes les 5 secondes). Le profil est conservé : tu n'auras à te reconnecter
que si la session expire.

### Utilisation quotidienne

- Le **tableau de bord** permet de démarrer/arrêter le bot, suivre les ouvertures, les échanges, les doublons
  et les réglages (`Vérifier toutes les X secondes`, ouverture automatique, multi-ouvertures, échanges…).
- Le réglage **« Ouverture automatique des boosters »** permet de suspendre/relancer les ouvertures sans arrêter le bot.
- Les **échanges automatiques sont désactivés par défaut** ; ils se désactivent aussi automatiquement si le compte
  ne contient plus aucun doublon. Active-les depuis l'onglet **Échanges**.
- La **vente automatique des doublons est désactivée par défaut** : active-la dans l'onglet **Ventes & bilan**
  (rareté max, stratégie de prix, délai aléatoire, mode discret).
- La **mise à jour est automatique** : téléchargement en arrière-plan puis installation à la fermeture, ou
  clic sur « Mise à jour prête — Redémarrer » pour l'installer immédiatement.
- Fermer la fenêtre **ne quitte pas** l'application : elle se réduit dans la zone de notification
  (icône ⚡) et le bot continue de tourner. Clic droit sur l'icône → **Quitter** pour tout arrêter.
- Les réglages sont enregistrés dans `data/config.json`.
- La **version courante** est affichée en pied de page, avec l'état de la vérification des mises à jour.

### Mise à jour automatique

- **Au lancement**, l'application vérifie les mises à jour **avant** de démarrer le serveur et l'interface.
  Si une version est disponible, elle est téléchargée (progression sur l'écran de démarrage) puis installée
  immédiatement ; l'application redémarre ensuite sur la nouvelle version.
- Pendant l'utilisation, une vérification est refaite toutes les 4 h et le téléchargement se fait en arrière-plan.
- Le **bouton sticky** permet de lancer réellement l'installation (« Installer la mise à jour » /
  « Installer et redémarrer ») ; il ne redirige plus vers GitHub.
- Une fois téléchargée, l'installation peut aussi se faire automatiquement à la fermeture
  (`autoInstallOnAppQuit`).
- Les versions **portable** et **ZIP** ne peuvent pas s'auto-remplacer : le bouton est masqué et la barre du bas
  indique qu'une installation manuelle est nécessaire.
- Journaux : `logs/updater.log`. Chaque Release publie `latest.yml` (manifeste de mise à jour).

---

## Vente automatique des doublons et bilan chakra

La vente automatique est **désactivée par défaut**. Elle se configure dans l'onglet **Ventes & bilan**,
panneau **Réglages de la vente automatique** :

| Réglage | Valeur par défaut | Description |
|---|---|---|
| Vente automatique activée | **désactivée** | Interrupteur principal |
| Rareté maximale des doublons | **Rare** | Vend les doublons jusqu'à cette rareté (Commun → Mythique) |
| Stratégie de prix | **Normal** | `Vite` = 75 % du prix conseillé, `Normal` = prix conseillé, `Patient` = médiane +8 % |
| Mode discret (anti-détection) | **activé** | Pauses humaines, ordre aléatoire, souris/scroll, prix ±3 %, sessions limitées et pauses longues |
| Délai aléatoire entre deux ventes | **30 à 90 s** | Min/max en secondes (5–600) ; en mode discret, plancher de 25 s et pauses supplémentaires |
| Type / durée d'annonce | vente directe, 12 h | Réutilise les réglages existants |

Fonctionnement :

- Le moteur (`src/seller.js`) analyse la collection et le marché, ne garde que les doublons **vendables** dans la
  limite de rareté, puis met un doublon en vente à la fois avec un délai aléatoire entre chaque annonce.
- Les annonces `status: "sold"` sont détectées via `/me/market` : le chakra **réellement gagné** est enregistré dans
  `data/sales.jsonl` (la première analyse mémorise les ventes déjà soldées pour ne pas fausser le bilan).
- L'onglet **Ventes & bilan** affiche : chakra gagné sur 24 h, chakra/h (60 min), moyenne horaire sur 24 h, total,
  ventes soldées, annonces actives, chakra en attente, un graphique des 24 dernières heures et les ventes récentes.
- Les ventes manuelles depuis l'onglet **Doublons à vendre** alimentent aussi le bilan.

---

## Signature Windows et Defender

Les binaires Windows sont signés (Authenticode) avec la chaîne **Kyara Bot Root CA → Kyara Bot**
(`CN=Kyara Bot, O=Kyara Bot, C=FR`) : `Kyara Bot.exe`, l'installateur et la version portable.
La signature est horodatée lorsque le serveur de timestamp est joignable.

Pour que Windows identifie l'éditeur sur un PC :

1. Télécharge `kyara-bot-root-ca.cer` et `kyara-bot-codesign.cer` depuis la Release (ou depuis `build/`).
2. Clic droit sur `kyara-bot-root-ca.cer` → **Installer le certificat** → **Utilisateur actuel** →
   **Placer tous les certificats dans le magasin suivant** → **Autorités de certification racines de confiance**.
3. Clique droit sur `kyara-bot-codesign.cer` → même assistant → **Éditeurs approuvés**.
4. Ou lance le script fourni (magasin utilisateur, sans administrateur ; `-Machine` pour tous les utilisateurs) :

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\install-code-signing-cert.ps1
   ```

**Limites importantes** : le certificat est **auto-signé**. Il atteste de l'éditeur mais ne remplace pas une
signature **EV/OV** délivrée par une autorité reconnue : SmartScreen peut donc encore afficher un avertissement
tant que le binaire n'a pas acquis de réputation. Si Windows Defender bloque le fichier :

- clic droit sur l'exe → Propriétés → cocher **Débloquer** ;
- Windows → Sécurité → Protection contre les virus → **Exclusions** → ajouter le dossier d'installation ou de données ;
- signaler le faux positif à Microsoft ([aka.ms/wdsi](https://www.microsoft.com/en-us/wdsi/filesubmission)).

Les développeurs peuvent signer une build locale via les variables `CSC_LINK` (chemin du `.pfx`) et
`CSC_KEY_PASSWORD` avant `npm run dist` ; le certificat privé est stocké dans `.secrets/` (ignoré par Git).

---

## Où sont stockées les données

| Élément | Windows | Linux | macOS |
|---|---|---|---|
| Données du bot (config, historique, profil Chromium) | `%APPDATA%\Kyara Bot\home` | `~/.config/Kyara Bot/home` | `~/Library/Application Support/Kyara Bot/home` |
| Navigateur Chromium de Playwright | `%APPDATA%\Kyara Bot\playwright-browsers` | idem/home du dessus | idem |
| Journal du serveur | `%APPDATA%\Kyara Bot\logs\server.log` | idem | idem |

Le dossier `home` contient :

```text
home/
├─ data/
│  ├─ config.json      # réglages du dashboard
│  ├─ history.jsonl    # ouvertures de boosters
│  ├─ batches.jsonl    # comptes rendus des multi-ouvertures
│  ├─ trades.jsonl     # échanges acceptés
│  └─ catalog.json     # cache du catalogue des cartes
└─ profile/            # session Chromium persistante (cookies, connexion Kyara)
```

En mode développement (`npm start` / `npm run bot`), c'est le dossier du projet qui sert de `home`
(comportement identique à l'ancienne version).

---

## Menu et barre de notification

- **Fichier** : ouvrir le tableau de bord dans le navigateur, dossier de données, journal, quitter.
- **Bot** : redémarrer le serveur + le bot, réinstaller le navigateur Chromium (utile en cas de corruption).
- **Affichage** : recharger, outils de développement, zoom, plein écran.
- **Aide** : dépôt GitHub, **Rechercher une mise à jour**, page des Releases, à propos (versions Electron/Node/Chromium).

---

## Installation depuis les sources

### Prérequis

- **Node.js ≥ 22.12** (LTS recommandé) et npm — [nodejs.org](https://nodejs.org/fr)
- **Git**
- Windows 10/11 (installation/build testés en priorité) ; Linux et macOS supportés pour le build,
  mais la version Linux nécessite les bibliothèques Chromium (`libnss3`, `libgtk-3-0`, `libasound2`, …).

### Développement

```bash
git clone https://github.com/lenny59tmtc/kyara-bot-electron.git
cd kyara-bot-electron
npm install                       # installe les dépendances + télécharge Electron
npx playwright install chromium   # télécharge le navigateur piloté par le bot
npm start
```

`npm install` exécute un `postinstall` qui télécharge le binaire Electron (~120 Mo).
Le Chromium de Playwright utilisé en développement se télécharge séparément avec
`npx playwright install chromium`. Si le téléchargement d'Electron est bloqué (proxy/antivirus),
relance-le avec `node node_modules/electron/install.js`.

Autres commandes utiles :

| Commande | Effet |
|---|---|
| `npm start` | Lance l'application Electron complète (dashboard + bot) |
| `npm run bot` | Lance uniquement le serveur + bot en ligne de commande (ancien `lancer.bat`) |
| `npm run dashboard` | Lance uniquement le serveur du tableau de bord |
| `npm run dist` | Construit l'installateur **NSIS** et la version **portable** Windows dans `dist/` |
| `npm run pack` | Construit une version non empaquetée (`dist/win-unpacked/`) pour tester vite |
| `npm run icons` | Régénère `build/icon.png` depuis `build/KYARA BOT.svg` (Playwright) |
| `npm run icons:ico` | Régénère `build/icon.ico` (Pillow requis) |
| `npm run icons:nsis` | Régénère les visuels du programme d'installation (sidebar/en-tête, Pillow requis) |
| `npm run smartscreen` | Débloque un fichier/dossier et aide à contourner SmartScreen (voir [SMARTSCREEN.md](SMARTSCREEN.md)) |
| `npm run fix:latest` | Recalcule `dist/latest.yml` après signature de l'installateur (hash/taille) |

---

## Fabriquer l'installateur

```bash
npm run dist
```

Résultat dans `dist/` :

- `Kyara-Bot-Setup-1.8.0.exe` — installateur Windows (par utilisateur, sans admin)
- `Kyara-Bot-Portable-1.8.0.exe` — exécutable portable
- `Kyara-Bot-1.8.0-win-x64.zip` — version ZIP (débloquer avant extraction)
- `latest.yml` — manifeste utilisé par la mise à jour automatique

Après signature manuelle de l'installateur, relance `npm run fix:latest` : le hash SHA-512 et la taille de
`latest.yml` sont recalculés pour correspondre au Setup signé (sinon `electron-updater` refuse la mise à jour).

L'icône de l'application est générée depuis `build/KYARA BOT.svg` : `npm run icons` rend le PNG
(`build/icon.png`, 1024×1024 via Playwright/Chromium) puis `python build/make-ico.py` produit l'ICO
multi-tailles (`build/icon.ico`, Pillow requis). Les visuels du **programme d'installation** (sidebar,
en-tête, icônes et couleurs de texte) sont générés par `python build/make-nsis-assets.py` depuis
`build/icon.png` et déclarés dans `build/installer.nsh`.

> Pour publier directement sur GitHub : `GH_TOKEN=<ton token> npx electron-builder --win --publish always`
> (voir aussi le workflow CI ci-dessous).

---

## Publier une nouvelle version

Le workflow GitHub Actions [`.github/workflows/build.yml`](.github/workflows/build.yml) construit
automatiquement l'installateur et la version portable, puis les attache à une Release GitHub lorsque
tu pousses un tag :

```bash
git tag v1.8.0
git push origin v1.8.0
```

---

## Migration depuis l'ancienne version (dossier `bot kyara`)

1. Ferme l'ancien bot (`Ctrl+C` dans la console ou ferme la fenêtre).
2. Ouvre `%APPDATA%\Kyara Bot` (crée le dossier s'il n'existe pas) puis crée le sous-dossier `home`.
3. Copie l'ancien dossier `data` et l'ancien dossier `profile` **dans** `%APPDATA%\Kyara Bot\home`.
4. Lance Kyara Bot : la configuration, l'historique et la session Kyara seront conservés.

---

## Dépannage

| Symptôme | Solution |
|---|---|
| « Le serveur local n'a pas démarré à temps » | Ouvre le journal `logs/server.log` ; relance l'app ; vérifie qu'un antivirus ne bloque pas Node/Electron |
| Electron ne démarre pas après `npm install` | Le binaire n'a pas été téléchargé : `node node_modules/electron/install.js` |
| Le téléchargement de Chromium échoue | Vérifie la connexion/proxy, puis menu **Bot → Réinstaller le navigateur Chromium** (ou `npx playwright install chromium` en dev) |
| Le bot reste « non connecté » | Connecte-toi dans la fenêtre Chromium ouverte sur kyara.games (le bot reprend ensuite tout seul) |
| SmartScreen bloque l'installateur | Le binaire est signé mais le certificat est auto-signé : installe `build/kyara-bot-codesign.cer` (voir [Signature Windows et Defender](#signature-windows-et-defender)) ou « Informations complémentaires » → « Exécuter quand même » |
| Defender bloque l'application | Propriétés du fichier → **Débloquer** ; ajoute une exclusion pour le dossier d'installation ou signale le faux positif à Microsoft |
| « API limitée » / analyse de marché bloquée | Attends la fin du compte à rebours : le bot applique un backoff global et conserve Chromium. Relance l'analyse ensuite. |
| Chromium est fermé / ne répond plus | Le bot le détecte et le relance automatiquement ; bouton **Relancer Chromium** dans l'onglet **Doublons à vendre**. |
| Linux : l'app ne se lance pas | Installe les dépendances Chromium : `sudo apt install libnss3 libatk-bridge2.0-0 libgtk-3-0 libasound2` |
| Filtres d'échanges instables | Le moteur réessaie automatiquement ; les temporisations sont dans `src/trades.js` |

---

## Structure du dépôt

```text
.
├─ electron/
│  ├─ main.cjs          # processus principal Electron (spawn du serveur, fenêtre, tray, menus)
│  └─ splash.html       # écran de démarrage / progression du téléchargement Chromium
├─ src/
│  ├─ index.js          # point d'entrée serveur local + bot
│  ├─ server.js         # API locale + tableau de bord (http://127.0.0.1:<port>)
│  ├─ bot.js            # boucle d'ouverture de boosters (Playwright)
│  ├─ trades.js         # moteur d'échanges sur /marche?onglet=offres
│  ├─ seller.js         # vente automatique des doublons (rareté, pricing, délai aléatoire)
│  ├─ human.js          # clics « humanisés » (trajets souris, temporisations)
│  ├─ market.js         # estimation des prix / doublons
│  ├─ update.js         # vérification GitHub + état de la mise à jour automatique (electron-updater)
│  ├─ store.js          # historiques JSONL (ouvertures, échanges, ventes, stats chakra)
│  └─ config.js         # configuration + chemins de données (KYARA_HOME)
├─ public/index.html    # interface responsive : onglets, vente auto, bilan chakra, mises à jour
├─ scripts/
│  ├─ install-code-signing-cert.ps1  # installe les certificats publics de signature
│  ├─ sign-windows.ps1               # signe les builds locaux
│  ├─ fix-smartscreen.ps1            # déblocage / aide SmartScreen
│  ├─ fix-latest-yml.mjs             # recalcule latest.yml après signature de l'installateur
│  └─ configure-azure-signing.mjs    # active Azure Trusted Signing en CI si configuré
├─ build/               # KYARA BOT.svg, icônes, visuels NSIS, certificats publics, app-update.yml
├─ LICENSE.txt          # licence d'utilisation (EULA, affichée par l'installateur)
├─ SMARTSCREEN.md       # guide complet SmartScreen / Defender (contournements et certificats)
└─ package.json         # scripts, dépendances et configuration electron-builder
```

`API.md` documente les routes de l'API Kyara et de l'API locale utilisées par le bot.

---

## Licence

Le Logiciel est distribué sous la **licence d'utilisation personnelle** fournie dans
[LICENSE.txt](LICENSE.txt) : usage personnel, pas de revente, absence de garantie, non-affiliation à
kyara.games. Cette licence est également affichée par le programme d'installation et incluse dans l'application.
