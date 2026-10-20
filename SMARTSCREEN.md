# SmartScreen / Windows Defender — pourquoi l'app est bloquée et quelles solutions existent

## Pourquoi Windows bloque l'application

Windows SmartScreen et Defender décident de faire confiance à un exécutable selon plusieurs critères :

1. **La signature Authenticode et l'autorité qui l'a délivrée.** Un certificat **auto-signé** (comme celui fourni
   par défaut dans ce projet) n'est pas reconnu par Microsoft : il identifie l'éditeur mais n'apporte pas la
   réputation SmartScreen.
2. **La réputation** du fichier (nombre de téléchargements/exécutions observés par Microsoft).
3. **Le comportement** analysé par Defender (l'automatisation de navigateur peut être jugée suspecte).
4. **La provenance** : un fichier téléchargé porte la marque « Mark-of-the-Web » (MOTW), qui active SmartScreen.

Aucune modification côté application ne peut lever durablement ces alertes : **seul un certificat reconnu
(OV/EV ou Azure Trusted Signing) + de la réputation** fait disparaître l'avertissement pour tout le monde.

---

## 1. Solutions immédiates (côté utilisateur, sans certificat)

### a) « Informations complémentaires » → « Exécuter quand même »
C'est le contournement standard quand SmartScreen affiche « Windows a protégé votre PC ».

### b) Débloquer le fichier (MOTW)
Clic droit sur le `.exe` → **Propriétés** → cocher **Débloquer** → **Appliquer**.
En ligne de commande :

```powershell
Unblock-File .\Kyara-Bot-Setup-1.2.1.exe
Start-Process .\Kyara-Bot-Setup-1.2.1.exe
```

### c) Méthode ZIP (recommandée si l'installateur est bloqué)
La Release fournit aussi **`Kyara-Bot-<version>-win-x64.zip`** :

1. Télécharge le ZIP.
2. **Avant de l'extraire** : clic droit sur le ZIP → **Propriétés** → **Débloquer** → **Appliquer**.
3. Extrais l'archive dans un dossier (ex. `C:\Kyara Bot`).
4. Lance `Kyara Bot.exe` depuis le dossier extrait.

Le déblocage de l'archive avant extraction évite que la marque MOTW soit recopiée sur les fichiers extraits,
ce qui contourne la plupart des blocages SmartScreen.

### d) Installer la chaîne de confiance Kyara Bot
Sur un PC qui ne connaît pas le certificat, Windows affiche « éditeur inconnu ». Installe les deux certificats
publics fournis dans la Release :

1. `kyara-bot-root-ca.cer` → **Autorités de certification racines de confiance** (utilisateur actuel).
2. `kyara-bot-codesign.cer` → **Éditeurs approuvés**.

Ou en une commande (depuis le dépôt) :

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-code-signing-cert.ps1
```

La signature devient alors « Valide » et l'éditeur est reconnu. Cela ne supprime pas forcément la réputation
SmartScreen, mais évite les alertes « éditeur inconnu ».

### e) Exclusion Microsoft Defender
Windows → **Sécurité** → **Protection contre les virus et menaces** → **Gérer les paramètres** → **Exclusions** →
ajouter le dossier d'installation et `%APPDATA%\Kyara Bot`. À réserver aux PC personnels de confiance.

### f) Désactiver temporairement SmartScreen (non recommandé)
Paramètres → **Applications** → **Sécurité Windows** → **Contrôle des applications et du navigateur** →
**Protection basée sur la réputation** → désactiver. Cela affaiblit la sécurité du PC ; à réactiver ensuite.

---

## 2. Solutions durables (côté éditeur)

### a) Azure Trusted Signing (recommandé, abordable)
Service Microsoft de signature gérée : certificat de courte durée délivré après validation d'identité,
intégrable à electron-builder. Coût indicatif : quelques dollars/mois + validation d'identité.

Mise en place :

1. Crée un compte Azure et active **Trusted Signing**.
2. Crée un **Trusted Signing Account** + un **certificate profile** (validation d'identité Microsoft).
3. Renseigne `build/azure-signing.example.json` dans `package.json` (`build.win.azureSignOptions`) :

   ```json
   "win": {
     "azureSignOptions": {
       "endpoint": "https://wus2.codesigning.azure.net/",
       "codeSigningAccountName": "mon-compte-trusted-signing",
       "certificateProfileName": "mon-profil"
     }
   }
   ```

4. Fournis l'authentification Azure à la CI : `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`
   (service principal) + les trois variables `AZURE_CODE_SIGNING_ENDPOINT`, `AZURE_CODE_SIGNING_ACCOUNT`,
   `AZURE_CODE_SIGNING_PROFILE`.
5. Le workflow `build.yml` exécute `scripts/configure-azure-signing.mjs` : si ces variables existent, il
   injecte `azureSignOptions` et electron-builder signe automatiquement les binaires.

> Microsoft Trusted Signing n'est pas un certificat EV : SmartScreen peut encore avertir au tout début, mais
> la signature est reconnue par Microsoft et la réputation se construit normalement.

### b) Certificat OV ou EV acheté chez une autorité
- **EV (Extended Validation)** : réputation SmartScreen immédiate, idéal pour supprimer l'avertissement.
- **OV (Organization Validation)** : reconnu, réputation à construire (quelques jours/semaines).
- Achète le certificat, exporte-le en `.pfx`, puis ajoute ces secrets GitHub :
  `WINDOWS_CSC_LINK` (contenu base64 du `.pfx`) et `WINDOWS_CSC_KEY_PASSWORD`.
  Le workflow les transmet à electron-builder (`CSC_LINK` / `CSC_KEY_PASSWORD`), qui signe l'app, l'installateur
  et le portable lors du build CI. La Release est alors signée de bout en bout, sans manipulation manuelle.

### c) Microsoft Store / MSIX
La distribution via le Microsoft Store (ou un MSIX signé par un certificat de confiance) bénéficie de la
confiance de la plateforme. Un compte développeur Microsoft est requis ; electron-builder peut produire un
paquet `appx`/MSIX, mais la signature reste nécessaire pour l'installation hors Store.

### d) Réputation et faux positifs
- Signale le fichier à Microsoft : <https://www.microsoft.com/en-us/wdsi/filesubmission>.
- Demande aux utilisateurs de cliquer « Exécuter quand même » et d'installer l'app : la réputation SmartScreen
  se construit avec les téléchargements/exécutions.
- Vérifie les checksums SHA-256 publiés dans la Release (`SHA256SUMS.txt`).

---

## 3. Ce que fait ce dépôt

- Les binaires 1.2.1 sont signés avec la chaîne auto-signée `Kyara Bot Root CA → Kyara Bot` (horodatée).
- La Release contient les certificats publics, un ZIP « déblocable » et les checksums.
- `scripts/install-code-signing-cert.ps1` installe la confiance sur le PC.
- `scripts/fix-smartscreen.ps1` débloque un fichier/dossier et peut ajouter une exclusion Defender.
- `scripts/sign-windows.ps1` signe les builds locaux.
- Le workflow CI accepte un **vrai certificat** (PFX via `WINDOWS_CSC_LINK`/`WINDOWS_CSC_KEY_PASSWORD`) ou
  **Azure Trusted Signing** (variables `AZURE_*`) — voir sections 2a et 2b.

## 4. Comparatif rapide

| Solution | Efficacité SmartScreen | Coût | Mise en œuvre |
|---|---|---|---|
| Auto-signé + certificats installés | Moyenne (éditeur reconnu, réputation non) | Gratuit | Faible |
| ZIP débloqué avant extraction | Bonne contournement local | Gratuit | Faible |
| Azure Trusted Signing | Bonne (signature reconnue Microsoft) | Faible abonnement | Moyenne (validation d'identité) |
| Certificat OV | Bonne après réputation | ~150–400 €/an | Moyenne |
| Certificat EV | **Excellente (immédiate)** | ~300–600 €/an | Moyenne (validation société) |
| Microsoft Store / MSIX | Excellente | Compte développeur | Élevée |
