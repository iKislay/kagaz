#!/bin/bash

# Kagaz Pi Agent Installation Script
# Run with: sudo ./install.sh

set -e

echo "================================"
echo "Kagaz Pi Agent Installation"
echo "================================"

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo "Please run as root (sudo ./install.sh)"
    exit 1
fi

# Update system
echo "Updating system packages..."
apt-get update
apt-get upgrade -y

# Install system dependencies
echo "Installing system dependencies..."
apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    cups \
    libcups2-dev \
    libreoffice \
    python3-magic \
    git

# Create application directory
echo "Creating application directory..."
APP_DIR="/home/pi/kagaz/pi-agent"
mkdir -p "$APP_DIR"
cd "$APP_DIR"

# Copy files (assuming script is run from pi-agent directory)
echo "Copying application files..."
cp -r ../pi-agent/* .

# Create storage directory
echo "Creating storage directory..."
mkdir -p /home/pi/kagaz/storage
chown -R pi:pi /home/pi/kagaz

# Create Python virtual environment
echo "Setting up Python virtual environment..."
su - pi -c "cd $APP_DIR && python3 -m venv venv"

# Install Python dependencies
echo "Installing Python dependencies..."
su - pi -c "cd $APP_DIR && source venv/bin/activate && pip install --upgrade pip && pip install -r requirements.txt"

# Create .env file if it doesn't exist
if [ ! -f "$APP_DIR/.env" ]; then
    echo "Creating .env file from template..."
    cp .env.example .env
    echo ""
    echo "⚠️  IMPORTANT: Edit /home/pi/kagaz/pi-agent/.env with your configuration!"
    echo ""
fi

# Install systemd service
echo "Installing systemd service..."
cat > /etc/systemd/system/kagaz-agent.service << 'EOF'
[Unit]
Description=Kagaz Print Agent
After=network.target cups.service
Wants=cups.service

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/kagaz/pi-agent
Environment="PATH=/home/pi/kagaz/pi-agent/venv/bin:/usr/local/bin:/usr/bin:/bin"
ExecStart=/home/pi/kagaz/pi-agent/venv/bin/python app.py
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
echo ""
echo "Next steps:"
echo "1. Edit configuration:   nano /home/pi/kagaz/pi-agent/.env"
echo "2. Test CUPS connection: lpstat -p"
echo "3. Enable service:       sudo systemctl enable kagaz-agent"
echo "4. Start service:        sudo systemctl start kagaz-agent"
echo "5. Check status:         sudo systemctl status kagaz-agent"
echo "6. View logs:            journalctl -u kagaz-agent -f"
echo ""
