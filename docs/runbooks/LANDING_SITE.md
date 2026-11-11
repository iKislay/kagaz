# Landing site (kaggaz.app) and shop-app downloads (Cloudflare R2)

Two separate websites:

| Site               | App            | What                                                                 |
| ------------------ | -------------- | -------------------------------------------------------------------- |
| `kaggaz.app`       | `apps/landing` | Marketing site + `/download` page. Static export, no API calls.      |
| `print.kaggaz.app` | `apps/web`     | Customer ordering app (and `/admin`). Needs the API. Unchanged here. |

The Windows shop-app installer and its auto-update feed live in a **Cloudflare R2 bucket**. One public
URL serves both:

```
<SHOP_APP_RELEASES_URL>/KagazShop-win-Setup.exe   ← website "Download for Windows" button
<SHOP_APP_RELEASES_URL>/releases.win.json         ← installed apps check here for updates (UpdateFeedUrl)
```

## 1. Settings

Root `.env` (see `.env.example`):

| Variable                                                                              | Used by                    | Example                                     |
| ------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------- |
| `NEXT_PUBLIC_CUSTOMER_APP_URL`                                                        | landing build              | `https://print.kaggaz.app`                  |
| `NEXT_PUBLIC_SHOP_APP_RELEASES_URL`                                                   | landing build              | `https://downloads.kaggaz.app/kagaz-shop`   |
| `NEXT_PUBLIC_CONTACT_EMAIL` / `_PHONE`                                                | landing build (optional)   | `hello@kaggaz.app`                          |
| `SHOP_APP_RELEASES_URL`                                                               | installer build, upload    | same as `NEXT_PUBLIC_SHOP_APP_RELEASES_URL` |
| `SHOP_APP_API_URL`                                                                    | installer build (optional) | `https://api.kaggaz.app/api`                |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PREFIX` | upload                     | —                                           |

`NEXT_PUBLIC_*` values are baked into the static site at build time: change → rebuild/redeploy.
Until `NEXT_PUBLIC_SHOP_APP_RELEASES_URL` is set, download buttons show **Coming soon** (never a dead link).
R2 credentials are secrets: root `.env` only, never `NEXT_PUBLIC_`.

## 2. One-time R2 setup

1. Cloudflare dashboard → **R2** → **Create bucket** (e.g. `kaggaz-downloads`).
2. Bucket → **Settings → Public access**: connect a custom domain (e.g. `downloads.kaggaz.app`) or
   enable the `r2.dev` URL. This public base (plus `/<R2_PREFIX>` if you use one) is `SHOP_APP_RELEASES_URL`.
3. **R2 → Manage API tokens → Create API token**: _Object Read & Write_, scoped to this bucket.
   Copy the Access Key ID / Secret into `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`; the account ID
   (dashboard URL / R2 overview) into `R2_ACCOUNT_ID`.

## 3. Release the shop app

```powershell
pwsh scripts/build-shop-agent-installer.ps1 -Version 0.3.0   # UpdateFeedUrl/ApiBaseUrl filled from .env
pnpm release:shop-agent -- --dry-run                          # list what would upload
pnpm release:shop-agent                                       # upload; prints the public download link
```

- Build every new version **into the same `artifacts/shop-agent/releases` folder** (keeps older packages
  for delta updates). The upload skips `.nupkg` files already in the bucket.
- Upload order: packages + installer first, feed index (`releases.win.json`, `assets.win.json`,
  `RELEASES`) last with `Cache-Control: no-cache`, so apps never see a feed pointing at a missing package.
- Apps installed from a build with an empty `UpdateFeedUrl` can't self-update — reinstall once from the
  new installer.

## 4. Deploy kaggaz.app (Cloudflare Pages)

Workers & Pages → **Create → Pages → Connect to Git** (this repo):

| Setting                | Value                                                         |
| ---------------------- | ------------------------------------------------------------- |
| Build command          | `pnpm install --frozen-lockfile && pnpm build:landing`        |
| Build output directory | `apps/landing/out`                                            |
| Environment variables  | `NODE_VERSION=24`, the `NEXT_PUBLIC_*` landing settings above |

Then **Custom domains → `kaggaz.app`** (and `www` redirect). Security headers come from
`apps/landing/public/_headers`. Any static host works: upload the `apps/landing/out` folder.

Local: `pnpm dev:landing` → http://localhost:3001 · `pnpm build:landing` → `apps/landing/out`.

## 5. Check

- `https://kaggaz.app/download/` button links to `…/KagazShop-win-Setup.exe` and downloads it.
- `curl -I <SHOP_APP_RELEASES_URL>/releases.win.json` → `200`, `cache-control: no-cache`.
- Installed app → Settings → Updates → **Check for updates** finds the new version.
