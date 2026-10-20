# Kyara Bot — application de bureau Electron

Application de bureau (Windows / Linux / macOS) qui encapsule **le bot Kyara et son tableau de bord** :
un serveur local démarre en arrière-plan, l'interface de pilotage s'affiche dans une fenêtre native,
et le navigateur Chromium piloté par Playwright ouvre le site pour les ouvertures de boosters et les échanges.

> Projet personnel, non affilié à kyara.games. L'automatisation d'un site peut contrevenir à ses conditions
> d'utilisation : tu restes responsable de l'usage que tu en fais.

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

L'installateur n'est pas signé numériquement : Windows SmartScreen peut afficher un avertissement
(« Informations complémentaires » → « Exécuter quand même »). C'est normal pour un projet personnel.

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
5. Au lancement puis **toutes les 5 minutes**, l'application vérifie la dernière version publiée sur GitHub ;
   un bouton sticky apparaît en bas à droite du tableau de bord lorsqu'une mise à jour est disponible.

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
- Si une nouvelle version est publiée, un **bouton de mise à jour** sticky apparaît en bas à droite (vérification
  toutes les 5 minutes) et ouvre la page de téléchargement.
- Fermer la fenêtre **ne quitte pas** l'application : elle se réduit dans la zone de notification
  (icône ⚡) et le bot continue de tourner. Clic droit sur l'icône → **Quitter** pour tout arrêter.
- Les réglages sont enregistrés dans `data/config.json`.

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
- **Aide** : dépôt GitHub, à propos (versions Electron/Node/Chromium).

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

---

## Fabriquer l'installateur

```bash
npm run dist
```

Résultat dans `dist/` :

- `Kyara-Bot-Setup-1.1.0.exe` — installateur Windows (par utilisateur, sans admin)
- `Kyara-Bot-Portable-1.1.0.exe` — exécutable portable

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
git tag v1.1.0
git push origin v1.1.0
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
| SmartScreen bloque l'installateur | « Informations complémentaires » → « Exécuter quand même » (binaire non signé) |
| Antivirus signale l'application | Ajoute une exclusion pour le dossier d'installation et le dossier de données |
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
│  ├─ human.js          # clics « humanisés » (trajets souris, temporisations)
│  ├─ market.js         # estimation des prix / doublons
│  ├─ update.js         # vérification des Releases GitHub (lancement + toutes les 5 min)
│  ├─ store.js          # historiques JSONL
│  └─ config.js         # configuration + chemins de données (KYARA_HOME)
├─ public/index.html    # interface du tableau de bord
├─ build/               # KYARA BOT.svg + icônes générées + visuels du setup NSIS + scripts
└─ package.json         # scripts, dépendances et configuration electron-builder
```

`API.md` documente les routes de l'API Kyara et de l'API locale utilisées par le bot.

---

## Licence

Projet personnel fourni « tel quel », sans garantie. Aucune licence open source explicite n'est accordée :
le code est publié pour permettre l'installation et la modification par son auteur.
