# API Kyara (kyara.games) — routes relevées

> Routes observées dans le code client du site (`_app/immutable/chunks/sBqbXzV6.js`).
> Base : `https://kyara.games/api` — toutes les routes ci-dessous sont préfixées par `/api`.

## Authentification

| Méthode | Route | Remarque |
|---|---|---|
| GET | `/auth/providers` | Liste des fournisseurs (Discord, etc.) + sitekey Turnstile |
| POST | `/auth/guest` | Crée un compte invité. Body: `{ turnstile?, attempt? }` → `{ token }` |
| POST | `/auth/discord?token=…&ref=…` | Redirection OAuth Discord (302) |
| GET | `/auth/discord/callback?code=…&state=…` | Callback OAuth (302) |
| POST | `/auth/pass` | "Laissez-passer" 30 min requis pour ouvrir des boosters. Body: `{ turnstile, attempt }` |
| POST | `/auth/logout` | Déconnexion |

En-têtes utilisés par le client :
- `authorization: Bearer <token>` (token stocké dans `localStorage.kyara_token`)
- `x-device-id: <uuid>` (`localStorage.kyara_device`)
- `x-pass: <pass>` (pass Turnstile, 30 min, via `localStorage.kyara_pass`)
- `x-request-id: <id>` (optionnel, anti double-soumission)
- `content-type: application/json` si body

Codes d'erreur métier : `pass_required`, `turnstile_failed`, `guest_limit`, `queued`, `free_limit`, `chakra_insufficient`, `not_listable`, `already_listed`, etc.
Statut 429 + `error: "queued"` → file d'attente serveur (`GET /api/gate` renvoie `position`, `etaSeconds`).

## Compte `/me`

| Méthode | Route | Description |
|---|---|---|
| GET | `/me` | Profil : pseudo, chakra, `freePacks`, `freePacksMax`, `nextFreeAt`, `pity`, `goldenIn`, `boostersOpened`, `trust`, etc. |
| PATCH | `/me` | Body `{ pseudo }` — changer de pseudo |
| GET | `/me/bootstrap` | Données de démarrage de la session |
| GET | `/me/profile` / PATCH | Profil public |
| PUT | `/me/showcase` | Body `{ ids: [...] }` — vitrine |
| GET | `/me/prestige` | Édition prestige |
| GET | `/me/packs` | État des boosters : `limits` (daily, événements), `featuredPity` |
| GET | `/me/progress` | Progression |
| POST | `/me/progress/claim` | Body `{ kind, id? }` |
| POST | `/me/referrer` | Body `{ code }` — code de parrainage |
| GET | `/me/alt` / POST `/me/alt/settle` | Comptes liés / règlement |
| POST | `/me/account/delete` / `/me/account/restore` | Suppression / restauration |
| POST | `/me/changelog/seen` · GET `/me/changelog/unseen` | Changelog |
| GET | `/me/feedback` · POST `/me/feedback` | Messages aux devs |
| POST | `/me/feedback/:id/messages` | Body `{ text }` |

## Collection

| Méthode | Route | Description |
|---|---|---|
| GET | `/me/collection?lean=1` | Cartes possées : `[{ characterId, qty, locked, listable, resaleLocked, resaleUntil, sellBlock, firstAt }]` (sans `lean`, inclut `prices`) |
| GET | `/me/collection/prices?ids=1,2,3` | Prix marché par carte : `median7d`, `median30d`, `sales7d`, `sales30d`, `lastPrice`, `lastAt` |
| POST | `/me/collection/:characterId/recycle` | Body `{ qty }` — recycler → chakra |
| POST | `/me/collection/recycle-all` | Body `{ rarities: ["C","U",…] }` |
| POST | `/me/collection/:characterId/pin` | Body `{ pinned }` |

## Boosters / ouverture

| Méthode | Route | Description |
|---|---|---|
| GET | `/packs` | Catalogue : id, name, price, chakraPrice, `usesFreePacks`, slots, rates, golden… |
| GET | `/packs/:id/characters` | Cartes contenues dans un pack |
| GET | `/packs/options` · `/packs/preview` | Options / aperçu |
| POST | `/packs/:id/open` | Ouvre **1** booster. Body: `{}` ou `{ maxChakra }`. Réponse : `{ cards[], user, packId, shareId, golden, godPack, pity, paidWith, claimable }` |
| POST | `/packs/:id/open-many` | Ouvre **N** boosters. Body: `{ count, maxChakra? }`. Réponse : `{ results: [ <réponse open> ], … }` |

