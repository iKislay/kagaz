const mongoose = require('mongoose');
const config = require('../config');
const logger = require('./logger');

const connectDB = async () => {
    try {
        const conn = await mongoose.connect(config.MONGO_URI);

        logger.info('MongoDB connected successfully', {
            host: conn.connection.host,
            name: conn.connection.name
        });

        return conn;
    } catch (error) {
        logger.error('MongoDB connection failed', {
            error: error.message,
            stack: error.stack
        });
        // Exit process with failure
        process.exit(1);
    }
};

// Handle connection events
mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected');
});

mongoose.connection.on('error', (err) => {
    logger.error('MongoDB connection error', { error: err.message });
});

module.exports = connectDB;
