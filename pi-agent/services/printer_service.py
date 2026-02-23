import cups
import time
import config
from utils.logger import logger

class PrinterService:
    """Handles all CUPS printer operations"""
    
    def __init__(self):
        """Initialize CUPS connection"""
        try:
            self.conn = cups.Connection()
            logger.info('CUPS connection established')
        except Exception as e:
            logger.error('Failed to connect to CUPS', extra={'context': {'error': str(e)}})
            raise
    
    def get_printer_status(self):
        """
        Get current printer status
        
        Returns:
            dict: {
                'status': 'online'|'offline'|'busy',
                'state_message': str,
                'queue_length': int
            }
        """
        try:
            printer_name = config.CUPS_PRINTER_NAME
            printers = self.conn.getPrinters()
            
            if printer_name not in printers:
                logger.warning('Printer not found in CUPS', extra={'context': {'printer': printer_name}})
                return {
                    'status': config.PRINTER_STATUS_OFFLINE,
                    'state_message': 'Printer not configured',
                    'queue_length': 0
                }
            
            printer = printers[printer_name]
            state = printer['printer-state']
            state_message = printer.get('printer-state-message', '')
            
            # CUPS states: 3=idle, 4=printing, 5=stopped
            if state == 5:
                status = config.PRINTER_STATUS_OFFLINE
            elif state == 4:
                status = config.PRINTER_STATUS_BUSY
            else:
                status = config.PRINTER_STATUS_ONLINE
            
            queue_length = len(self.conn.getJobs(which_jobs='not-completed'))
            
            return {
                'status': status,
                'state_message': state_message,
                'queue_length': queue_length
            }
            
        except Exception as e:
            logger.error('Failed to get printer status', extra={'context': {'error': str(e)}})
            return {
                'status': config.PRINTER_STATUS_OFFLINE,
                'state_message': str(e),
                'queue_length': 0
            }
    
    def print_pdf(self, file_path, job_id):
        """
        Submit a PDF to CUPS for printing
        
        Args:
            file_path: Path to PDF file
            job_id: Job ID for tracking
            
        Returns:
            int: CUPS job ID
            
        Raises:
            Exception: If printing fails
        """
        try:
            printer_name = config.CUPS_PRINTER_NAME
            
            # Print options (single-sided, grayscale by default)
            options = {
                'sides': 'one-sided',
                'ColorModel': 'Gray'
            }
            
            # Submit print job
            cups_job_id = self.conn.printFile(
                printer_name,
                file_path,
                job_id,  # Use our job ID as the title
                options
            )
            
            logger.info('PDF submitted to CUPS', extra={'context': {
                'job_id': job_id,
                'cups_job_id': cups_job_id,
                'file': file_path
            }})
            
            return cups_job_id
            
        except Exception as e:
            logger.error('Failed to print PDF', extra={'context': {
                'job_id': job_id,
                'file': file_path,
                'error': str(e)
            }})
            raise
    
    def get_queue_length(self):
        """
        Get number of pending print jobs
        
        Returns:
            int: Number of jobs in queue
        """
        try:
            jobs = self.conn.getJobs(which_jobs='not-completed')
            return len(jobs)
        except Exception as e:
            logger.error('Failed to get queue length', extra={'context': {'error': str(e)}})
            return 0
    
    def cancel_job(self, cups_job_id):
        """
        Cancel a CUPS print job
        
        Args:
            cups_job_id: CUPS job ID to cancel
            
        Returns:
            bool: True if successful
        """
        try:
            self.conn.cancelJob(cups_job_id)
            logger.info('Print job cancelled', extra={'context': {'cups_job_id': cups_job_id}})
            return True
        except Exception as e:
            logger.error('Failed to cancel job', extra={'context': {
                'cups_job_id': cups_job_id,
                'error': str(e)
            }})
            return False
    
    def get_printer_capabilities(self):
        """
        Get printer capabilities
        
        Returns:
            dict: Printer capabilities
        """
        try:
            printer_name = config.CUPS_PRINTER_NAME
            attrs = self.conn.getPrinterAttributes(printer_name)
            
            return {
                'color': 'color' in attrs.get('color-supported', []),
                'duplex': 'two-sided' in attrs.get('sides-supported', []),
                'maxCopies': attrs.get('copies-supported', {}).get('upper', 1)
            }
        except Exception as e:
            logger.error('Failed to get capabilities', extra={'context': {'error': str(e)}})
            return {
                'color': False,
                'duplex': False,
                'maxCopies': 1
            }
