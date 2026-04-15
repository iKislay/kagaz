import asyncio
import os
import traceback
import socket
import time
import aiohttp
import socketio
from threading import Thread
from flask import Flask, jsonify

import config
from utils.logger import logger
from services.printer_service import PrinterService
from services.file_service import FileService

# ---------------------------------------------------------------------------
# Flask health server (runs on a separate port for local monitoring)
# ---------------------------------------------------------------------------
health_app = Flask(__name__)
printer_service = PrinterService()
file_service = FileService()

@health_app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    try:
        status_info = printer_service.get_printer_status()
        disk_info = file_service.get_disk_space()

        return jsonify({
            'status': 'ok',
            'printer': {
                'status': status_info['status'],
                'queue_length': status_info['queue_length']
            },
            'storage': {
                'free_mb': disk_info['free_mb'],
                'total_mb': disk_info['total_mb']
            }
        }), 200
    except Exception as e:
        logger.error('Health check failed', extra={'context': {'error': str(e)}})
        return jsonify({'status': 'error', 'message': str(e)}), 500

@health_app.route('/status', methods=['GET'])
def get_status():
    """Detailed status endpoint"""
    try:
        status_info = printer_service.get_printer_status()
        disk_info = file_service.get_disk_space()
        capabilities = printer_service.get_printer_capabilities()

        return jsonify({
            'printer': {
                'id': config.PRINTER_ID,
                'name': config.PRINTER_NAME,
                'status': status_info['status'],
                'state_message': status_info['state_message'],
                'queue_length': status_info['queue_length'],
                'capabilities': capabilities
            },
            'storage': disk_info,
            'location': {
                'address': config.LOCATION_ADDRESS,
                'latitude': config.LOCATION_LATITUDE,
                'longitude': config.LOCATION_LONGITUDE
            }
        }), 200
    except Exception as e:
        logger.error('Status check failed', extra={'context': {'error': str(e)}})
        return jsonify({'error': str(e)}), 500

def run_health_server():
    """Run Flask health server in background thread"""
    health_port = int(os.getenv('HEALTH_PORT', '5001'))
    logger.info('Starting health server', extra={'context': {'port': health_port}})
    health_app.run(host='0.0.0.0', port=health_port, debug=False, use_reloader=False)

# ---------------------------------------------------------------------------
# Helper utilities
# ---------------------------------------------------------------------------

def get_local_ip():
    """Get local IP address"""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return 'unknown'

async def download_file(session: aiohttp.ClientSession, url: str, dest_path: str, retries: int = 3) -> bool:
    """Download a file from a URL with retry logic"""
    for attempt in range(1, retries + 1):
        try:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=60)) as resp:
                if resp.status != 200:
                    raise Exception(f'HTTP {resp.status} fetching {url}')

                os.makedirs(os.path.dirname(dest_path), exist_ok=True)
                with open(dest_path, 'wb') as f:
                    async for chunk in resp.content.iter_chunked(8192):
                        f.write(chunk)

                logger.info('File downloaded', extra={'context': {
                    'url': url,
                    'dest': dest_path,
                    'attempt': attempt
                }})
                return True

        except Exception as e:
            wait = config.RETRY_BACKOFF_FACTOR ** (attempt - 1)
            logger.warning(f'Download attempt {attempt} failed, retrying in {wait}s', extra={
                'context': {'url': url, 'error': str(e)}
            })
            if attempt < retries:
                await asyncio.sleep(wait)

    return False

# ---------------------------------------------------------------------------
# Socket.io async client
# ---------------------------------------------------------------------------

