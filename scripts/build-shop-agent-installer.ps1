<#
.SYNOPSIS
  Builds the Kaggaz Shop Windows installer + update feed with Velopack (P5.4).

.DESCRIPTION
  1. dotnet publish the WPF app self-contained for win-x64 (the print helper
     Kagaz.ShopAgent.PrintHost.exe is published alongside it).
  2. Installs the Velopack CLI (vpk) into .tools/ if it isn't there (same version as the
     Velopack NuGet package the app references).
  3. vpk pack -> artifacts/shop-agent/releases: KagazShop-win-Setup.exe (per-user installer, no admin),
     the full/delta .nupkg packages and releases.win.json (the update feed).

  Publish the whole releases folder at the URL (or share) configured as UpdateFeedUrl in the app's
  appsettings.json; installed apps update from there. Packing a newer -Version into the same
  releases folder produces the delta update.

  Unsigned builds trigger SmartScreen ("Windows protected your PC") — see
  docs/guides/SHOP_AGENT_INSTALL.md. Pass -SignParams to sign when a certificate is available.

.EXAMPLE
  pwsh scripts/build-shop-agent-installer.ps1 -Version 0.2.0
  powershell -ExecutionPolicy Bypass -File scripts\build-shop-agent-installer.ps1 -Version 0.2.1
#>
param(
    [string]$Version = "0.2.0",
    [string]$OutputDir = "artifacts/shop-agent",
    [string]$Channel = "win",
    # Optional signtool parameters, e.g. '/a /fd sha256 /tr http://timestamp.digicert.com /td sha256'
    [string]$SignParams = "",
    # Baked into the published appsettings.json (repo default stays localhost for dev), e.g.
    # -ApiBaseUrl https://api.kaggaz.in/api -UpdateFeedUrl https://github.com/iKislay/kagaz/releases/latest/download
    [string]$ApiBaseUrl = "",
    [string]$UpdateFeedUrl = ""
)

$ErrorActionPreference = "Stop"
$VpkVersion = "1.2.161"  # keep in sync with <PackageReference Include="Velopack"> in Kagaz.ShopAgent.App.csproj
$PackId = "KagazShop"
$MainExe = "Kagaz.ShopAgent.App.exe"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$project = Join-Path $root "apps/shop-agent/src/Kagaz.ShopAgent.App/Kagaz.ShopAgent.App.csproj"
$out = Join-Path $root $OutputDir
$publishDir = Join-Path $out "publish"
$releasesDir = Join-Path $out "releases"
$toolDir = Join-Path $root ".tools"
$vpk = Join-Path $toolDir "vpk.exe"

Write-Host "==> Publishing Kagaz Shop $Version (self-contained win-x64)"
if (Test-Path $publishDir) { Remove-Item -Recurse -Force $publishDir }
& dotnet publish $project -c Release -r win-x64 --self-contained true -p:Version=$Version -o $publishDir
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed ($LASTEXITCODE)" }

foreach ($required in @($MainExe, "Kagaz.ShopAgent.PrintHost.exe", "appsettings.json")) {
    if (-not (Test-Path (Join-Path $publishDir $required))) { throw "Publish output is missing $required" }
}

if ($ApiBaseUrl -or $UpdateFeedUrl) {
    $settingsPath = Join-Path $publishDir "appsettings.json"
    $settings = Get-Content $settingsPath -Raw | ConvertFrom-Json
    if ($ApiBaseUrl) { $settings.ApiBaseUrl = $ApiBaseUrl }
    if ($UpdateFeedUrl) { $settings.UpdateFeedUrl = $UpdateFeedUrl }
    $settings | ConvertTo-Json | Set-Content $settingsPath -Encoding utf8
    Write-Host "==> appsettings.json: ApiBaseUrl=$($settings.ApiBaseUrl) UpdateFeedUrl=$($settings.UpdateFeedUrl)"
}

if (-not (Test-Path $vpk)) {
    Write-Host "==> Installing vpk $VpkVersion into .tools/"
    & dotnet tool install vpk --version $VpkVersion --tool-path $toolDir
    if ($LASTEXITCODE -ne 0) { throw "Could not install vpk (offline?). Install it manually: dotnet tool install vpk --version $VpkVersion --tool-path .tools" }
}

Write-Host "==> Packing installer + update feed into $releasesDir"
New-Item -ItemType Directory -Force $releasesDir | Out-Null
$packArgs = @(
    "pack",
    "--packId", $PackId,
    "--packVersion", $Version,
    "--packDir", $publishDir,
    "--mainExe", $MainExe,
    "--packTitle", "Kaggaz Shop",
    "--packAuthors", "Kagaz",
    "--channel", $Channel,
    "--runtime", "win-x64",
    "--outputDir", $releasesDir
)
if ($SignParams) { $packArgs += @("--signParams", $SignParams) }
& $vpk @packArgs
if ($LASTEXITCODE -ne 0) { throw "vpk pack failed ($LASTEXITCODE)" }

Write-Host ""
Write-Host "Done. Installer: $(Join-Path $releasesDir "$PackId-$Channel-Setup.exe")"
Write-Host "Update feed:    $releasesDir (serve it at UpdateFeedUrl)"