`paidWith` : `"free"` (pack gratuit), `"chakra"`, `"pass"`, …
Le serveur peut répondre `403 { error: "pass_required" }` → obtenir un pass via `/auth/pass` puis relancer.
Multiplicateurs proposés par l'UI : ×1, ×5, ×10 (bornés par le nombre de boosters gratuits disponibles).

## Marché

| Méthode | Route | Description |
|---|---|---|
| GET | `/market/listings` | Params : `characterId`, `sort` = `ending` \| `newest` \| `price_asc` \| `price_desc`, `pageSize` |
| POST | `/market/listings` | Créer une annonce (fixe ou enchère) |
| POST | `/market/listings/:id/cancel` | Annuler une annonce |
| GET | `/me/market` | Mes annonces (`listings`, …) |
| GET | `/me/market/access` | Droit d'accès au marché (trust) |
| GET | `/market/buy-orders` | Ordres d'achat (paramètre requis) |
| GET | `/market/suspicious` | Anomalies (modération) |
| GET/POST | `/market/chat`, `/market/chat/rooms`, `/market/chat/join` | Chat du marché |
| POST | `/market/chat/:id/report` | Signalement |

Chaque listing inclut `prices` (median7d/30d, sales, lastPrice) et `character` (id, name, image, rarity, series…).

## Échanges (trades)

