#!/bin/bash

# Kagaz Pi Agent — Remote Deployment Script
# Run this from your Ubuntu laptop to deploy to Raspberry Pi
# Usage: ./deploy.sh <pi-username> <pi-ip-address>

set -e

PI_USER="${1:-pi}"
PI_IP="${2:-raspberrypi.local}"
PI_DIR="/home/${PI_USER}/kagaz"

echo "================================"
echo "  Kagaz Pi Agent Deployment"
echo "================================"
echo ""
echo "Target: ${PI_USER}@${PI_IP}"
echo "Directory: ${PI_DIR}"
echo ""

# Check SSH connectivity
echo "1/5: Testing SSH connection..."
ssh -o ConnectTimeout=5 "${PI_USER}@${PI_IP}" "echo 'SSH OK'" || {
    echo "❌ Cannot connect via SSH. Make sure:"
    echo "   - Pi is powered on and connected to the same network"
    echo "   - SSH is enabled on the Pi"
    echo "   - IP address is correct"
    echo ""
    echo "   To find Pi IP: check your router or use 'nmap -sn 192.168.1.0/24'"
    echo "   To enable SSH on Pi: sudo raspi-config → Interface Options → SSH"
    exit 1
}

# Create remote directory
echo "2/5: Creating remote directory..."
ssh "${PI_USER}@${PI_IP}" "mkdir -p ${PI_DIR}"

# Copy pi-agent files
echo "3/5: Copying files to Pi..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
rsync -avz --exclude 'venv' --exclude '__pycache__' --exclude '.env' --exclude 'storage' \
    "${SCRIPT_DIR}/" "${PI_USER}@${PI_IP}:${PI_DIR}/pi-agent/"

echo "4/5: Setting permissions..."
ssh "${PI_USER}@${PI_IP}" "chmod +x ${PI_DIR}/pi-agent/install.sh"

echo "5/5: Deployment complete!"
echo ""
echo "================================"
echo "  Next Steps (on the Pi):"
echo "================================"
echo ""
echo "1. SSH into the Pi:"
echo "   ssh ${PI_USER}@${PI_IP}"
echo ""
echo "2. Run the installer:"
echo "   cd ${PI_DIR}/pi-agent"
echo "   sudo ./install.sh"
echo ""
echo "3. Configure your .env:"
echo "   nano ${PI_DIR}/pi-agent/.env"
echo ""
echo "4. Start the agent:"
echo "   sudo systemctl start kagaz-agent"
echo ""
