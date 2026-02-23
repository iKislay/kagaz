import schedule
import time
import threading
import config
from utils.logger import logger

class SchedulerService:
    """Background task scheduler"""
    
    def __init__(self, backend_service, file_service):
        """
        Initialize scheduler
        
        Args:
            backend_service: BackendService instance
            file_service: FileService instance
        """
        self.backend_service = backend_service
        self.file_service = file_service
        self.running = False
        self.thread = None
    
    def start(self):
        """Start background scheduler in separate thread"""
        if self.running:
            logger.warning('Scheduler already running')
            return
        
        # Schedule tasks
        schedule.every(config.HEARTBEAT_INTERVAL_SECONDS).seconds.do(self._heartbeat)
        schedule.every().day.at(config.CLEANUP_TIME).do(self._cleanup)
        
        # Run heartbeat immediately on startup
        self._heartbeat()
        
        # Start scheduler thread
        self.running = True
        self.thread = threading.Thread(target=self._run_scheduler, daemon=True)
        self.thread.start()
        
        logger.info('Scheduler started', extra={'context': {
            'heartbeat_interval': config.HEARTBEAT_INTERVAL_SECONDS,
            'cleanup_time': config.CLEANUP_TIME
        }})
    
    def stop(self):
        """Stop scheduler"""
        self.running = False
        if self.thread:
            self.thread.join(timeout=5)
        logger.info('Scheduler stopped')
    
    def _run_scheduler(self):
        """Main scheduler loop"""
        while self.running:
            try:
                schedule.run_pending()
                time.sleep(1)
            except Exception as e:
                logger.error('Scheduler error', extra={'context': {'error': str(e)}})
    
    def _heartbeat(self):
        """Heartbeat task - register printer with backend"""
        try:
            logger.debug('Running heartbeat')
            self.backend_service.register_printer()
        except Exception as e:
            logger.error('Heartbeat failed', extra={'context': {'error': str(e)}})
    
    def _cleanup(self):
        """Cleanup task - delete old files"""
        try:
            logger.debug('Running cleanup')
            self.file_service.cleanup_old_files()
        except Exception as e:
            logger.error('Cleanup failed', extra={'context': {'error': str(e)}})
