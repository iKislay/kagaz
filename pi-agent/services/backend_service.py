import requests
import time
import config
from utils.logger import logger

class BackendService:
    """Handles all communication with Node.js backend"""
    
    def __init__(self, printer_service):
        """
        Initialize backend service
        
        Args:
            printer_service: PrinterService instance for getting status
        """
        self.printer_service = printer_service
        self.base_url = config.BACKEND_URL
    
    def register_printer(self):
        """
        Register/heartbeat printer with backend
        
        Returns:
            bool: True if successful
        """
        try:
            # Get current printer status and capabilities
            status_info = self.printer_service.get_printer_status()
            capabilities = self.printer_service.get_printer_capabilities()
            
            payload = {
                'printerId': config.PRINTER_ID,
                'name': config.PRINTER_NAME,
                'location': {
                    'address': config.LOCATION_ADDRESS,
                    'latitude': config.LOCATION_LATITUDE,
                    'longitude': config.LOCATION_LONGITUDE
                },
                'ipAddress': self._get_local_ip(),
                'port': config.PORT,
                'apiKey': config.API_KEY,
                'status': status_info['status'],
                'capabilities': capabilities
            }
            
            response = self._post_with_retry(
                f'{self.base_url}/api/printers/register',
                json=payload
            )
            
            if response and response.status_code == 200:
                logger.info('Printer registered successfully', extra={'context': {
                    'printer_id': config.PRINTER_ID,
                    'status': status_info['status']
                }})
                return True
            else:
                logger.error('Printer registration failed', extra={'context': {
                    'status_code': response.status_code if response else None,
                    'response': response.text if response else 'No response'
                }})
                return False
                
        except Exception as e:
            logger.error('Printer registration error', extra={'context': {'error': str(e)}})
            return False
    
    def update_job_status(self, job_id, status, error=None, metadata=None):
        """
        Update job status in backend
        
        Args:
            job_id: Job ID
            status: New status (PROCESSING, PRINTING, COMPLETED, FAILED)
            error: Error message if status is FAILED
            metadata: Additional metadata (totalPages, etc.)
            
        Returns:
            bool: True if successful
        """
        try:
            payload = {
                'status': status
            }
            
            if error:
                payload['error'] = error
            
            if metadata:
                payload['metadata'] = metadata
            
            response = self._post_with_retry(
                f'{self.base_url}/api/printers/jobs/{job_id}/status',
                json=payload
            )
            
            if response and response.status_code == 200:
                logger.info('Job status updated', extra={'context': {
                    'job_id': job_id,
                    'status': status
                }})
                return True
            else:
                logger.error('Job status update failed', extra={'context': {
                    'job_id': job_id,
                    'status': status,
                    'status_code': response.status_code if response else None
                }})
                return False
                
        except Exception as e:
            logger.error('Job status update error', extra={'context': {
                'job_id': job_id,
                'error': str(e)
            }})
            return False
    
    def _post_with_retry(self, url, **kwargs):
        """
        POST request with retry logic
        
        Args:
            url: URL to POST to
            **kwargs: Additional arguments for requests.post
            
        Returns:
            requests.Response or None
        """
        for attempt in range(config.MAX_RETRIES):
            try:
                response = requests.post(url, timeout=10, **kwargs)
                return response
            except requests.exceptions.RequestException as e:
                wait_time = config.RETRY_BACKOFF_FACTOR ** attempt
                logger.warning(f'Request failed, retrying in {wait_time}s', extra={'context': {
                    'url': url,
                    'attempt': attempt + 1,
                    'error': str(e)
                }})
                
                if attempt < config.MAX_RETRIES - 1:
                    time.sleep(wait_time)
                else:
                    logger.error('Max retries exceeded', extra={'context': {'url': url}})
                    return None
    
    def _get_local_ip(self):
        """
        Get local IP address
        
        Returns:
            str: Local IP or 'unknown'
        """
        try:
            import socket
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(('8.8.8.8', 80))
            ip = s.getsockname()[0]
            s.close()
            return ip
        except Exception:
            return 'unknown'
