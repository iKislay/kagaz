# Pilot shop test — setup and test-day guide (ADR-003)

Goal: one real shop in Mandya, real customers, **real UPI money paid straight to the shop's own
UPI ID**, YouPI detects the payment on the shopkeeper's phone, Kagaz prints the job.

Everything is prepared in the repo. What remains is: get the four things in §1, run §2 once,
set up the shop (§3), build the release files (§4), and test (§6).

---

## 1. What you need to give (nothing else is required)

| #   | What                                         | Why                                                                                                                                                       | Where to get it                                                                                                                                          |
| --- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **A domain on Cloudflare** (e.g. `kagaz.in`) | Phones and browsers need HTTPS; the YouPI phone app refuses plain HTTP.                                                                                   | Buy any domain (~₹800/yr), add it to a free Cloudflare account, switch its nameservers to Cloudflare.                                                    |
| 2   | **A Cloudflare Tunnel token**                | Puts the server on the internet with HTTPS, no router/port setup.                                                                                         | Cloudflare → Zero Trust → Networks → Tunnels → **Create tunnel** (Cloudflared) → copy the token from the install command.                                |
| 3   | **A machine that stays on**                  | Runs the whole stack. Either a small cloud VM (2 vCPU / 4 GB, Ubuntu, ~₹600/month) **or** a Windows/Linux PC with Docker that is always on with internet. | —                                                                                                                                                        |
| 4   | **Shop details**                             | Goes into `infra/pilot-shops.json`.                                                                                                                       | Shop name, address, opening hours, prices per side (B/W, colour, minimum), owner name + mobile, **the shop's UPI ID** and the name customers should see. |

Plus, before real customers: **written permission from the YouPI-PG authors** (see ADR-003).

Everything else — database password, storage keys, session/pickup/encryption keys, YouPI admin
token, phone pairing secret — is generated for you by `scripts/pilot-env.mjs`. You never type a
secret. Optional: a Sentry DSN for error alerts; a code-signing certificate (otherwise Windows
shows a SmartScreen warning once when installing the shop app).

---

## 2. Server setup (once, ~30 minutes)

On the machine from §1.3 (Docker + Git + Node 24 installed):

```bash
git clone <kagaz repo> kagaz && git clone https://github.com/youpi-pg/YouPI-PG.git YouPI-PG
cd kagaz && git checkout feat/youpi-upi-payments
node scripts/pilot-env.mjs --domain kagaz.in --tunnel-token <token from §1.2>
#   → writes infra/pilot.env (all secrets) and infra/pilot-shops.json (edit it in §3)
```

In Cloudflare → your tunnel → **Public Hostname**, add these five (Service type HTTP):

| Public hostname    | Service                 | What it is                                 |
| ------------------ | ----------------------- | ------------------------------------------ |
| `app.kagaz.in`     | `http://web:3000`       | customer website + admin                   |
| `api.kagaz.in`     | `http://api:4000`       | Kagaz API (shop app, webhooks)             |
| `files.kagaz.in`   | `http://seaweedfs:8333` | private PDF storage (signed links only)    |
| `pay.kagaz.in`     | `http://youpi:7000`     | YouPI checkout page (QR / UPI app buttons) |
| `pay-api.kagaz.in` | `http://youpi:6100`     | YouPI API (phone app pairing and alerts)   |

Start everything (first build takes ~10 minutes):

```bash
docker compose -f infra/docker-compose.pilot.yml --env-file infra/pilot.env up -d --build
docker compose -f infra/docker-compose.pilot.yml --env-file infra/pilot.env ps     # all "running/healthy"
```

Check from any browser: `https://api.kagaz.in/api/health` → `"status":"ok"`, and
`https://api.kagaz.in/api/config` → `"paymentMode":"LIVE"`. `https://app.kagaz.in` opens the site
(no DEMO banner — this is real money).

**Back up** `infra/pilot.env` to your password manager now. Losing it loses access to every shop's
payment setup and all pickup codes.

---

## 3. Create the shop and its login (once per shop, 5 minutes)

