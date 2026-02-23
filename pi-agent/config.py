import os
from dotenv import load_dotenv

load_dotenv()

# Backend Configuration
BACKEND_URL = os.getenv('BACKEND_URL', 'http://localhost:3000')
API_KEY = os.getenv('API_KEY')

# Printer Configuration
PRINTER_ID = os.getenv('PRINTER_ID', 'PRINTER001')
PRINTER_NAME = os.getenv('PRINTER_NAME', 'Kagaz Printer')
CUPS_PRINTER_NAME = os.getenv('CUPS_PRINTER_NAME', 'default')

# Location Configuration
LOCATION_ADDRESS = os.getenv('LOCATION_ADDRESS', 'Unknown Location')
LOCATION_LATITUDE = float(os.getenv('LOCATION_LATITUDE', '0.0'))
LOCATION_LONGITUDE = float(os.getenv('LOCATION_LONGITUDE', '0.0'))

# Storage Configuration
STORAGE_PATH = os.getenv('STORAGE_PATH', '/tmp/kagaz/storage')
MAX_STORAGE_DAYS = int(os.getenv('MAX_STORAGE_DAYS', '3'))

# Server Configuration
PORT = int(os.getenv('PORT', '5000'))
FLASK_ENV = os.getenv('FLASK_ENV', 'production')

# Application Constants
MAX_FILE_SIZE = 26214400  # 25MB in bytes
SUPPORTED_MIME_TYPES = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg',
    'image/jpg',
    'image/png'
]

# Job Statuses (must match backend)
JOB_STATUS_PENDING = 'PENDING'
JOB_STATUS_PROCESSING = 'PROCESSING'
JOB_STATUS_PRINTING = 'PRINTING'
JOB_STATUS_COMPLETED = 'COMPLETED'
JOB_STATUS_FAILED = 'FAILED'

# Printer Statuses (must match backend)
PRINTER_STATUS_ONLINE = 'online'
PRINTER_STATUS_OFFLINE = 'offline'
PRINTER_STATUS_BUSY = 'busy'

# Heartbeat Configuration
HEARTBEAT_INTERVAL_SECONDS = 300  # 5 minutes
CLEANUP_TIME = '03:00'  # 3 AM daily

# Retry Configuration
MAX_RETRIES = 3
RETRY_BACKOFF_FACTOR = 2  # Exponential backoff: 1s, 2s, 4s
