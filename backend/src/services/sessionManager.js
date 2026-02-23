const User = require('../models/User');
const config = require('../config');
const logger = require('../utils/logger');

class SessionManager {
    /**
     * Get or create user by phone number
     * @param {string} phoneNumber - User's phone number
     * @returns {Promise<User>}
     */
    async getOrCreateUser(phoneNumber) {
        try {
            let user = await User.findOne({ phoneNumber });

            if (!user) {
                user = await User.create({
                    phoneNumber,
                    state: config.USER_STATES.IDLE
                });

                logger.info('New user created', { phoneNumber, userId: user._id });
            } else {
                // Check for session timeout
                if (user.isSessionExpired()) {
                    logger.info('Session expired, clearing', { phoneNumber });
                    user.clearSession();
                }

                // Update last active
                user.lastActive = new Date();
                await user.save();
            }

            return user;
        } catch (error) {
            logger.error('Failed to get/create user', {
                phoneNumber,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Update user state
     * @param {string} userId - User ID
     * @param {string} newState - New state
     * @returns {Promise<User>}
     */
    async updateState(userId, newState) {
        try {
            const user = await User.findById(userId);

            if (!user) {
                throw new Error('User not found');
            }

            // Validate state transition
            if (!Object.values(config.USER_STATES).includes(newState)) {
                throw new Error(`Invalid state: ${newState}`);
            }

            const oldState = user.state;
            user.state = newState;
            user.lastActive = new Date();
            await user.save();

            logger.debug('User state updated', {
                userId,
                oldState,
                newState
            });

            return user;
        } catch (error) {
            logger.error('Failed to update state', {
                userId,
                newState,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Add file to user session
     * @param {string} userId - User ID
     * @param {Object} fileData - File metadata
     * @returns {Promise<User>}
     */
    async addFile(userId, fileData) {
        try {
            const user = await User.findById(userId);

            if (!user) {
                throw new Error('User not found');
            }

            // Check file limit
            if (user.files.length >= config.MAX_FILES_PER_JOB) {
                throw new Error(`Maximum ${config.MAX_FILES_PER_JOB} files allowed`);
            }

            user.files.push(fileData);

            // Update state to READY if files exist
            if (user.state === config.USER_STATES.UPLOADING) {
                user.state = config.USER_STATES.READY;
            }

            user.lastActive = new Date();
            await user.save();

            logger.info('File added to session', {
                userId,
                filename: fileData.filename,
                totalFiles: user.files.length
            });

            return user;
        } catch (error) {
            logger.error('Failed to add file', {
                userId,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Set selected printer
     * @param {string} userId - User ID
     * @param {string} printerId - Printer ID (ObjectId)
     * @returns {Promise<User>}
     */
    async setSelectedPrinter(userId, printerId) {
        try {
            const user = await User.findById(userId);

            if (!user) {
                throw new Error('User not found');
            }

            user.selectedPrinter = printerId;
            user.state = config.USER_STATES.UPLOADING;
            user.lastActive = new Date();
            await user.save();

            logger.info('Printer selected', {
                userId,
                printerId
            });

            return user;
        } catch (error) {
            logger.error('Failed to set printer', {
                userId,
                printerId,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Save printer as user's default
     * @param {string} userId - User ID
     * @param {string} printerId - Printer ID (ObjectId)
     * @returns {Promise<User>}
     */
    async savePrinter(userId, printerId) {
        try {
            const user = await User.findById(userId);

            if (!user) {
                throw new Error('User not found');
            }

            user.savedPrinter = printerId;
            await user.save();

            logger.info('Printer saved as default', {
                userId,
                printerId
            });

            return user;
        } catch (error) {
            logger.error('Failed to save printer', {
                userId,
                printerId,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Clear user session
     * @param {string} userId - User ID
     * @returns {Promise<User>}
     */
    async clearSession(userId) {
        try {
            const user = await User.findById(userId);

            if (!user) {
                throw new Error('User not found');
            }

            user.clearSession();
            user.lastActive = new Date();
            await user.save();

            logger.info('Session cleared', { userId });

            return user;
        } catch (error) {
            logger.error('Failed to clear session', {
                userId,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Get user with populated printer refs
     * @param {string} userId - User ID
     * @returns {Promise<User>}
     */
    async getUserWithPrinters(userId) {
        try {
            const user = await User.findById(userId)
                .populate('selectedPrinter')
                .populate('savedPrinter');

            return user;
        } catch (error) {
            logger.error('Failed to get user with printers', {
                userId,
                error: error.message
            });
            throw error;
        }
    }
}

module.exports = new SessionManager();
