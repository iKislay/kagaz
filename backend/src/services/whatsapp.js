const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

class WhatsAppService {
    constructor() {
        this.apiUrl = config.WHATSAPP_API_URL;
        this.phoneId = config.WHATSAPP_PHONE_ID;
        this.token = config.WHATSAPP_TOKEN;
    }

    /**
     * Send a text message to a WhatsApp number
     * @param {string} to - Recipient phone number (E.164 format)
     * @param {string} body - Message text
     */
    async sendTextMessage(to, body) {
        try {
            const url = `${this.apiUrl}/${this.phoneId}/messages`;

            const payload = {
                messaging_product: 'whatsapp',
                to,
                type: 'text',
                text: { body }
            };

            const response = await axios.post(url, payload, {
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                }
            });

            logger.info('WhatsApp message sent', {
                to,
                messageId: response.data.messages[0].id
            });

            return response.data;
        } catch (error) {
            logger.error('Failed to send WhatsApp message', {
                to,
                error: error.message,
                response: error.response?.data
            });
            throw error;
        }
    }

    /**
     * Get media URL from WhatsApp
     * @param {string} mediaId - WhatsApp media ID
     */
    async getMediaUrl(mediaId) {
        try {
            const url = `${this.apiUrl}/${mediaId}`;

            const response = await axios.get(url, {
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });

            logger.debug('Media URL retrieved', {
                mediaId,
                url: response.data.url
            });

            return response.data.url;
        } catch (error) {
            logger.error('Failed to get media URL', {
                mediaId,
                error: error.message,
                response: error.response?.data
            });
            throw error;
        }
    }

    /**
     * Download media file from WhatsApp CDN
     * @param {string} mediaUrl - WhatsApp CDN URL
     * @returns {Buffer} - File buffer
     */
    async downloadMedia(mediaUrl) {
        try {
            const response = await axios.get(mediaUrl, {
                headers: {
                    'Authorization': `Bearer ${this.token}`
                },
                responseType: 'arraybuffer'
            });

            logger.debug('Media downloaded', {
                size: response.data.length,
                contentType: response.headers['content-type']
            });

            return Buffer.from(response.data);
        } catch (error) {
            logger.error('Failed to download media', {
                mediaUrl,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Mark message as read
     * @param {string} messageId - WhatsApp message ID
     */
    async markAsRead(messageId) {
        try {
            const url = `${this.apiUrl}/${this.phoneId}/messages`;

            const payload = {
                messaging_product: 'whatsapp',
                status: 'read',
                message_id: messageId
            };

            await axios.post(url, payload, {
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                }
            });

            logger.debug('Message marked as read', { messageId });
        } catch (error) {
            // Non-critical, just log
            logger.warn('Failed to mark message as read', {
                messageId,
                error: error.message
            });
        }
    }
}

module.exports = new WhatsAppService();