1. Edit `infra/pilot-shops.json` (template: `infra/pilot-shops.example.json`): your admin email,
   the shop's slug/name/address, hours, prices in **paise** (₹2 = `200`), and the owner
   (`phone` like `+919876543210` or `email`). `approvalMode`: `MANUAL` (shopkeeper accepts each
   job) or `AUTO` (prints straight away).
2. Run:

   ```bash
   docker compose -f infra/docker-compose.pilot.yml --env-file infra/pilot.env \
     exec api node dist/cli/pilot-bootstrap.js /config/pilot-shops.json
   ```

   It prints the **admin password**, the **shop owner's password** and a **PC pairing code** (valid
   24 h). Write them down — passwords are shown only once. Re-running is safe (updates the shop,
   adds a new price version only if prices changed, prints a fresh pairing code). Lost a password:
   add `--reset-passwords`.

3. Admin dashboard: `https://app.kagaz.in/admin` — sign in with the admin email/password.

---

## 4. Build the release files (the last step before the test)

On the Windows dev PC (this repo, internet needed once):

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-pilot-release.ps1 -Domain kagaz.in -Version 0.3.0
```

`release\pilot-0.3.0\` then contains:

| File                           | For                                                                              |
| ------------------------------ | -------------------------------------------------------------------------------- |
| `KagazShop-win-Setup.exe`      | the shop's Windows PC (next to the printer); server address is already filled in |
| `kagaz-payments-phone.apk`     | the shopkeeper's Android phone (also downloadable from the QR in the shop app)   |
| `SHA256SUMS.txt`, `README.txt` | checksums and a one-page summary                                                 |

Copy the folder to a USB stick / Google Drive for the shop visit.

Optional before the visit — prove the server end to end without real money:

```bash
pnpm --filter @kagaz/api pilot:smoke -- --api https://api.kagaz.in/api --shop <slug> \
  --login <owner phone> --password <owner password> --code <PC pairing code>
```

It pairs a "Smoke test" device, signs in, reads payment setup, places a ₹ order and prints the
checkout link. (Revoke the "Smoke test" device afterwards in admin → Shops → Devices. It uses up
the pairing code — run the bootstrap again for a fresh one.)

---

## 5. At the shop — setup with the shopkeeper (~20 minutes)

**Windows PC (with the printer connected and switched on):**

1. Run `KagazShop-win-Setup.exe`. On _"Windows protected your PC"_ click **More info → Run anyway**.
2. Pairing screen: the server address is pre-filled. Type the **PC pairing code** → **Pair this PC**.
3. Sign in with the owner's **phone + password**.
4. **Printers**: confirm the printer, colour/duplex capabilities, mark it default.
5. **Payments → Step 1**: type the shop's **UPI ID** (e.g. `ganeshxerox@okicici`) and the name
   customers see → **Save**. Status turns orange: _"Connect your phone…"_.

**Shopkeeper's Android phone (the one that gets UPI payment SMS / PhonePe / GPay notifications):**

6. **Payments → Step 2 → "1. Install the app"**: scan the QR with the phone camera, download and
   install (allow "install from this source"). Or install `kagaz-payments-phone.apk` from the USB.
7. Open the app (it is called **YouPI SMS Gateway**), allow **SMS** and **notification access**.
8. In the shop app click **Show pairing code**, scan **"2. Scan in the app"** from inside the phone app.
9. Phone settings → Apps → the app → **Battery → Unrestricted** (no battery saver), keep mobile
   data/Wi-Fi on. Keep the phone charging at the counter.
10. The shop app's status turns **green — "Payments are confirmed automatically"**.

**Admin dashboard:** shop **Settings → status Open**, check hours and pricing.

---

## 6. Test day — checklist

Do these with real phones, small amounts first. Tick each one.

| #   | Test                           | How                                                                                                                                            | Expected                                                                                                                                                    |
| --- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Happy path, ₹2–5               | Customer phone: open `https://app.kagaz.in`, choose the shop, upload a 1-page PDF, **Pay with UPI**, pay in GPay/PhonePe, tap **Payment done** | Within ~30 s the order shows **pickup code #N**; the shop app gets the job; it prints one packet with the slip on top. Money is in the shop's account.      |
| 2   | Manual vs Auto                 | Shop app Settings → Auto                                                                                                                       | Next paid order prints without anyone accepting it.                                                                                                         |
| 3   | Phone offline                  | Turn on airplane mode on the shop phone for 6 min, try to pay                                                                                  | Customer sees _"The shop can't confirm UPI payments right now…"_, no money asked. Status orange in the shop app. Turn data back on → green → payment works. |
| 4   | Late alert → "I paid" fallback | Pay, but keep the shop phone offline until the checkout times out; then on the order page enter the **12-digit UPI Ref No.**                   | Shop app shows a badge and "Customers who say they paid"; shopkeeper checks the UPI app, **Approve** → order gets pickup code and prints.                   |
| 5   | Decline                        | Report a made-up reference                                                                                                                     | Shopkeeper **Decline → Not received**; customer page shows the reason.                                                                                      |
| 6   | Refund                         | Shop rejects a paid order (Jobs → Reject)                                                                                                      | Shop app **Payments → Refunds to send**; shopkeeper sends ₹ back in their UPI app → **I sent the money**; customer page shows refunded.                     |
| 7   | Two customers at once          | Two phones pay the same amount at the same time                                                                                                | YouPI lets one pay at a time (the second waits in a queue); both end up paid and printed, never mixed up.                                                   |
| 8   | Pickup                         | Customer shows **#N · date** at the counter                                                                                                    | Shopkeeper finds the packet by its number.                                                                                                                  |
| 9   | Restart                        | Restart the shop PC                                                                                                                            | App starts with Windows (if enabled), stays paired; nothing reprints.                                                                                       |

