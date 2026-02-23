import os
import shutil
import subprocess
import time
from pathlib import Path
from PIL import Image
from pypdf import PdfReader
import config
from utils.logger import logger

class FileService:
    """Handles file operations, conversions, and cleanup"""
    
    def __init__(self):
        """Initialize storage directory"""
        self.storage_path = Path(config.STORAGE_PATH)
        self.storage_path.mkdir(parents=True, exist_ok=True)
        logger.info('File service initialized', extra={'context': {'storage_path': str(self.storage_path)}})
    
    def save_uploaded_files(self, files, job_id):
        """
        Save uploaded files to job directory
        
        Args:
            files: List of FileStorage objects from Flask
            job_id: Job ID for directory naming
            
        Returns:
            list: Paths to saved files
        """
        job_dir = self.storage_path / job_id
        job_dir.mkdir(parents=True, exist_ok=True)
        
        saved_files = []
        
        for file in files:
            # Sanitize filename
            filename = self._sanitize_filename(file.filename)
            file_path = job_dir / filename
            
            # Save file
            file.save(str(file_path))
            saved_files.append(str(file_path))
            
            logger.debug('File saved', extra={'context': {
                'job_id': job_id,
                'filename': filename,
                'size': file_path.stat().st_size
            }})
        
        return saved_files
    
    def convert_to_pdf(self, file_path):
        """
        Convert image or DOCX to PDF
        
        Args:
            file_path: Path to file to convert
            
        Returns:
            str: Path to PDF file (same as input if already PDF)
            
        Raises:
            Exception: If conversion fails
        """
        file_path = Path(file_path)
        ext = file_path.suffix.lower()
        
        # Already PDF
        if ext == '.pdf':
            return str(file_path)
        
        # Image to PDF
        if ext in ['.jpg', '.jpeg', '.png']:
            return self._image_to_pdf(file_path)
        
        # DOCX to PDF
        if ext in ['.doc', '.docx']:
            return self._docx_to_pdf(file_path)
        
        raise ValueError(f'Unsupported file type: {ext}')
    
    def _image_to_pdf(self, image_path):
        """
        Convert image to PDF using Pillow
        
        Args:
            image_path: Path to image file
            
        Returns:
            str: Path to generated PDF
        """
        try:
            pdf_path = image_path.with_suffix('.pdf')
            
            # Open image and convert to RGB if needed
            image = Image.open(image_path)
            if image.mode != 'RGB':
                image = image.convert('RGB')
            
            # Save as PDF
            image.save(str(pdf_path), 'PDF', resolution=100.0)
            
            logger.info('Image converted to PDF', extra={'context': {
                'input': str(image_path),
                'output': str(pdf_path)
            }})
            
            return str(pdf_path)
            
        except Exception as e:
            logger.error('Image to PDF conversion failed', extra={'context': {
                'file': str(image_path),
                'error': str(e)
            }})
            raise
    
    def _docx_to_pdf(self, docx_path):
        """
        Convert DOCX to PDF using LibreOffice
        
        Args:
            docx_path: Path to DOCX file
            
        Returns:
            str: Path to generated PDF
        """
        try:
            output_dir = docx_path.parent
            
            # Use LibreOffice to convert
            result = subprocess.run([
                'soffice',
                '--headless',
                '--convert-to',
                'pdf',
                '--outdir',
                str(output_dir),
                str(docx_path)
            ], capture_output=True, text=True, timeout=30)
            
            if result.returncode != 0:
                raise Exception(f'LibreOffice conversion failed: {result.stderr}')
            
            pdf_path = docx_path.with_suffix('.pdf')
            
            if not pdf_path.exists():
                raise Exception('PDF file not created')
            
            logger.info('DOCX converted to PDF', extra={'context': {
                'input': str(docx_path),
                'output': str(pdf_path)
            }})
            
            return str(pdf_path)
            
        except subprocess.TimeoutExpired:
            logger.error('DOCX conversion timeout', extra={'context': {'file': str(docx_path)}})
            raise Exception('Conversion timeout')
        except Exception as e:
            logger.error('DOCX to PDF conversion failed', extra={'context': {
                'file': str(docx_path),
                'error': str(e)
            }})
            raise
    
    def get_pdf_page_count(self, pdf_path):
        """
        Count pages in a PDF
        
        Args:
            pdf_path: Path to PDF file
            
        Returns:
            int: Number of pages
        """
        try:
            reader = PdfReader(pdf_path)
            return len(reader.pages)
        except Exception as e:
            logger.error('Failed to count PDF pages', extra={'context': {
                'file': pdf_path,
                'error': str(e)
            }})
            return 0
    
    def cleanup_old_files(self, days=None):
        """
        Delete files older than specified days
        
        Args:
            days: Number of days (defaults to config.MAX_STORAGE_DAYS)
        """
        if days is None:
            days = config.MAX_STORAGE_DAYS
        
        cutoff_time = time.time() - (days * 86400)  # 86400 seconds in a day
        deleted_count = 0
        freed_bytes = 0
        
        try:
            for job_dir in self.storage_path.iterdir():
                if not job_dir.is_dir():
                    continue
                
                # Check directory modification time
                if job_dir.stat().st_mtime < cutoff_time:
                    # Calculate size before deletion
                    dir_size = sum(f.stat().st_size for f in job_dir.rglob('*') if f.is_file())
                    
                    # Delete directory
                    shutil.rmtree(job_dir)
                    deleted_count += 1
                    freed_bytes += dir_size
            
            if deleted_count > 0:
                logger.info('Old files cleaned up', extra={'context': {
                    'deleted_jobs': deleted_count,
                    'freed_mb': round(freed_bytes / 1024 / 1024, 2)
                }})
        
        except Exception as e:
            logger.error('Cleanup failed', extra={'context': {'error': str(e)}})
    
    def get_disk_space(self):
        """
        Get available disk space
        
        Returns:
            dict: {
                'total_mb': float,
                'used_mb': float,
                'free_mb': float
            }
        """
        try:
            stat = shutil.disk_usage(self.storage_path)
            return {
                'total_mb': round(stat.total / 1024 / 1024, 2),
                'used_mb': round(stat.used / 1024 / 1024, 2),
                'free_mb': round(stat.free / 1024 / 1024, 2)
            }
        except Exception as e:
            logger.error('Failed to get disk space', extra={'context': {'error': str(e)}})
            return {'total_mb': 0, 'used_mb': 0, 'free_mb': 0}
    
    def _sanitize_filename(self, filename):
        """
        Sanitize filename to prevent path traversal
        
        Args:
            filename: Original filename
            
        Returns:
            str: Safe filename
        """
        # Remove path components
        filename = os.path.basename(filename)
        
        # Remove dangerous characters
        filename = filename.replace('..', '')
        
        return filename
