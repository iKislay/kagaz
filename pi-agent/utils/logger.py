import logging
import json
import sys
from datetime import datetime

class JSONFormatter(logging.Formatter):
    """Custom formatter to output logs in JSON format"""
    
    def format(self, record):
        log_data = {
            'timestamp': datetime.utcnow().isoformat() + 'Z',
            'level': record.levelname,
            'message': record.getMessage(),
        }
        
        # Add context if available
        if hasattr(record, 'context'):
            log_data['context'] = record.context
            
        # Add error info if present
        if record.exc_info:
            log_data['error'] = self.formatException(record.exc_info)
            
        return json.dumps(log_data)

def setup_logger(name='kagaz-agent'):
    """
    Set up structured JSON logger
    
    Args:
        name: Logger name
        
    Returns:
        Configured logger instance
    """
    logger = logging.getLogger(name)
    logger.setLevel(logging.DEBUG)
    
    # Clear any existing handlers
    logger.handlers = []
    
    # Console handler with JSON formatting
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(logging.DEBUG)
    console_handler.setFormatter(JSONFormatter())
    
    logger.addHandler(console_handler)
    
    return logger

# Create default logger instance
logger = setup_logger()

def log_with_context(level, message, **context):
    """
    Log a message with additional context
    
    Args:
        level: Log level (DEBUG, INFO, WARNING, ERROR)
        message: Log message
        **context: Additional key-value pairs to include in log
    """
    log_record = logger.makeRecord(
        logger.name,
        getattr(logging, level.upper()),
        '',
        0,
        message,
        (),
        None
    )
    log_record.context = context
    logger.handle(log_record)
