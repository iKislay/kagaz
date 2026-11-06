# Kagaz Shop Agent

Windows app for Kagaz print shops (stages P1.9–P1.10): pair the PC with a shop, register printers, review and
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

## How printing works (Appendix A.3/A.4)
- Worker leases the next QUEUED job for a printer installed on this PC, downloads the packet, verifies SHA-256,
  persists the local phase, then prints it through `Kagaz.ShopAgent.PrintHost.exe` (PDFium render → one
  `PrintDocument`, copies = 1, A4, explicit duplex/colour, `DocumentName = KAGAZ-<ref>-A<attempt>`).
- Reports SUBMITTED, watches the spooler, reports SPOOLER_COMPLETE (telemetry only). READY only via Mark Ready.
- On start/reconnect it reconciles: anything leased here that can't be confirmed is reported FAILED
  (→ NEEDS_OPERATOR_CHECK). An attempt is never printed twice.

## Notes
- Single-instance guard via named Mutex `Kagaz.ShopAgent.SingleInstance`. Outbound HTTPS/HTTP only; no listening ports.
- Jobs poll every 5 s; heartbeat every 15 s (reports this PC's printers by server id).
- Configuration: `appsettings.json` — `ApiBaseUrl` (overridden by the address used when pairing), `PollIntervalSeconds`,
  `HeartbeatSeconds`, `MaxRenderDpi`, `PrintToFileFolder` (testing only: print every job to PDF files).
