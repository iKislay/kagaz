# Kagaz Shop Agent

Windows app for Kagaz print shops (stages P1.9–P1.10, P2.3–P2.11, P4.4, P5.4): pair the PC with a shop, register printers, review and
accept paid orders, print each order as **one** spooler job (customer pages × copies + one pickup slip), Mark Ready
after an explicit operator check, and verify pickup codes. Same macOS-style design language as the web app
(tokens and shared styles in `src/Kagaz.ShopAgent.App/App.xaml`).

Projects: `App` (WPF UI, view models, background services), `Core` (shop API client, local state, reconciliation),
`Printing` (`IPrintEngine`, PDFium engine, spooler lookup), `PrintHost` (helper exe the app runs for each print so
a driver/renderer crash can't take the app down), `Tests`.

## Prerequisites
- Windows 10/11 x64
- .NET 10 SDK (`dotnet --list-sdks`; 10.0.403 is installed)
- The Kagaz API (default `http://localhost:4000/api`) must be running to see "Connected"; the app works without it and never crashes

## Commands (run from the repository root)
Build (Release, 0 warnings / 0 errors expected):
```
dotnet build apps/shop-agent/Kagaz.ShopAgent.sln -c Release
```
Run unit tests:
```
dotnet test apps/shop-agent/Kagaz.ShopAgent.sln
```
Run the app:
```
dotnet run --project apps/shop-agent/src/Kagaz.ShopAgent.App -c Release
```

## Local state
- State root: `%LOCALAPPDATA%\Kagaz\`
- Logs: `%LOCALAPPDATA%\Kagaz\logs\agent-<date>.log` (rolling daily, 14 files retained, plus Debug output). Never contains the device token.
- Device token: `%LOCALAPPDATA%\Kagaz\device.token` (DPAPI-encrypted; never plaintext; never in `appsettings.json`)

- Local print state: `%LOCALAPPDATA%\Kagaz\state.json` (per-attempt phase for crash reconciliation, chosen API URL, pause flag)
- "Microsoft Print to PDF" output: `%LOCALAPPDATA%\Kagaz\print-to-pdf\KAGAZ-<ref>-A<attempt>.pdf` (no Save dialog)

## Operators, pairing and mode
- After pairing, an operator signs in (email/phone + password). The operator token lives in memory only and is sent as
  `X-Operator-Token` on human actions; `401 OPERATOR_LOGIN_REQUIRED` returns to the sign-in. Printing of accepted
  jobs continues while signed out.
- `401 DEVICE_REVOKED` anywhere wipes the DPAPI token and shows "Device revoked, re-pair required". The device token
  is rotated weekly (and from Settings).
- The toolbar always shows the approval mode (Manual | Auto, Pause auto) from the heartbeat; changes `PATCH /shop/mode`.

## How printing works (Appendix A.2–A.4)
- Per-printer local queue in `state.json`, rebuilt from the server's QUEUED jobs. The worker leases the head of each
  free printer's queue (`409 PRINTER_BUSY` / `NOT_NEXT_IN_QUEUE` → wait), downloads the packet, verifies SHA-256,
  persists the local phase, then prints it through `Kagaz.ShopAgent.PrintHost.exe` (PDFium render on the STA main
  thread → one `PrintDocument`, copies = 1, A4, explicit duplex/colour, `DocumentName = KAGAZ-<ref>-A<attempt>`).
- Reports SUBMITTED, then `SpoolerMonitor` watches the spooler (`System.Printing`) and reports SPOOLER_COMPLETE
  (telemetry only), FAILED (reason) or UNCERTAIN. READY only via Mark Ready / Confirm printed.
- Heartbeat every 15 s: app version, OS, uptime, queue depth, `activePrintJobIds` (renews leases), printer health.
- On start and every reconnect it reconciles (A.3): resume monitoring what is still in the spooler, FAILED
  NOT_SUBMITTED for attempts that never reached the printer, UNCERTAIN for anything unprovable. Never prints twice.
- Socket.IO `/shop` hints (`job.created`, `job.updated`, `shop.mode_changed`, `device.revoked`) wake the REST refresh;
  10 s safety poll while connected, 5 s while not. Needs-check orders offer Confirm printed / Reprint (two
  confirmations) / Mark failed.

## Installer
`scripts/build-shop-agent-installer.ps1 -Version x.y.z` → `artifacts/shop-agent/releases/KagazShop-win-Setup.exe`
(Velopack, per-user). See `docs/guides/SHOP_AGENT_INSTALL.md`.

## Notes
- Single-instance guard via named Mutex `Kagaz.ShopAgent.SingleInstance`. Outbound HTTPS/HTTP only; no listening ports.
- Configuration: `appsettings.json` — `ApiBaseUrl` (overridden by the address used when pairing), `PollIntervalSeconds`,
  `SafetyPollSeconds`, `HeartbeatSeconds`, `TokenRotationDays`, `RealtimeEnabled`, `UpdateFeedUrl`, `MaxRenderDpi`,
  `PrintToFileFolder` (testing only: print every job to PDF files).
