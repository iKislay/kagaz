# Kagaz Project - Daily Startup Guide

Every time you restart your laptop or the Pi, the **IP addresses** and **ngrok URL** might change. Follow these steps to get everything running.

---

## 1. Start the Backend (Ubuntu Laptop)

1. Open a terminal and go to the project folder:
   ```bash
   cd /home/kislay/Desktop/coding/kagaz
   ```
2. Start the backend server:
   ```bash
   cd backend
   npm run dev
   ```
   *(Keep this terminal open)*

---

## 2. Start ngrok (Ubuntu Laptop)

1. Open a **new terminal tab** (`Ctrl+Shift+T`).
2. Start ngrok:
   ```bash
   cd /home/kislay/Desktop/coding/kagaz
   ngrok http 3000
   ```
3. **Copy the Forwarding URL** (e.g., `https://a1b2-c3d4.ngrok-free.app`).
   *(Keep this terminal open)*

---

## 3. Find Raspberry Pi's New IP

1. **Check your Pi's monitor** (if connected) and run:
   ```bash
   hostname -I
   ```
   *(Note down the IP, e.g., `10.44.51.221`)*

   **OR** scan from your laptop:
   ```bash
   # Try finding it on the network
   sudo nmap -sn 10.44.51.0/24 | grep -i "raspberry" -B 2
   ```

---

## 4. Update Pi Configuration (SSH)

1. Connect to the Pi (use the NEW IP from Step 3):
   ```bash
   ssh karan@<NEW_PI_IP>
   # Password: 1111
   ```

2. Edit the configuration file:
   ```bash
   cd /home/karan/kagaz/pi-agent
   nano .env
   ```

3. **Update `BACKEND_URL`**:
   - Delete the old ngrok URL.
   - Paste the **NEW ngrok URL** from Step 2.
   - Save: `Ctrl+X` → `Y` → `Enter`.

4. Restart the agent:
   ```bash
   sudo systemctl restart kagaz-agent
   
   # Verify it's running
   sudo systemctl status kagaz-agent
   ```
   *(You should see "Active: active (running)")*

---

## 5. Test the Connection

From your **Ubuntu laptop**, run:
```bash
curl http://<NEW_PI_IP>:5000/health
```
If you get a JSON response (`"status": "ok"`), everything is connected! 🚀

---

## 6. Send a Print Job

1. Open **WhatsApp**.
2. Send **"Hi"** to the bot.
3. Share your **Location**.
4. Select the printer.
5. Upload a document (PDF/Image).
6. Type **"print"**.

---

## Quick Troubleshooting

- **"ssh: connect to host... Connection refused"**: 
  - Wrong IP address. Check `hostname -I` on Pi again.
  - Pi might not be connected to WiFi.

- **"Systemctl status says failed"**:
  - Run `journalctl -u kagaz-agent -f` to see errors.
  - Usually means `BACKEND_URL` is wrong or API key mismatch.

- **"WhatsApp says 'Printer offline'"**:
  - Backend can't reach Pi. Check if ngrok is running and `BACKEND_URL` is correct on Pi.
