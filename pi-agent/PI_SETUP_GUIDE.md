# Raspberry Pi Setup Guide for Kagaz

Complete step-by-step guide to set up your Raspberry Pi for the Kagaz print agent.

---

## Step 1: Connect to Your Pi from Ubuntu

You have **two options**: SSH (terminal-only, recommended) or VNC (graphical desktop).

### Option A: SSH (Recommended — No extra software needed)
ip
**On the Pi** (using the monitor/keyboard you have connected):
```bash
# Enable SSH
sudo raspi-config
# Navigate: Interface Options → SSH → Enable
# Or just run:
sudo systemctl enable ssh
sudo systemctl start ssh

# Get Pi's IP address (note this down!)
hostname -I
```

**On your Ubuntu laptop:**
```bash
# Connect to Pi (replace with your Pi's IP)
ssh pi@<PI_IP_ADDRESS>

# Example:
ssh pi@192.168.1.42
```

> **Finding Pi's IP**: If you can't access the Pi's display, run on Ubuntu:
> ```bash
> # Install nmap if not present: sudo apt install nmap
> nmap -sn 192.168.1.0/24 | grep -i "raspberry\|pi"
> ```

### Option B: VNC (Graphical Desktop)

**On the Pi:**
```bash
# Enable VNC
sudo raspi-config
# Navigate: Interface Options → VNC → Enable

# Install RealVNC Server (if not already installed)
sudo apt update
sudo apt install realvnc-vnc-server realvnc-vnc-viewer
sudo systemctl enable vncserver-x11-serviced
sudo systemctl start vncserver-x11-serviced
```

**On your Ubuntu laptop:**
```bash
# Install Remmina (VNC client for Ubuntu — no need for Rufus!)
sudo apt install remmina remmina-plugin-vnc

# Open Remmina
remmina
# Create new connection → Protocol: VNC → Server: <PI_IP>:5900
```

> **Alternative VNC clients for Ubuntu:**
> - **Remmina** (pre-installed on many distros) ← Recommended
> - **TigerVNC**: `sudo apt install tigervnc-viewer` → `vncviewer <PI_IP>:5900`
> - **RealVNC Viewer**: Download from https://www.realvnc.com/en/connect/download/viewer/linux/

---

## Step 2: Install CUPS and Set Up Printer

**SSH into the Pi** and run:

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install CUPS (printer system)
sudo apt install -y cups

# Add your user to lpadmin group (to manage printers)
sudo usermod -aG lpadmin $USER

# Enable CUPS to accept remote connections (for web admin)
sudo cupsctl --remote-admin --remote-any --share-printers

# Restart CUPS
sudo systemctl restart cups
```

### Connect Your Printer

1. **USB Printer**: Plug it into the Pi's USB port
2. **Verify detection**:
   ```bash
   lpinfo -v
   # You should see something like: direct usb://HP/LaserJet...
   ```

### Add Printer via CUPS Web Interface

1. Open a browser on your Ubuntu laptop
2. Go to: `https://<PI_IP>:631`
3. Click **Administration → Add Printer**
4. Login with your Pi username/password
5. Select your USB printer
6. Give it a name (e.g., `kagaz_printer`)
7. Check "Share This Printer"
8. Select the correct driver
9. Click **Add Printer**

### Verify Printer Works

```bash
# List printers
lpstat -p

# Print a test page
echo "Kagaz Test Print" | lp -d kagaz_printer
```

**Note the printer name** — you'll need it for the `.env` file (e.g., `kagaz_printer`).

---

## Step 3: Install System Dependencies

```bash
# Install Python, LibreOffice, and build tools
sudo apt install -y \
    python3 \
    python3-pip \
    python3-venv \
    libcups2-dev \
    libreoffice \
    python3-dev \
    gcc
```

---

## Step 4: Deploy Kagaz Agent

### Option A: Deploy from Ubuntu Laptop (Recommended)

On your **Ubuntu laptop**:
```bash
cd /home/kislay/Desktop/coding/kagaz/pi-agent
./deploy.sh <pi-username> <pi-ip>

# Example:
./deploy.sh pi 192.168.1.42
```

