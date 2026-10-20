# Aide au contournement des blocages SmartScreen / Defender pour Kyara Bot.
#
# Exemples :
#   powershell -ExecutionPolicy Bypass -File .\scripts\fix-smartscreen.ps1
#   powershell -ExecutionPolicy Bypass -File .\scripts\fix-smartscreen.ps1 -Path "$env:USERPROFILE\Downloads\Kyara-Bot-Setup-1.2.1.exe"
#   powershell -ExecutionPolicy Bypass -File .\scripts\fix-smartscreen.ps1 -Path "C:\Kyara Bot" -AddDefenderExclusion
param(
  [string]$Path = "",
  [switch]$InstallCertificate,
  [switch]$AddDefenderExclusion,
  [switch]$DisableSmartScreen
)

$ErrorActionPreference = "Stop"

function Test-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $p = New-Object Security.Principal.WindowsPrincipal($id)
  return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

Write-Host "=== Kyara Bot · aide SmartScreen / Defender ===" -ForegroundColor Cyan

if ($InstallCertificate -or -not $Path) {
  & (Join-Path $PSScriptRoot "install-code-signing-cert.ps1")
}

if ($Path) {
  if (-not (Test-Path $Path)) { throw "Chemin introuvable : $Path" }
  $item = Get-Item $Path
  if ($item.PSIsContainer) {
    Write-Host "Déblocage récursif du dossier $($item.FullName) ..."
    Get-ChildItem $item.FullName -Recurse -File | Unblock-File -ErrorAction SilentlyContinue
  } else {
    Write-Host "Déblocage de $($item.FullName) ..."
    Unblock-File -Path $item.FullName -ErrorAction SilentlyContinue
  }
  Write-Host "Fichiers débloqués (marque Mark-of-the-Web supprimée)." -ForegroundColor Green

  if ($AddDefenderExclusion) {
    if (-not (Test-Admin)) { throw "L'exclusion Defender nécessite une console administrateur." }
    Add-MpPreference -ExclusionPath $item.FullName
    Write-Host "Exclusion Defender ajoutée pour $($item.FullName)." -ForegroundColor Green
  }
} elseif ($AddDefenderExclusion) {
  Write-Host "Indique -Path (dossier installé ou exe) pour l'exclusion Defender." -ForegroundColor Yellow
}

if ($DisableSmartScreen) {
  Write-Host "Désactivation de SmartScreen pour l'utilisateur (réversible) ..." -ForegroundColor Yellow
  $key = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer"
  Set-ItemProperty -Path $key -Name "SmartScreenEnabled" -Value "Off" -ErrorAction SilentlyContinue
  Write-Host "SmartScreen désactivé. Redémarre l'Explorateur/session. Réactive-le ensuite pour ta sécurité." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Rappels :"
Write-Host " - Pour un binaire téléchargé : clic droit → Propriétés → Débloquer (ou Unblock-File)."
Write-Host " - Méthode ZIP : débloque l'archive AVANT de l'extraire, puis lance Kyara Bot.exe."
Write-Host " - Pour supprimer durablement l'alerte pour tous : certificat EV/OV ou Azure Trusted Signing"
Write-Host "   (voir SMARTSCREEN.md)."
Write-Host ""
Write-Host "Terminé." -ForegroundColor Green
