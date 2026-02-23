require('dotenv').config();

module.exports = {
    // Server
    PORT: process.env.PORT || 3000,
    NODE_ENV: process.env.NODE_ENV || 'development',

    // Database
    MONGO_URI: process.env.MONGO_URI,

    // WhatsApp Business API
    WHATSAPP_TOKEN: process.env.WHATSAPP_TOKEN,
    WHATSAPP_PHONE_ID: process.env.WHATSAPP_PHONE_ID,
    WHATSAPP_API_URL: 'https://graph.facebook.com/v18.0',
    WEBHOOK_VERIFY_TOKEN: process.env.WEBHOOK_VERIFY_TOKEN,

    // Application Constants
    MAX_FILE_SIZE: parseInt(process.env.MAX_FILE_SIZE) || 26214400, // 25MB in bytes
    MAX_FILES_PER_JOB: parseInt(process.env.MAX_FILES_PER_JOB) || 10,
    SESSION_TIMEOUT_MINUTES: parseInt(process.env.SESSION_TIMEOUT_MINUTES) || 30,
    PRINTER_SEARCH_RADIUS_METERS: parseInt(process.env.PRINTER_SEARCH_RADIUS_METERS) || 5000,

    // Supported MIME types
    SUPPORTED_MIME_TYPES: [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'image/jpeg',
        'image/jpg',
        'image/png'
    ],

    // User states
    USER_STATES: {
        IDLE: 'IDLE',
        SELECTING_PRINTER: 'SELECTING_PRINTER',
        UPLOADING: 'UPLOADING',
        READY: 'READY'
    },

    // Job statuses
    JOB_STATUSES: {
        PENDING: 'PENDING',
        PROCESSING: 'PROCESSING',
        PRINTING: 'PRINTING',
        COMPLETED: 'COMPLETED',
        FAILED: 'FAILED'
    },

    // Printer statuses
    PRINTER_STATUSES: {
        ONLINE: 'online',
        OFFLINE: 'offline',
        BUSY: 'busy'
    }
};
