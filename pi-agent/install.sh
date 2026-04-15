#!/bin/bash

# Kagaz Pi Agent Installation Script (Final Fix for Python 3.13)
# Run with: sudo ./install.sh

set -e

echo "================================"
echo "Kagaz Pi Agent Installation"
echo "================================"

# Get the actual user (the one who called sudo)
REAL_USER=${SUDO_USER:-$(whoami)}
REAL_HOME=$(eval echo ~$REAL_USER)
APP_DIR=$(pwd)

echo "Installing for User: $REAL_USER"
echo "Application Directory: $APP_DIR"

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo "Please run as root (sudo ./install.sh)"
    exit 1
fi

# Update system
echo "Updating system packages..."
apt-get update

# Install system dependencies
echo "Installing system dependencies..."
# python3-cups is essential here because the pip version is broken on Python 3.13
apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    python3-cups \
    cups \
    libcups2-dev \
    libreoffice \
    python3-magic \
    git \
    libopenjp2-7-dev libtiff5-dev libjpeg-dev zlib1g-dev \
    libfreetype-dev liblcms2-dev libwebp-dev libharfbuzz-dev \
    libfribidi-dev libxcb1-dev

# Create storage directory
echo "Creating storage directory..."
STORAGE_DIR="$REAL_HOME/kagaz/storage"
mkdir -p "$STORAGE_DIR"
chown -R $REAL_USER:$REAL_USER "$REAL_HOME/kagaz"

# Recreate Python virtual environment with system-site-packages
echo "Setting up Python virtual environment..."
if [ -d "$APP_DIR/venv" ]; then
    echo "Removing old venv..."
    rm -rf "$APP_DIR/venv"
fi
su - $REAL_USER -c "cd $APP_DIR && python3 -m venv --system-site-packages venv"

# Install Python dependencies
echo "Installing Python dependencies..."
su - $REAL_USER -c "cd $APP_DIR && source venv/bin/activate && pip install --upgrade pip setuptools wheel"
su - $REAL_USER -c "cd $APP_DIR && source venv/bin/activate && pip install 'Pillow>=11.0.0' 'aiohttp>=3.10.2'"

# CRITICAL: Exclude pycups, Pillow, and aiohttp from requirements.txt to prevent build errors
su - $REAL_USER -c "cd $APP_DIR && source venv/bin/activate && grep -vE 'Pillow|pycups|aiohttp' requirements.txt > requirements_fixed.txt && pip install -r requirements_fixed.txt"

# Create .env file if it doesn't exist
if [ ! -f "$APP_DIR/.env" ]; then
    echo "Creating .env file from template..."
    cp .env.example .env
    chown $REAL_USER:$REAL_USER .env
fi

# Install systemd service
echo "Installing systemd service..."
cat > /etc/systemd/system/kagaz-agent.service << EOF
[Unit]
Description=Kagaz Print Agent
After=network.target cups.service
Wants=cups.service

[Service]
Type=simple
User=$REAL_USER
WorkingDirectory=$APP_DIR
Environment="PATH=$APP_DIR/venv/bin:/usr/local/bin:/usr/bin:/bin"
ExecStart=$APP_DIR/venv/bin/python app.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Reload systemd
systemctl daemon-reload

echo ""
echo "================================"
echo "Installation Complete!"
echo "================================"
echo "The agent is now using the system 'pycups' to support Python 3.13."
echo ""
echo "1. Restart:      sudo systemctl restart kagaz-agent"
echo "2. Logs:         journalctl -u kagaz-agent -f"
echo ""
