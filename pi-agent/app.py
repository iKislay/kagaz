from flask import Flask, request, jsonify
import os
import traceback
import config
from utils.logger import logger
from services.printer_service import PrinterService
from services.file_service import FileService
from services.backend_service import BackendService
from services.scheduler import SchedulerService

# Initialize Flask app
app = Flask(__name__)

# Initialize services
printer_service = PrinterService()
file_service = FileService()
backend_service = BackendService(printer_service)
scheduler_service = SchedulerService(backend_service, file_service)

# Authentication middleware
def require_api_key(f):
    """Decorator to require API key authentication"""
    def decorated_function(*args, **kwargs):
        api_key = request.headers.get('X-API-Key')
        
        if not api_key or api_key != config.API_KEY:
            logger.warning('Unauthorized access attempt', extra={'context': {
                'ip': request.remote_addr,
                'endpoint': request.endpoint
            }})
            return jsonify({'error': 'Unauthorized'}), 401
        
        return f(*args, **kwargs)
    
    decorated_function.__name__ = f.__name__
    return decorated_function

@app.route('/health', methods=['GET'])
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

@app.route('/status', methods=['GET'])
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

@app.route('/print', methods=['POST'])
@require_api_key
def handle_print_job():
    """Receive and process print job from backend"""
    job_id = None
    
    try:
        # Get job ID from form data
        job_id = request.form.get('jobId')
        
        if not job_id:
            return jsonify({'error': 'Missing jobId'}), 400
        
        logger.info('Print job received', extra={'context': {'job_id': job_id}})
        
        # Update status to PROCESSING
        backend_service.update_job_status(job_id, config.JOB_STATUS_PROCESSING)
        
        # Get uploaded files
        files = request.files.getlist('files')
        
        if not files:
            # Try to find files with other keys
            if not files and request.files:
                for key in request.files:
                    files.extend(request.files.getlist(key))
            
            if not files:
                logger.error('No files found in request', extra={'context': {
                    'job_id': job_id,
                    'form_keys': list(request.form.keys()),
                    'file_keys': list(request.files.keys())
                }})
                backend_service.update_job_status(
                    job_id,
                    config.JOB_STATUS_FAILED,
                    error='No files provided'
                )
                return jsonify({'error': 'No files provided'}), 400
        
        # Check disk space
        disk_info = file_service.get_disk_space()
        if disk_info['free_mb'] < 1024:  # Less than 1GB
            backend_service.update_job_status(
                job_id,
                config.JOB_STATUS_FAILED,
                error='Insufficient disk space'
            )
            return jsonify({'error': 'Insufficient disk space'}), 507
        
        # Save files
        saved_files = file_service.save_uploaded_files(files, job_id)
        
        # Convert files to PDF and collect page counts
        pdf_files = []
        total_pages = 0
        
        for file_path in saved_files:
            try:
                pdf_path = file_service.convert_to_pdf(file_path)
                pdf_files.append(pdf_path)
                
                page_count = file_service.get_pdf_page_count(pdf_path)
                total_pages += page_count
                
            except Exception as conv_error:
                logger.error('File conversion failed', extra={'context': {
                    'job_id': job_id,
                    'file': file_path,
                    'error': str(conv_error)
                }})
                backend_service.update_job_status(
                    job_id,
                    config.JOB_STATUS_FAILED,
                    error=f'Conversion failed: {str(conv_error)}'
                )
                return jsonify({'error': 'File conversion failed'}), 400
        
        # Update status to PRINTING
        backend_service.update_job_status(
            job_id,
            config.JOB_STATUS_PRINTING,
            metadata={'totalPages': total_pages}
        )
        
        # Print each PDF
        cups_job_ids = []
        for pdf_path in pdf_files:
            try:
                cups_job_id = printer_service.print_pdf(pdf_path, job_id)
                cups_job_ids.append(cups_job_id)
            except Exception as print_error:
                logger.error('Printing failed', extra={'context': {
                    'job_id': job_id,
                    'file': pdf_path,
                    'error': str(print_error)
                }})
                backend_service.update_job_status(
                    job_id,
                    config.JOB_STATUS_FAILED,
                    error=f'Printing failed: {str(print_error)}'
                )
                return jsonify({'error': 'Printing failed'}), 500
        
        # Update status to COMPLETED
        backend_service.update_job_status(
            job_id,
            config.JOB_STATUS_COMPLETED,
            metadata={'totalPages': total_pages}
        )
        
        logger.info('Print job completed', extra={'context': {
            'job_id': job_id,
            'files': len(pdf_files),
            'pages': total_pages,
            'cups_jobs': cups_job_ids
        }})
        
        return jsonify({
            'success': True,
            'job_id': job_id,
            'files_printed': len(pdf_files),
            'total_pages': total_pages,
            'cups_job_ids': cups_job_ids
        }), 200
        
    except Exception as e:
        error_trace = traceback.format_exc()
        logger.error('Print job handler error', extra={'context': {
            'job_id': job_id,
            'error': str(e),
            'trace': error_trace
        }})
        
        if job_id:
            backend_service.update_job_status(
                job_id,
                config.JOB_STATUS_FAILED,
                error=str(e)
            )
        
        return jsonify({'error': 'Internal server error'}), 500

@app.errorhandler(404)
def not_found(e):
    """404 handler"""
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(500)
def internal_error(e):
    """500 handler"""
    logger.error('Internal server error', extra={'context': {'error': str(e)}})
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    try:
        # Start scheduler
        scheduler_service.start()
        
        logger.info('Kagaz Print Agent starting', extra={'context': {
            'printer_id': config.PRINTER_ID,
            'printer_name': config.PRINTER_NAME,
            'port': config.PORT
        }})
        
        # Run Flask app
        app.run(
            host='0.0.0.0',
            port=config.PORT,
            debug=(config.FLASK_ENV == 'development')
        )
        
    except KeyboardInterrupt:
        logger.info('Shutting down gracefully')
        scheduler_service.stop()
    except Exception as e:
        logger.error('Fatal error', extra={'context': {'error': str(e)}})
        raise
