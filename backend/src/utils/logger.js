const config = require('../config');

const LOG_LEVELS = {
    ERROR: 'ERROR',
    WARN: 'WARN',
    INFO: 'INFO',
    DEBUG: 'DEBUG'
};

class Logger {
    constructor() {
        this.isDevelopment = config.NODE_ENV === 'development';
    }

    _formatLog(level, message, context = {}) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            level,
            message,
            ...(Object.keys(context).length > 0 && { context })
        };

        return JSON.stringify(logEntry);
    }

    error(message, context = {}) {
        console.error(this._formatLog(LOG_LEVELS.ERROR, message, context));
    }

    warn(message, context = {}) {
        console.warn(this._formatLog(LOG_LEVELS.WARN, message, context));
    }

    info(message, context = {}) {
        console.log(this._formatLog(LOG_LEVELS.INFO, message, context));
    }

    debug(message, context = {}) {
        if (this.isDevelopment) {
            console.log(this._formatLog(LOG_LEVELS.DEBUG, message, context));
        }
    }
}

module.exports = new Logger();