| Méthode | Route | Description |
|---|---|---|
| GET | `/me/trades` | Mes échanges |
| GET | `/trades` · `/trades/offers` · `/trades/offers/mine` | Liste des offres (tableau d'objets `{id, user:{id,pseudo}, characterId, wantIds[], counterOk, status, takenWith, taker, createdAt, expiresAt, closedAt}`) |
| POST | `/trades/offers/:id/accept` | Accepte une offre. Body `{ withId: characterId }` (la carte que je donne). `200` = échange effectué |
| POST | `/trades/offers` · `/trades` | Créer une offre / un échange direct |
| GET | `/trades/available/:id` | Cartes que je peux donner pour l'offre `:id` |
| POST | `/trades/:id/messages` | Body `{ text }` |

**Filtres 100 % côté client** (aucun paramètre serveur) : la page `?onglet=offres` filtre en JS —
« Que je n'ai pas » = `qty(characterId) === 0`, « Contre mes doublons » = `wantIds` contient au moins
une carte dont `max(0, min(listable, qty-1)) > 0`. Le moteur d'échanges (`src/trades.js`) applique
donc ces filtres via Playwright (onglet Chromium dédié, mêmes pilules `section.board .filters button.pill`,
annonces `section.board ul.offers li.offer`, bouton `li .acts button.btn-acc`) et valide via
`POST /trades/offers/:id/accept` observé sur le réseau.

## Amis & DM

| Méthode | Route | Description |
|---|---|---|
| GET | `/me/friends` | Liste d'amis |
| PUT/DELETE | `/me/friends/:id/share` | Partage de collection |
| GET | `/me/dm` · `/me/dm/unread` | Conversations |
| GET | `/me/dm/:id?before=…` | Messages d'une conversation |
| POST | `/me/dm/:id` | Body `{ text, characterId? }` |
| POST | `/me/dm/messages/:id/report` | Signalement |
| PUT/DELETE | `/me/blocks/:id` | Block / déblock |
| GET | `/users?q=` | Recherche d'utilisateurs |
| GET | `/users/:id` | Profil public |

## Personnages & wiki

| Méthode | Route | Description |
|---|---|---|
| GET | `/characters` | Catalogue complet (~1,7 Mo) : id, name, native, image, rarity, series, pow, aura, dropChance… |
| GET | `/characters/:id` | Fiche d'un personnage |
| GET | `/characters/:id/detail` | Détail (compte) |
| GET | `/characters/heritage` | Héritage |
| GET | `/characters/news` · `/characters/news/mine` | Nouveautés du catalogue |
| GET | `/wiki` / `/wiki/:id` | Pages wiki (SSR) |

## Social / classement / divers

| Méthode | Route | Description |
|---|---|---|
| GET | `/leaderboard` · `/leaderboard/ladder?by=…&me=…&q=…` | Classement |
| GET | `/feed` | Fil d'actualité |
| GET | `/rates?pack=` | Taux de drop |
| GET | `/changelog` | Changelog |
| GET | `/feedback/reviews` | Avis |
| GET | `/launch` · GET `/me/launch` | Événement de lancement |
| GET | `/x-event` · GET/POST `/me/x-event` | Événement X/Twitter (body `{ xUsername }`) |
| GET | `/push` · POST `/me/push` | Abonnement push (WebPush: `subscription`, `topics`) |
| POST | `/me/push/device` · `/me/push/remove` · `/me/push/seen` · `/me/push/test` | Gestion push |
| GET | `/membership` · GET `/me/membership` | Adhésion |
| POST | `/me/membership/checkout` | Body `{ tier }` |
| POST | `/me/membership/portal` · `/me/membership/patreon/{link,sync,unlink}` | Portail / Patreon |
| GET | `/notice` | Message d'annonce |
| GET | `/me/notifications?unread=1&limit=30` · POST `/me/notifications/read` | Notifications |
| GET | `/me/wishlist` · PUT/DELETE `/me/wishlist/:id` · GET `/me/wishlist/odds` | Liste de souhaits |

## Système / infra

| Méthode | Route | Description |
|---|---|---|
| GET | `/health` | Santé |
| GET | `/edge` | Nœuds actifs (`nodes`) |
| GET | `/gate` | File d'attente (`in`, `position`, `etaSeconds`) |
| GET | `/status` · `/status?fresh=1` | Statut serveur |
| GET | `/config` | Configuration publique (feature flags) |
| GET | `/me/events?v=2&token=…` | Flux d'événements temps réel (SSE) |
| GET | `/stats` · `/trust` · `/trust/:id` · POST `/trust/recompute` | Stats / confiance |
| GET | `/chat/log` · `/chat/mutes` · `/chat/reports` · `/dm/reports` | Modération chat |
| GET | `/debug` · POST `/debug` · POST `/debug/profile` | Debug (admin) |

## Admin (`/api/admin/…`, compte admin requis)

`/members`, `/patreon`, `/patreon/sync`, `/launch`, `/x-event`, `/x-event/draw`, `/x-event/award`,
`/x-event/entries/:id` (body `{ action }`), `/users/:id/ban`, `/users/:id/give`,
`/users/:id/chat-moderator`, `/users/:id/appeal-moderator`, `/feedback/:id` (PATCH),
`/changelog` (POST), `/chat/messages/:id/delete`, `/dm/messages/:id/dismiss`,
`/market/listings` (modération), `/trust/:id/manual`, `/gate` (POST), `/debug`, `/status`.

---

# API locale du bot (http://localhost:8787)

| Méthode | Route | Description |
|---|---|---|
| GET | `/` | Tableau de bord (historique, stats, config, journal) |
| GET | `/api/state` | État du bot : `running`, `pseudo`, `freePacks`, `nextFreeAt`, `batch`, `lastError`, `log`, `sell`, `browserOpen`, `browserClosed`, `rateLimitedUntil` |
| GET | `/api/history?limit=100` | Ouvertures (du plus récent au plus ancien) + stats |
| GET | `/api/batches?limit=30` | Comptes rendus des multi-ouvertures |
| GET | `/api/trades?limit=200` | Échanges : `{trades, buckets, stats, auto, state}` (`buckets` = tranches de 10 min) |
| GET | `/api/sales` | Ventes : `{stats, history, seller, auto}` — stats chakra/gagné (24 h, 60 min, moyenne/h, tranches horaires) |
| GET | `/api/duplicates` | Analyse du marché : `{rows, summary}` ; erreurs `{code: auth_required\|rate_limited\|browser_closed\|market_error, retryAfterMs}` |
| GET | `/api/config` | Configuration actuelle |
| POST | `/api/config` | `{ pack, pollSeconds, openDaily, soundOnRare, batchMin, batchMax, tradesAuto, autoSell, sellMaxRarity, sellPricing, sellDelayMin, sellDelayMax, sellStealth }` |
| POST | `/api/sell` | Mise en vente manuelle d'un doublon |
| POST | `/api/bot/browser/restart` | Ferme puis relance Chromium (récupération manuelle) |
| POST | `/api/bot/start` | Démarre le bot |
| POST | `/api/bot/stop` | Arrête le bot |
| GET | `/events` | SSE : `state`, `log`, `opening`, `batch`, `trade`, `sale` |

Fichiers de données : `data/history.jsonl`, `data/batches.jsonl`, `data/trades.jsonl`, `data/sales.jsonl`,
`data/config.json`, `profile/` (session navigateur).

### Moteur d'échanges (`src/trades.js`)

- Onglet Chromium dédié (mêmes règles anti-détection que le bot) ouvert sur `/marche?onglet=offres`.
- Cycle toutes les 8–12 s (+ 12 % de chance d'un délai bonus), en pause pendant les ouvertures de boosters (`bot.opening`).
- À chaque cycle : (re)charge le plateau, vérifie/clic les deux filtres (`aria-pressed`), attend le rendu de la liste,
  charge `/api/me/collection?lean=1`, relit les annonces, garde celles **absentes de ma collection** et **couvertes par un doublon libérable**,
  puis accepte les boutons « Donner X » (180–520 ms entre chaque) en attendant la réponse `POST /trades/offers/:id/accept`.
- Chaque échange validé est écrit dans `data/trades.jsonl` et poussé en SSE (`type: "trade"`), agrégé par tranches de 10 min dans le dashboard.
- `POST /api/config` avec `tradesAuto: false` met le moteur en veille sans l'arrêter.

### Moteur de vente automatique (`src/seller.js`)

- **Désactivé par défaut** (`config.autoSell === false`, UI et fichier de configuration).
- Paramètres : `sellMaxRarity` (C/U/R/E/L/M), `sellPricing` (`fast` | `normal` | `patient`),
  `sellDelayMin` / `sellDelayMax` (secondes, 5–600), `sellStealth` (mode discret, défaut `true`),
  `saleType` / `saleDurationHours` pour l'annonce.
- Cycle : analyse `/api/me/collection` via `getDuplicates` (sans requête marché par personnage), ne garde que les
  doublons **vendables**, d'une rareté ≤ `sellMaxRarity`, puis crée une annonce par doublon avec le prix calculé
  par la stratégie : `fast` = 75 % du prix conseillé, `normal` = prix conseillé (médianes de la collection),
  `patient` = médiane +8 %. En mode discret : plancher de 25 s, pauses humaines, ordre mélangé, activité
  souris/scroll, jitter de prix ±3 %, sessions de 2–6 annonces suivies d'une pause de 2–7 minutes.
- `GET /api/me/market` est analysé périodiquement : les annonces `status: "sold"` sont écrites dans
  `data/sales.jsonl` (`kind: "sold"`, `finalPrice`) → chakra réellement gagné pour le bilan ; `kind: "listed"`
  trace les mises en vente. Un premier scan mémorise les ventes déjà soldées sans les compter (bilan démarré
  à l'activation).
- Les ventes manuelles (`POST /api/sell`) alimentent aussi le bilan.

### Robustesse navigateur, marché et limites API

- Le serveur HTTP répond avant le démarrage du bot ; Chromium est lancé ensuite (démarrage Electron fiable).
- Verrous/profils Chromium résiduels nettoyés au démarrage ; si Chromium se ferme ou plante, le bot le relance
  automatiquement (sauf arrêt explicite) et expose `browserOpen` / `browserClosed` dans `/api/state`.
- Une erreur `rate_limited` est détectée dans `bot.api`/`apiPost` : backoff global (`rateLimitedUntil`), pause du bot,
  des échanges et de la vente automatique, sans fermer Chromium. Le tableau de bord affiche un compte à rebours.
- L'analyse de marché vérifie que la page est sur `kyara.games` (retour automatique si session connectée), limite
  sa concurrence à 2 requêtes, étale les appels, lit `Retry-After`, et jette `rate_limited` en cas de 429 persistant.
  Le cache marché expire après 3 minutes.
- `POST /api/bot/browser/restart` ferme puis relance Chromium (bouton « Relancer Chromium » de l'interface).
