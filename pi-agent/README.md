# Kagaz Pi Agent

Python/Flask application that runs on Raspberry Pi to receive print jobs from the Kagaz backend and print them using CUPS.

## Features

- **Flask REST API** - Receives print jobs from backend
- **CUPS Integration** - Submits jobs to local printer
- **File Conversion** - Converts images (JPEG/PNG) and DOCX files to PDF
- **Background Services** - Automatic printer registration and file cleanup
- **Systemd Service** - Auto-start on boot
- **API Key Authentication** - Secure communication with backend

## Architecture

```
Backend (Node.js) ──HTTP POST──> Pi Agent (Flask) ──CUPS──> Physical Printer
                    multipart/form-data          ^
                    (files + jobId)              |
                                          status updates via HTTP POST
```

## Requirements

### Hardware
- Raspberry Pi (tested on Pi 4)
- USB or network printer
- Minimum 8GB SD card
- Internet connection

### Software
- Raspberry Pi OS (Bullseye or later)
- Python 3.9+
- CUPS (printer system)
- LibreOffice (for DOCX conversion)

## Installation

### 1. Automated Installation (Recommended)

```bash
cd /home/pi/kagaz/pi-agent
sudo ./install.sh
```

This will:
- Install system dependencies (CUPS, LibreOffice, Python packages)
- Create Python virtual environment
- Install Python dependencies
- Set up systemd service
- Create storage directory

### 2. Manual Installation

```bash
# Install system dependencies
sudo apt-get update
sudo apt-get install -y python3 python3-pip python3-venv cups libcups2-dev libreoffice

# Create directories
mkdir -p /home/pi/kagaz/storage
cd /home/pi/kagaz/pi-agent

# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install Python packages
pip install -r requirements.txt

# Copy and edit configuration
cp .env.example .env
nano .env
```

## Configuration

Edit `/home/pi/kagaz/pi-agent/.env`:

```bash
# Backend Configuration
BACKEND_URL=https://your-backend.com
API_KEY=your_secure_api_key_here

# Printer Configuration
PRINTER_ID=PRINTER001                  # Unique ID for this printer
PRINTER_NAME=Kagaz MG Road             # Display name
CUPS_PRINTER_NAME=default              # CUPS printer name (check with 'lpstat -p')

# Location (for geospatial search)
LOCATION_ADDRESS=123 MG Road, Bangalore
LOCATION_LATITUDE=12.9716
LOCATION_LONGITUDE=77.5946

# Storage
STORAGE_PATH=/home/pi/kagaz/storage
MAX_STORAGE_DAYS=3                     # Auto-delete files after X days

# Server
PORT=5000
FLASK_ENV=production
```

### Finding Your CUPS Printer Name

```bash
lpstat -p
```

Use the printer name shown in the output.

## Running the Agent

### Using Systemd (Production)

```bash
# Enable auto-start on boot
sudo systemctl enable kagaz-agent

# Start the service
sudo systemctl start kagaz-agent

# Check status
sudo systemctl status kagaz-agent

# View logs
journalctl -u kagaz-agent -f
```

### Manual (Development)

```bash
cd /home/pi/kagaz/pi-agent
source venv/bin/activate
python app.py
```

## API Endpoints

### `POST /print`
Receive print job from backend.

**Headers:**
- `X-API-Key`: API key for authentication

**Form Data:**
- `jobId`: Unique job identifier
- `files`: One or more files (PDF, images, DOCX)

**Response:**
```json
{
  "success": true,
  "job_id": "JOB20260210143022",
  "files_printed": 3,
  "total_pages": 8,
  "cups_job_ids": [123, 124, 125]
}
```

### `GET /health`
Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "printer": {
    "status": "online",
    "queue_length": 2
  },
  "storage": {
    "free_mb": 5120.5,
    "total_mb": 32000.0
  }
}
```

### `GET /status`
Detailed status information.

**Response:**
```json
{
  "printer": {
    "id": "PRINTER001",
    "name": "Kagaz MG Road",
    "status": "online",
    "state_message": "Ready",
    "queue_length": 0,
    "capabilities": {
      "color": false,
      "duplex": false,
      "maxCopies": 1
    }
  },
  "storage": {
    "total_mb": 32000.0,
    "used_mb": 12000.5,
    "free_mb": 19999.5
  },
  "location": {
    "address": "123 MG Road, Bangalore",
    "latitude": 12.9716,
    "longitude": 77.5946
  }
}
```

## Background Services

### Heartbeat (Every 5 minutes)
- Registers printer with backend
- Updates printer status
- Sends capabilities and location

### Cleanup (Daily at 3 AM)
- Deletes files older than `MAX_STORAGE_DAYS`
- Frees up disk space

## File Support

| File Type | Conversion Method |
|-----------|------------------|
| PDF | None (direct print) |
| JPEG/PNG | Pillow → PDF |
| DOCX/DOC | LibreOffice CLI → PDF |

## Troubleshooting

### Printer Not Found
```bash
# List available printers
lpstat -p

# Check CUPS status
sudo systemctl status cups

# Test print
lp -d <printer-name> /path/to/test.pdf
```

### LibreOffice Conversion Fails
```bash
# Check if LibreOffice is installed
soffice --version

# Test conversion manually
soffice --headless --convert-to pdf test.docx
```

### Service Won't Start
```bash
# Check service status
sudo systemctl status kagaz-agent

# View recent logs
journalctl -u kagaz-agent -n 50

# Check Python errors
cd /home/pi/kagaz/pi-agent
source venv/bin/activate
python app.py
```

### Backend Connection Issues
- Verify `BACKEND_URL` in `.env`
- Check API key matches backend configuration
- Verify backend is reachable: `curl $BACKEND_URL/health`

## Development

### Running Tests
```bash
source venv/bin/activate
python -m pytest tests/
```

### Project Structure
```
pi-agent/
├── app.py                  # Main Flask application
├── config.py               # Configuration loader
├── requirements.txt        # Python dependencies
├── install.sh             # Installation script
├── services/
│   ├── printer_service.py  # CUPS integration
│   ├── file_service.py     # File handling & conversion
│   ├── backend_service.py  # Backend communication
│   └── scheduler.py        # Background tasks
├── utils/
│   └── logger.py          # Structured logging
└── tests/
    └── (test files)
```

## Security

- **API Key Authentication**: All `/print` requests require valid `X-API-Key` header
- **Filename Sanitization**: Prevents path traversal attacks
- **File Type Validation**: Only supported MIME types accepted
- **Disk Space Checks**: Rejects jobs when < 1GB free space

## License

MIT

## Support

For issues or questions, contact: support@kagaz.com
