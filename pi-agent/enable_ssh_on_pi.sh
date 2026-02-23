#!/bin/bash

# Run this script ON THE RASPBERRY PI (with monitor/keyboard attached)
# to enable SSH and show the IP address

echo "================================"
echo "  Kagaz Pi - SSH Setup Helper"
echo "================================"
echo ""

# Enable SSH
echo "1. Enabling SSH service..."
sudo systemctl enable ssh
sudo systemctl start ssh

# Check SSH status
echo ""
echo "2. SSH Status:"
sudo systemctl status ssh | grep Active

# Show IP address
echo ""
echo "3. Your Raspberry Pi's IP addresses:"
echo ""
hostname -I
echo ""

# Show hostname
echo "4. Your hostname:"
hostname
echo ""

# Install avahi-daemon for .local resolution
echo "5. Installing mDNS service (for .local hostname)..."
sudo apt update
sudo apt install -y avahi-daemon
sudo systemctl enable avahi-daemon
sudo systemctl start avahi-daemon

echo ""
echo "================================"
echo "  SSH is now enabled!"
echo "================================"
echo ""
echo "From your Ubuntu laptop, run:"
echo "  ssh karan@<IP_ADDRESS_FROM_ABOVE>"
echo ""
echo "Or try:"
echo "  ssh karan@$(hostname).local"
echo ""
