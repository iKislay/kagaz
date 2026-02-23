const whatsappService = require('./whatsapp');
const config = require('../config');
const logger = require('../utils/logger');

class FileService {
    /**
     * Validate file based on MIME type and size
     * @param {string} mimeType - MIME type
     * @param {number} sizeBytes - File size in bytes
     * @returns {Object} - Validation result
     */
    validateFile(mimeType, sizeBytes) {
        const errors = [];

        // Check MIME type
        if (!config.SUPPORTED_MIME_TYPES.includes(mimeType)) {
            errors.push(`File type not supported. Supported types: PDF, DOC, DOCX, JPG, PNG`);
        }

        // Check size
        if (sizeBytes > config.MAX_FILE_SIZE) {
            const maxSizeMB = (config.MAX_FILE_SIZE / (1024 * 1024)).toFixed(1);
            errors.push(`File too large. Maximum size: ${maxSizeMB}MB`);
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    /**
     * Download file from WhatsApp
     * @param {string} mediaId - WhatsApp media ID
     * @returns {Promise<Buffer>} - File buffer
     */
    async downloadFromWhatsApp(mediaId) {
        try {
            // First get the media URL
            const mediaUrl = await whatsappService.getMediaUrl(mediaId);

            // Then download the actual file
            const fileBuffer = await whatsappService.downloadMedia(mediaUrl);

            logger.info('File downloaded from WhatsApp', {
                mediaId,
                size: fileBuffer.length
            });

            return fileBuffer;
        } catch (error) {
            logger.error('Failed to download file from WhatsApp', {
                mediaId,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Get file extension from MIME type
     * @param {string} mimeType - MIME type
     * @returns {string} - File extension
     */
    getExtension(mimeType) {
        const mimeToExt = {
            'application/pdf': 'pdf',
            'application/msword': 'doc',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
            'image/jpeg': 'jpg',
            'image/jpg': 'jpg',
            'image/png': 'png'
        };

        return mimeToExt[mimeType] || 'bin';
    }

    /**
     * Generate safe filename
     * @param {string} originalName - Original filename
     * @param {string} mimeType - MIME type
     * @returns {string} - Safe filename
     */
    generateSafeFilename(originalName, mimeType) {
        // Remove unsafe characters
        let safeName = originalName.replace(/[^a-zA-Z0-9.-]/g, '_');

        // Ensure extension matches MIME type
        const correctExt = this.getExtension(mimeType);
        const hasCorrectExt = safeName.toLowerCase().endsWith(`.${correctExt}`);

        if (!hasCorrectExt) {
            // Replace extension or add if missing
            const nameWithoutExt = safeName.replace(/\.[^.]+$/, '');
            safeName = `${nameWithoutExt}.${correctExt}`;
        }

        return safeName;
    }
}

module.exports = new FileService();