Record results (photos of printed packets, screenshots, amounts, times) in `docs/testing/P6.8-pilot-shop-test.md`.

---

## 7. How people use it day to day

**Customer (student):**

1. Open the shop link / `https://app.kagaz.in`, choose the shop, upload the PDF, choose copies,
   B/W or colour, single/double-sided. The price is calculated by the server.
2. **Pay ₹X with UPI** → the payment page shows the shop's UPI QR and app buttons. First time only:
   YouPI asks for name, email, mobile and a password (remembered on that phone).
3. Pay in any UPI app, tap **Payment done**. The order page shows the **pickup code #N · date**
   as soon as the payment is seen.
4. If it says "waiting" for more than a minute and money was taken: **Paid but not confirmed?** →
   enter the 12-digit **UPI Ref No.** from the UPI app's payment details. The shop confirms it.
5. Collect at the counter by saying the pickup code.

**Shopkeeper:** keep the PC app open and the phone charging with internet. Jobs arrive and print
by themselves (Auto) or after **Accept** (Manual). Only two things ever need attention: a **badge on
Payments** (a customer reported a payment — check your UPI app, Approve/Decline) and **Refunds to
send**. Hand over packets by pickup number. See [OPERATOR_GUIDE.md](../guides/OPERATOR_GUIDE.md).

---

## 8. Operations and troubleshooting

| Symptom                        | Check                                                                                        |
| ------------------------------ | -------------------------------------------------------------------------------------------- |
| Site/API unreachable           | `docker compose … ps`; tunnel container running; the 5 public hostnames exist in Cloudflare. |
| Status orange "phone offline"  | Phone internet, battery saver off for the app, app still has notification + SMS permission.  |
| Payment made but not confirmed | The customer can report it (fallback). Also check the phone app shows the SMS was sent.      |
| Upload fails                   | `files.<domain>` hostname present; `api` logs: `docker compose … logs api --tail 100`.       |
| Shop not listed / "closed"     | Admin → shop status **Open** and opening hours.                                              |
| New pairing code / password    | Re-run the bootstrap (§3), with `--reset-passwords` for passwords.                           |

Backups (daily): `docker compose … exec postgres pg_dump -U kagaz -Fc kagaz > kagaz-$(date +%F).dump`
plus the `youpidata` volume (YouPI's SQLite) — see [BACKUP_RESTORE.md](BACKUP_RESTORE.md).
Update the server: `git pull && docker compose … up -d --build` (migrations run automatically).

Known limits for the pilot (ADR-003): one payer per shop UPI ID at a time; YouPI suggests ≤ 20
UPI payments a day per account while experimenting; the customer creates a YouPI login on first
payment; refunds are sent by the shopkeeper by hand.
