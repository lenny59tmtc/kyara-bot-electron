# Signe des exécutables Windows avec le certificat code-signing Kyara Bot.
# Utilise Set-AuthenticodeSignature (compatible certificats CNG), avec horodatage.
#
# Usage :
#   powershell -ExecutionPolicy Bypass -File .\scripts\sign-windows.ps1 "dist\win-unpacked\Kyara Bot.exe"
#   powershell -ExecutionPolicy Bypass -File .\scripts\sign-windows.ps1 dist\Kyara-Bot-Setup-1.2.0.exe dist\Kyara-Bot-Portable-1.2.0.exe
#
# Variables (optionnelles) :
#   SIGN_PFX           chemin du .pfx (défaut : .secrets/kyara-bot-codesign.pfx)
#   SIGN_PFX_PASSWORD  mot de passe (défaut : .secrets/codesign-password.txt)
param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Files
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent

$pfxPath = $env:SIGN_PFX
if (-not $pfxPath) { $pfxPath = Join-Path $root ".secrets\kyara-bot-codesign.pfx" }
$pfxPath = (Resolve-Path $pfxPath).Path

$password = $env:SIGN_PFX_PASSWORD
if (-not $password) {
  $pwdFile = Join-Path $root ".secrets\codesign-password.txt"
  if (Test-Path $pwdFile) { $password = (Get-Content $pwdFile -Raw).Trim() }
}
if (-not $password) {
  throw "Mot de passe du certificat introuvable (SIGN_PFX_PASSWORD ou .secrets/codesign-password.txt)."
}

$storeCert = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert -ErrorAction SilentlyContinue |
  Where-Object { $_.Subject -like "CN=Kyara Bot*" } |
  Select-Object -First 1
if (-not $storeCert) {
  Write-Host "Import du certificat dans Cert:\CurrentUser\My ..."
  $imported = Import-PfxCertificate -FilePath $pfxPath -CertStoreLocation Cert:\CurrentUser\My `
    -Password (ConvertTo-SecureString $password -AsPlainText -Force)
  $storeCert = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert |
    Where-Object { $_.Thumbprint -eq $imported.Thumbprint } |
    Select-Object -First 1
}
if (-not $storeCert) { throw "Certificat de signature introuvable dans le magasin." }

$targets = if ($Files) { $Files } else {
  Get-ChildItem (Join-Path $root "dist") -Filter "Kyara-Bot-*.exe" -File -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName }
}
if (-not $targets) { throw "Aucun fichier à signer." }

Write-Host "Certificat : $($storeCert.Subject)"
foreach ($file in $targets) {
  $path = (Resolve-Path $file).Path
  Write-Host "Signature : $path"
  $sig = Set-AuthenticodeSignature -FilePath $path -Certificate $storeCert `
    -HashAlgorithm SHA256 -TimestampServer "http://timestamp.digicert.com"
  Write-Host ("  -> {0} {1} (horodatage: {2})" -f $sig.Status, $sig.StatusMessage, [bool]$sig.TimeStamperCertificate)
}
Write-Host "Terminé." -ForegroundColor Green
