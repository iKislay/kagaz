<#
.SYNOPSIS
  Builds everything a pilot shop needs into release/pilot-<Version>/ (ADR-003, P6.8):
    KagazShop-win-Setup.exe        Windows shop app, server address pre-filled
    kagaz-payments-phone.apk       YouPI Android observer (payment detection on the shop's phone)
    SHA256SUMS.txt, README.txt

.DESCRIPTION
  - Windows app: scripts/build-shop-agent-installer.ps1 with -ApiBaseUrl https://api.<Domain>/api.
  - Phone app: the prebuilt APK from the YouPI-PG checkout, accepted only if its SHA-256 matches the
    checksum published in that repo (no Android SDK needed). It is also served by the pilot server
    at https://pay-api.<Domain>/youpi-sms-gateway.apk, which is what the shop app's QR opens.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\build-pilot-release.ps1 -Domain kagaz.example.in -Version 0.3.0
#>
param(
    [Parameter(Mandatory = $true)][string]$Domain,
    [string]$Version = "0.3.0",
    [string]$YoupiSrc = "",
    [string]$SignParams = ""
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Domain = $Domain.Trim().ToLower() -replace '^https?://', '' -replace '/+$', ''
if ($Domain -notmatch '^([a-z0-9-]+\.)+[a-z]{2,}$') { throw "Domain looks wrong: $Domain" }
if (-not $YoupiSrc) { $YoupiSrc = Join-Path (Split-Path $root -Parent) "YouPI-PG" }
$out = Join-Path $root "release/pilot-$Version"
if (Test-Path $out) { Remove-Item -Recurse -Force $out }
New-Item -ItemType Directory -Force $out | Out-Null

$api = "https://api.$Domain/api"
Write-Host "==> Windows shop app $Version for $api"
$installerArgs = @{ Version = $Version; ApiBaseUrl = $api; OutputDir = "artifacts/shop-agent-pilot" }
if ($SignParams) { $installerArgs.SignParams = $SignParams }
& (Join-Path $PSScriptRoot "build-shop-agent-installer.ps1") @installerArgs
$setup = Join-Path $root "artifacts/shop-agent-pilot/releases/KagazShop-win-Setup.exe"
if (-not (Test-Path $setup)) { throw "Installer not found at $setup" }
Copy-Item $setup (Join-Path $out "KagazShop-win-Setup.exe")

Write-Host "==> Phone app (YouPI observer) from $YoupiSrc"
$apk = Join-Path $YoupiSrc "apps/android-observer-app/youpi-sms-gateway.apk"
$apkSum = Join-Path $YoupiSrc "apps/android-observer-app/youpi-sms-gateway.apk.sha256"
if (-not (Test-Path $apk)) { throw "APK not found: $apk (clone https://github.com/youpi-pg/YouPI-PG next to this repo or pass -YoupiSrc)" }
$expected = ((Get-Content $apkSum -Raw).Trim() -split '\s+')[0].ToLower()
$actual = (Get-FileHash $apk -Algorithm SHA256).Hash.ToLower()
if ($expected -ne $actual) { throw "APK checksum mismatch: expected $expected, got $actual - do not ship it." }
Copy-Item $apk (Join-Path $out "kagaz-payments-phone.apk")

$lines = Get-ChildItem $out -File | ForEach-Object { "{0}  {1}" -f (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower(), $_.Name }
Set-Content -Path (Join-Path $out "SHA256SUMS.txt") -Value $lines -Encoding ascii

$readme = @"
Kagaz pilot release $Version  ($(Get-Date -Format yyyy-MM-dd))
Server: https://app.$Domain   API: $api

KagazShop-win-Setup.exe    Install on the shop's Windows PC (next to the printer).
                           Pairing screen already has the server address; type the pairing code.
                           Unsigned: on "Windows protected your PC" click More info -> Run anyway.
kagaz-payments-phone.apk   YouPI payment detector for the shopkeeper's Android phone (the one that
                           receives UPI payment SMS / PhonePe / GPay notifications). Normally the
                           shop app shows a QR that downloads it; this copy is for offline install.
                           Upstream SHA-256: $expected

Verify files: Get-FileHash <file> -Algorithm SHA256  (compare with SHA256SUMS.txt)
Step-by-step: docs/runbooks/PILOT_SHOP_TEST.md
"@
Set-Content -Path (Join-Path $out "README.txt") -Value $readme -Encoding utf8

Write-Host ""
Write-Host "Release ready: $out"
Get-ChildItem $out | Format-Table Name, Length
