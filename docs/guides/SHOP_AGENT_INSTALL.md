# Kagaz Shop — install and update (P5.4)

The Windows shop app ships as a **per-user** Velopack installer: no administrator rights, no service, nothing
installed for other Windows users. It installs to `%LOCALAPPDATA%\KagazShop\` and keeps its data (device token,
`state.json`, logs) in `%LOCALAPPDATA%\Kagaz\`, which survives updates and reinstalls.

## Build the installer

On a Windows machine with the .NET 10 SDK, from the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-shop-agent-installer.ps1 -Version 0.2.0
```

The script:

1. publishes `apps/shop-agent/src/Kagaz.ShopAgent.App` self-contained for `win-x64` (no .NET install needed on the
   shop PC; the print helper `Kagaz.ShopAgent.PrintHost.exe` is published next to the app);
2. installs the Velopack CLI `vpk` (same version as the `Velopack` NuGet package) into `.tools/` if missing —
   this step needs internet once;
3. runs `vpk pack` into `artifacts/shop-agent/releases/`:

| File                                 | What it is                                         |
| ------------------------------------ | -------------------------------------------------- |
| `KagazShop-win-Setup.exe`            | the installer to give to a shop (≈ 76 MB)           |
| `KagazShop-win-Portable.zip`         | portable copy (no install; cannot self-update)     |
| `KagazShop-<version>-full.nupkg`     | full update package                                |
| `KagazShop-<version>-delta.nupkg`    | delta from the previous version (2nd build onward) |
| `releases.win.json`, `assets.win.json`, `RELEASES` | the update feed index                |

`artifacts/` and `.tools/` are git-ignored.

The app version comes from `<Version>` in `Kagaz.ShopAgent.App.csproj`; `-Version` overrides it, and the same number
is shown in Settings, sent as `X-Agent-Version` and in the heartbeat (`appVersion`), and compared by the API with
`MIN_AGENT_VERSION`.

## Install on a shop PC

1. Copy `KagazShop-win-Setup.exe` to the PC (USB or download) and run it as the shop's normal Windows user.
2. Kagaz Shop starts; shortcuts are added to the Start menu and desktop.
3. **Pairing** → enter the server address (e.g. `https://api.example.com/api`) and the one-time pairing code.
4. Sign in as an operator, set up **Printers** (confirm colour/duplex), then print a test order.
5. Optional: **Settings → Start with Windows** (writes `HKCU\…\CurrentVersion\Run\KagazShop`; removed on uninstall).

Only one copy runs per Windows session (named mutex `Kagaz.ShopAgent.SingleInstance`); a second launch shows
"Kagaz Shop is already running."

Uninstall from **Settings → Apps → Installed apps → Kagaz Shop**. The data folder `%LOCALAPPDATA%\Kagaz\` is left in
place (delete it to forget the pairing).

## Unsigned builds and SmartScreen

Until a code-signing certificate is available the installer and app are **unsigned**. On first run Windows
SmartScreen shows **"Windows protected your PC — Microsoft Defender SmartScreen prevented an unrecognized app from
starting."**

- Click **More info**, check the publisher shows *Unknown publisher* and the file is `KagazShop-win-Setup.exe`, then
  **Run anyway**.
- Some antivirus products quarantine new unsigned executables; whitelist `%LOCALAPPDATA%\KagazShop\` if that happens.
- The browser may also warn when downloading the installer ("not commonly downloaded"); choose **Keep**.
- Each new unsigned version can trigger SmartScreen again until it builds reputation.

To sign, pass signtool parameters to the script (applied by `vpk` to every binary and the installer):

```powershell
scripts\build-shop-agent-installer.ps1 -Version 0.2.1 -SignParams "/a /fd sha256 /tr http://timestamp.digicert.com /td sha256"
```

## Updates

1. Serve the `releases` folder at a stable location — any static https host or a file share — and set
   `"UpdateFeedUrl"` in `appsettings.json` **before** building (it is baked into the published app), e.g.
   `"https://downloads.example.com/kagaz-shop"` or `"\\\\server\\kagaz-shop"`.
2. To release vN+1: build with a higher `-Version` **into the same `releases` folder** (keep the older packages there
   so the delta is produced), then upload the folder again.
3. In the app: **Settings → Updates → Check for updates / Install update**. Installing downloads the package, closes
   the app and restarts into the new version.
4. When the API requires a newer agent (`MIN_AGENT_VERSION`; heartbeat `upgradeRequired` or `426
   AGENT_UPGRADE_REQUIRED`), the app shows a blocking **Update required** sheet with **Install update**, and starts
   no new prints until it is updated.

Updating mid-print is safe: the local print state is persisted, and on restart the app reconciles (plan A.3) —
it resumes monitoring jobs still in the Windows queue and sends anything it cannot prove to **Needs check**. It never
reprints on its own.

A copy run from `dotnet run`/`bin\` (not installed) can't self-update; Settings says so.

## Verification status

- Building and packing (`dotnet publish` + `vpk pack`) was run on the development PC: installer and feed are produced.
- **Not yet verified** (needs a clean Windows machine, stage "Done when"): fresh install → pair → print, and
  update vN → vN+1 from a served feed. Record the run in `docs/testing/` when done.
