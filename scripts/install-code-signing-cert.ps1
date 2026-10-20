# Installe la chaîne de confiance Kyara Bot sur le poste :
#   - la racine « Kyara Bot Root CA » dans les Autorités de certification racines de confiance ;
#   - le certificat de signature « Kyara Bot » dans les Éditeurs approuvés.
#
# Usage (utilisateur courant, sans administrateur) :
#   powershell -ExecutionPolicy Bypass -File .\scripts\install-code-signing-cert.ps1
#
# Installation pour tous les utilisateurs (administrateur requis) :
#   powershell -ExecutionPolicy Bypass -File .\scripts\install-code-signing-cert.ps1 -Machine
param(
  [switch]$Machine
)

$ErrorActionPreference = "Stop"
$rootCer = (Resolve-Path (Join-Path $PSScriptRoot "..\build\kyara-bot-root-ca.cer")).Path
$leafCer = (Resolve-Path (Join-Path $PSScriptRoot "..\build\kyara-bot-codesign.cer")).Path

if ($Machine) {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "L'option -Machine nécessite une console administrateur."
  }
}

function Add-Certificate([string]$file, [string]$storeName) {
  $args = @()
  if (-not $Machine) { $args += "-user" }
  $args += @("-addstore", "-f", $storeName, $file)
  Write-Host "Installation de $(Split-Path $file -Leaf) dans $storeName ..."
  & certutil @args
  if ($LASTEXITCODE -ne 0) { throw "Échec de l'installation du certificat dans $storeName (code $LASTEXITCODE)." }
}

Add-Certificate $rootCer "Root"
Add-Certificate $leafCer "TrustedPublisher"

$scope = if ($Machine) { "machine" } else { "utilisateur courant" }
Write-Host ""
Write-Host "Chaîne de confiance Kyara Bot installée pour le compte $scope." -ForegroundColor Green
Write-Host "Lance l'installateur ou l'application : l'éditeur « Kyara Bot » est désormais reconnu."
Write-Host "Rappel : un certificat auto-signé ne remplace pas une signature EV/OV reconnue ;"
Write-Host "SmartScreen peut encore afficher un avertissement sur un PC qui ne connaît pas ces certificats."
