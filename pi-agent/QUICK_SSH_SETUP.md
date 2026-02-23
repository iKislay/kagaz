# Quick Pi SSH Setup

Since we can't reach the Pi from your laptop yet, **you need to run these commands ON THE PI** (using the monitor and keyboard you have connected).

---

## Option 1: Run the Helper Script (Easiest)

**On the Raspberry Pi terminal:**

```bash
# Download the script (if you have network access on Pi)
wget https://raw.githubusercontent.com/your-repo/enable_ssh_on_pi.sh
chmod +x enable_ssh_on_pi.sh
./enable_ssh_on_pi.sh
```

**OR create and run it manually:**

```bash
# Create the script
cat > enable_ssh.sh << 'EOF'
#!/bin/bash
echo "Enabling SSH..."
sudo systemctl enable ssh
sudo systemctl start ssh
echo ""
echo "Your IP addresses:"
hostname -I
echo ""
echo "Now from your Ubuntu laptop, run:"
echo "  ssh karan@<IP_FROM_ABOVE>"
EOF

# Run it
chmod +x enable_ssh.sh
./enable_ssh.sh
```

---

## Option 2: Manual Commands (Run on Pi)

**On the Pi terminal:**

```bash
# 1. Enable SSH
sudo systemctl enable ssh
sudo systemctl start ssh

# 2. Get your IP address (note this down!)
hostname -I

# 3. (Optional) Install mDNS for .local hostname resolution
sudo apt update
sudo apt install -y avahi-daemon
sudo systemctl enable avahi-daemon
sudo systemctl start avahi-daemon
```

---

## Then, on Your Ubuntu Laptop

Once you have the IP address from above:

```bash
ssh karan@<IP_ADDRESS>
# Password: 1111

# Example:
ssh karan@192.168.1.100
```

---

## If hostname is configured correctly, you can also try:

```bash
ssh karan@raspberrypi.local
# or
ssh karan@pi.local
```

---

**Once connected, let me know and I'll deploy the agent!**
