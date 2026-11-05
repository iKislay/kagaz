# Kagaz Shop Agent

Windows desktop app skeleton for Kagaz print shops (Phase 0 — stage P0.6). The app runs on a shop's Windows machine and is the host for future pairing, job-list, and printing logic.

This is a skeleton only: it shows the shell, navigation placeholders, health polling, single-instance guard, DPAPI device-token store, and structured logging. No pairing, job list, or printing logic is implemented yet.

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

## Notes
- Single-instance guard via named Mutex `Kagaz.ShopAgent.SingleInstance`.
- Window title shows "Kagaz Shop" plus the app version.
- Left nav: Pairing, Jobs, Pickup, Printers, Settings (each shows title + "Coming in Phase 1").
- Connection indicator polls `GET {ApiBaseUrl}/health` on startup and every 15 s; shows "Connected" (green) or "Disconnected: <short reason>" (red).
- Configuration: `appsettings.json` — `ApiBaseUrl`, `PollIntervalSeconds`, `HeartbeatSeconds`, `PrintEngine`, `MaxRenderDpi`.
