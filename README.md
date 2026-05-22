# Kagaz — WhatsApp Print Kiosk

Print documents from WhatsApp to nearby kiosks. No app required.

---

## Architecture

```
WhatsApp User
     │  (sends files / location / commands)
     ▼
Meta WhatsApp Cloud API
     │  (webhook POST)
     ▼
Next.js App  (/api/webhook)
     │
     ├── MongoDB (user sessions, print jobs, printers)
     ├── Cloudflare R2 (file storage)
     └── Socket.io → Raspberry Pi agent (receives job, prints)
```

---

## Prerequisites

- Node.js 20+
- A MongoDB Atlas cluster (already configured)
- A Cloudflare R2 bucket (already configured)
- A Meta Developer account with a WhatsApp Business App
- A publicly accessible URL for your server (use [ngrok](https://ngrok.com) for local dev)

---

## Step 1 — Meta Developer Setup

### 1.1 Create a Meta App

1. Go to [developers.facebook.com](https://developers.facebook.com) and log in.
2. Click **My Apps** → **Create App**.
3. Select **Business** as the app type → click **Next**.
4. Enter an app name (e.g., `Kagaz`) and your business account → **Create App**.

### 1.2 Add WhatsApp Product

1. On the app dashboard, find **WhatsApp** and click **Set up**.
2. You'll land on the **WhatsApp > API Setup** page.

### 1.3 Collect Required Values

From the **API Setup** page, copy these two values — you'll need them for `.env`:

| Value | Where to find it |
|---|---|
| **Phone Number ID** | Listed under "From" phone number — looks like `123456789012345` |
| **WhatsApp Business Account ID** | Shown at the top of the API Setup page |

> The **temporary access token** shown here expires in 24 hours. For production, generate a permanent System User token — see Step 1.5.

### 1.4 Add a Test Phone Number

1. Under **To**, click **Manage phone number list**.
2. Add your personal WhatsApp number (with country code, e.g., `+919876543210`).
3. Verify it with the OTP sent to your phone.

### 1.5 Generate a Permanent Access Token

1. Go to [business.facebook.com](https://business.facebook.com) → **Settings** → **System Users**.
2. Click **Add** → create a System User with **Admin** role.
3. Click **Generate New Token** → select your Kagaz app → grant permissions:
   - `whatsapp_business_messaging`
   - `whatsapp_business_management`
4. Copy the generated token — this is your `WHATSAPP_ACCESS_TOKEN`.

---

## Step 2 — Configure Environment Variables

Edit `web/.env`:

```env
# WhatsApp Cloud API (Meta)
WHATSAPP_ACCESS_TOKEN=your_permanent_access_token_here
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id_here
WHATSAPP_VERIFY_TOKEN=kagaz-webhook-verify-2026
```

> `WHATSAPP_VERIFY_TOKEN` is a string you choose — it must match exactly what you enter in the Meta webhook configuration (Step 3).

---

## Step 3 — Register the Webhook

Your app must be reachable from the internet. For local development:

```bash
# Install ngrok if you haven't
npm install -g ngrok

# Start your app first (port 3000)
cd web && npm run dev

# In a separate terminal, expose port 3000
ngrok http 3000
```

Copy the `https://xxxx.ngrok-free.app` URL from ngrok output.

### 3.1 Configure Webhook in Meta Dashboard

1. In your Meta app, go to **WhatsApp** → **Configuration** → **Webhook**.
2. Click **Edit**.
3. Set:
   - **Callback URL**: `https://your-ngrok-url.ngrok-free.app/api/webhook`
   - **Verify Token**: `kagaz-webhook-verify-2026` *(must match your `.env`)*
4. Click **Verify and Save** — Meta will call your endpoint to confirm.

### 3.2 Subscribe to Webhook Fields

After saving, click **Manage** next to Webhook Fields and subscribe to:
- `messages` ✓

---

## Step 4 — Install Dependencies & Run

```bash
cd web
npm install
npm run dev
```

The server starts on `http://localhost:3000`.

---

## Step 5 — Test the Bot

1. Open WhatsApp on your phone.
2. Message the test number shown in Meta API Setup.
3. Send: **hi**
4. Follow the prompts — share your location or enter a printer code.

---

## Step 6 — Register a Printer (Raspberry Pi)

Before any print jobs work, register at least one printer:

```bash
curl -X POST https://your-server.com/api/printers/register \
  -H "Content-Type: application/json" \
  -d '{
    "printerId": "DEMO01",
    "name": "Demo Printer",
    "location": {
      "address": "123 MG Road, Bangalore",
      "city": "Bangalore",
      "coordinates": {
        "type": "Point",
        "coordinates": [77.5946, 12.9716]
      }
    },
    "ipAddress": "192.168.1.100",
    "port": 5000,
    "apiKey": "your-secret-api-key"
  }'
```

> **Coordinates format**: `[longitude, latitude]` (GeoJSON standard)

---

## Bot Commands Reference

| Command | Action |
|---|---|
| `hi` / `hello` / `start` | Start a new print session |
| Share location | Find nearby printers |
| `CODE:XXXX` | Connect to printer by code |
| `1` / `2` / `3` | Select printer from list |
| *(send a file)* | Upload PDF, DOC, DOCX, JPG, or PNG |
| `print` / `ok` / `done` | Submit print job |
| `reset` / `cancel` | Start over |
| `help` | Show instructions |

---

## Environment Variables Reference

| Variable | Description |
|---|---|
| `MONGODB_URI` | MongoDB connection string |
| `JWT_SECRET` | Secret for guest auth tokens |
| `R2_ACCOUNT_ID` | Cloudflare R2 account ID |
| `R2_ACCESS_KEY_ID` | R2 access key |
| `R2_SECRET_ACCESS_KEY` | R2 secret key |
| `R2_BUCKET_NAME` | R2 bucket name |
| `R2_PUBLIC_URL` | Public URL for R2 bucket |
| `WHATSAPP_ACCESS_TOKEN` | Meta System User access token |
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp phone number ID from Meta |
| `WHATSAPP_VERIFY_TOKEN` | Your chosen webhook verification token |

---

## File Support

| Format | MIME Type | Max Size |
|---|---|---|
| PDF | `application/pdf` | 25 MB |
| Word (.doc) | `application/msword` | 25 MB |
| Word (.docx) | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | 25 MB |
| JPEG | `image/jpeg` | 25 MB |
| PNG | `image/png` | 25 MB |

Maximum 10 files per print job.

---

## Production Deployment

1. Deploy the `web/` folder to any Node.js host (Railway, Render, VPS).
2. Set all environment variables in your hosting dashboard.
3. Update the webhook URL in Meta to your production domain.
4. The Raspberry Pi agent connects via Socket.io to the same server.