### Option B: Manual Copy

```bash
# From Ubuntu laptop
scp -r /home/kislay/Desktop/coding/kagaz/pi-agent/ pi@<PI_IP>:/home/pi/kagaz/pi-agent/
```

---

## Step 5: Configure and Install on Pi

**SSH into the Pi:**

```bash
cd /home/pi/kagaz/pi-agent

# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install Python packages
pip install --upgrade pip
pip install -r requirements.txt

# Create your .env file
cp .env.example .env
nano .env
```

### Edit `.env` with your values:

```bash
# Your backend URL (use your ngrok URL for testing)
BACKEND_URL=https://a148-61-1-116-221.ngrok-free.app

# API Key (make up a secure one — must also be added to backend)
API_KEY=kagaz_pi_agent_secret_key_2026

# Printer Configuration
PRINTER_ID=PRINTER001
PRINTER_NAME=Kagaz Home Printer
CUPS_PRINTER_NAME=kagaz_printer   # ← from Step 2!

# Your location (use Google Maps to find coordinates)
LOCATION_ADDRESS=Your Address Here
LOCATION_LATITUDE=12.9716
LOCATION_LONGITUDE=77.5946

# Storage
STORAGE_PATH=/home/pi/kagaz/storage
MAX_STORAGE_DAYS=3

# Server
PORT=5000
FLASK_ENV=production
```

### Create storage directory:
```bash
mkdir -p /home/pi/kagaz/storage
```

---

## Step 6: Test the Agent

```bash
cd /home/pi/kagaz/pi-agent
source venv/bin/activate
python app.py
```

You should see:
```json
{"timestamp":"...","level":"INFO","message":"CUPS connection established"}
{"timestamp":"...","level":"INFO","message":"Printer registered successfully"}
{"timestamp":"...","level":"INFO","message":"Kagaz Print Agent starting","context":{"port":5000}}
```

**Test health endpoint** (from your Ubuntu laptop):
```bash
curl http://<PI_IP>:5000/health
```

Press `Ctrl+C` to stop the test.

---

## Step 7: Install as System Service

```bash
# Install the systemd service
sudo cp /home/pi/kagaz/pi-agent/kagaz-agent.service /etc/systemd/system/

# If your username isn't "pi", edit the service file:
sudo nano /etc/systemd/system/kagaz-agent.service
# Change User=pi to User=<your-username>
# Change all /home/pi/ to /home/<your-username>/

# Reload systemd
sudo systemctl daemon-reload

# Enable auto-start on boot
sudo systemctl enable kagaz-agent

# Start the service
sudo systemctl start kagaz-agent

# Check status
sudo systemctl status kagaz-agent

# View live logs
journalctl -u kagaz-agent -f
```

---

## Step 8: Connect Backend to Pi

On your **Ubuntu laptop**, update the backend to know the Pi's API key.

Add to `backend/.env`:
```bash
# Pi Agent API Key (must match PI's .env API_KEY)
PI_AGENT_API_KEY=kagaz_pi_agent_secret_key_2026
```

---

## Step 9: End-to-End Test

1. **Start backend** on Ubuntu: `cd backend && npm run dev`
2. **Start ngrok**: `ngrok http 3000`
3. **Verify Pi agent is running**: `curl http://<PI_IP>:5000/health`
4. **Open WhatsApp** and send "Hi" to the test number
5. Share your location → Select printer → Upload a PDF → Type "print"
6. **Watch the printer!** 🖨️

---

## Troubleshooting

### "Cannot connect via SSH"
```bash
# On Pi (with monitor):
sudo systemctl status ssh
sudo systemctl start ssh
```

### "Printer not found in CUPS"
```bash
# Check if printer is detected
lsusb
lpinfo -v
lpstat -p -d
```

### "pycups installation fails"
```bash
sudo apt install libcups2-dev python3-dev gcc
pip install pycups
```

### "LibreOffice conversion fails"
```bash
soffice --version
# If not installed:
sudo apt install libreoffice
```

### "Agent can't reach backend"
```bash
# Test from Pi
curl https://your-ngrok-url.app/health
# If using ngrok, make sure it's still running on your laptop
```