async def run_socketio_client():
    """Main Socket.io client loop — connects to Next.js server and handles events"""

    sio = socketio.AsyncClient(
        reconnection=True,
        reconnection_attempts=0,       # infinite reconnection
        reconnection_delay=5,
        reconnection_delay_max=30,
        logger=False
    )

    # ------------------------------------------------------------------
    # Register printer via HTTP POST after connecting
    # ------------------------------------------------------------------
    async def http_register_printer(session: aiohttp.ClientSession):
        """Send HTTP registration/heartbeat so printer appears in MongoDB"""
        try:
            status_info = printer_service.get_printer_status()
            capabilities = printer_service.get_printer_capabilities()

            payload = {
                'printerId': config.PRINTER_ID,
                'name': config.PRINTER_NAME,
                'location': {
                    'address': config.LOCATION_ADDRESS,
                    'city': '',
                    'coordinates': {
                        'type': 'Point',
                        'coordinates': [config.LOCATION_LONGITUDE, config.LOCATION_LATITUDE]
                    }
                },
                'ipAddress': get_local_ip(),
                'port': int(os.getenv('HEALTH_PORT', '5001')),
                'apiKey': config.API_KEY,
                'status': status_info['status'],
                'capabilities': {
                    'color': capabilities.get('color', False),
                    'duplex': capabilities.get('duplex', False),
                    'maxPageSize': 'A4'
                }
            }

            url = f'{config.BACKEND_URL}/api/printers/register'
            headers = {'ngrok-skip-browser-warning': 'true'}
            async with session.post(url, json=payload, headers=headers, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                if resp.status in (200, 201):
                    logger.info('Printer registered via HTTP', extra={'context': {
                        'printer_id': config.PRINTER_ID
                    }})
                else:
                    body = await resp.text()
                    logger.warning('Printer HTTP registration failed', extra={'context': {
                        'status': resp.status, 'body': body
                    }})
        except Exception as e:
            logger.error('HTTP registration error', extra={'context': {'error': str(e)}})

    # ------------------------------------------------------------------
    # Socket.io event handlers
    # ------------------------------------------------------------------

    @sio.event
    async def connect():
        logger.info('Socket.io connected to Next.js server', extra={'context': {
            'server': config.BACKEND_URL
        }})
        # Authenticate as printer
        await sio.emit('printer:join', {
            'printerId': config.PRINTER_ID,
            'apiKey': config.API_KEY
        })

    @sio.on('printer:join:success')
    async def on_join_success(data):
        logger.info('Printer join acknowledged', extra={'context': data})

    @sio.on('printer:join:error')
    async def on_join_error(data):
        logger.error('Printer join rejected', extra={'context': data})

    @sio.on('job:new')
    async def on_job_new(data):
        """Handle incoming print job from Next.js server"""
        job_id = data.get('jobId')
        file_urls = data.get('fileUrls', [])
        settings = data.get('settings', {})

        logger.info('New print job received', extra={'context': {
            'job_id': job_id,
            'file_count': len(file_urls),
            'settings': settings
        }})

        async with aiohttp.ClientSession() as session:
            try:
                # --- Report: PROCESSING ---
                await emit_job_status(sio, job_id, config.JOB_STATUS_PROCESSING)

                # --- Check disk space ---
                disk_info = file_service.get_disk_space()
                if disk_info['free_mb'] < 1024:
                    raise Exception('Insufficient disk space (< 1 GB free)')

                # --- Download files ---
                saved_files = []
                job_dir = os.path.join(config.STORAGE_PATH, job_id)

                for idx, url in enumerate(file_urls):
                    ext = url.split('?')[0].split('.')[-1].lower() or 'bin'
                    dest = os.path.join(job_dir, f'file_{idx:03d}.{ext}')
                    ok = await download_file(session, url, dest)
                    if not ok:
                        raise Exception(f'Failed to download file {idx + 1}')
                    saved_files.append(dest)

                # --- Convert to PDF ---
                pdf_files = []
                total_pages = 0

                for file_path in saved_files:
                    try:
                        pdf_path = file_service.convert_to_pdf(file_path)
                        pdf_files.append(pdf_path)
                        total_pages += file_service.get_pdf_page_count(pdf_path)
                    except Exception as conv_err:
                        raise Exception(f'Conversion failed: {conv_err}')

                # --- Report: PRINTING ---
                await emit_job_status(sio, job_id, config.JOB_STATUS_PRINTING)

                # --- Print via CUPS ---
                cups_job_ids = []
                copies = int(settings.get('copies', 1))
                color = bool(settings.get('color', False))
                duplex = bool(settings.get('duplex', False))

                for pdf_path in pdf_files:
                    # Build CUPS options
                    options = {
                        'copies': str(copies),
                        'ColorModel': 'RGB' if color else 'Gray',
                        'sides': 'two-sided-long-edge' if duplex else 'one-sided',
                        'media': settings.get('pageSize', 'A4')
                    }

                    cups_job_id = printer_service.print_pdf(pdf_path, job_id)
                    cups_job_ids.append(cups_job_id)

                # --- Report: COMPLETED ---
                await emit_job_status(sio, job_id, config.JOB_STATUS_COMPLETED)

                logger.info('Print job completed', extra={'context': {
                    'job_id': job_id,
                    'total_pages': total_pages,
                    'cups_jobs': cups_job_ids
                }})

            except Exception as e:
                err_trace = traceback.format_exc()
                logger.error('Print job failed', extra={'context': {
                    'job_id': job_id,
                    'error': str(e),
                    'trace': err_trace
                }})
                await emit_job_status(sio, job_id, config.JOB_STATUS_FAILED, error=str(e))

    @sio.event
    async def disconnect():
        logger.warning('Disconnected from Next.js server, will reconnect automatically')

    @sio.event
    async def connect_error(data):
        logger.error('Socket.io connection error', extra={'context': {'data': str(data)}})

    # ------------------------------------------------------------------
    # Main connection loop with registration heartbeat
    # ------------------------------------------------------------------
    server_url = config.BACKEND_URL
    logger.info('Connecting to Next.js server', extra={'context': {'url': server_url}})

    await sio.connect(
        server_url, 
        socketio_path='/socket.io', 
        transports=['websocket', 'polling'],
        headers={'ngrok-skip-browser-warning': 'true'}
    )

    # Run periodic HTTP registration heartbeat
    async def heartbeat_loop():
        async with aiohttp.ClientSession() as session:
            while True:
                await http_register_printer(session)
                await asyncio.sleep(config.HEARTBEAT_INTERVAL_SECONDS)

    heartbeat_task = asyncio.create_task(heartbeat_loop())

    try:
        await sio.wait()
    finally:
        heartbeat_task.cancel()
        try:
            await heartbeat_task
        except asyncio.CancelledError:
            pass

async def emit_job_status(sio: socketio.AsyncClient, job_id: str, status: str, error: str = None):
    """Emit job status update back to server"""
    payload = {'jobId': job_id, 'status': status}
    if error:
        payload['error'] = error
    await sio.emit('job:status', payload)
    logger.info('Job status emitted', extra={'context': {'job_id': job_id, 'status': status}})

# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    # Start health server in background thread
    health_thread = Thread(target=run_health_server, daemon=True)
    health_thread.start()

    logger.info('Kagaz Print Agent starting (WebSocket mode)', extra={'context': {
        'printer_id': config.PRINTER_ID,
        'printer_name': config.PRINTER_NAME,
        'backend_url': config.BACKEND_URL
    }})

    # Run the Socket.io client
    try:
        asyncio.run(run_socketio_client())
    except KeyboardInterrupt:
        logger.info('Shutting down gracefully')
    except Exception as e:
        logger.error('Fatal error', extra={'context': {'error': str(e), 'trace': traceback.format_exc()}})
        raise
