const sessionManager = require('./sessionManager');
const printerService = require('./printerService');
const fileService = require('./fileService');
const jobService = require('./jobService');
const whatsappService = require('./whatsapp');
const config = require('../config');
const logger = require('../utils/logger');

class MessageRouter {
    /**
     * Route incoming message to appropriate handler
     * @param {Object} message - WhatsApp message object
     */
    async routeMessage(message) {
        try {
            const { from, id, type } = message;

            // Get or create user
            const user = await sessionManager.getOrCreateUser(from);

            logger.info('Routing message', {
                from,
                type,
                state: user.state,
                messageId: id
            });

            // Mark as read (optional)
            await whatsappService.markAsRead(id);

            // Route based on message type and user state
            if (type === 'text') {
                await this.handleTextMessage(user, message.text.body);
            } else if (type === 'location') {
                await this.handleLocationMessage(user, message.location);
            } else if (type === 'document') {
                await this.handleDocumentMessage(user, message.document);
            } else if (type === 'image') {
                await this.handleImageMessage(user, message.image);
            } else {
                await whatsappService.sendTextMessage(
                    from,
                    "Sorry, I can only process text, location, documents, and images. Please send a supported file type."
                );
            }
        } catch (error) {
            logger.error('Message routing error', {
                error: error.message,
                message: JSON.stringify(message)
            });

            // Send generic error message
            try {
                await whatsappService.sendTextMessage(
                    message.from,
                    "Sorry, something went wrong. Please try again or type 'help' for assistance."
                );
            } catch (sendError) {
                logger.error('Failed to send error message', {
                    error: sendError.message
                });
            }
        }
    }

    /**
     * Handle text messages
     */
    async handleTextMessage(user, text) {
        const normalizedText = text.toLowerCase().trim();

        // Check for commands that work in any state
        if (['hi', 'hello', 'start', 'hey'].includes(normalizedText)) {
            return await this.handleGreeting(user);
        }

        if (normalizedText === 'help') {
            return await this.handleHelp(user);
        }

        // State-specific handling
        switch (user.state) {
            case config.USER_STATES.IDLE:
                await this.handleIdleState(user, normalizedText);
                break;

            case config.USER_STATES.SELECTING_PRINTER:
                await this.handleSelectingPrinterState(user, normalizedText);
                break;

            case config.USER_STATES.UPLOADING:
            case config.USER_STATES.READY:
                await this.handleUploadingState(user, normalizedText);
                break;

            default:
                await whatsappService.sendTextMessage(
                    user.phoneNumber,
                    "Something went wrong. Please type 'hi' to start over."
                );
        }
    }

    /**
     * Handle initial greeting
     */
    async handleGreeting(user) {
        let message = '';

        // Check if user has saved printer that's online
        if (user.savedPrinter) {
            const printer = await printerService.getById(user.savedPrinter);

            if (printer && printer.status === config.PRINTER_STATUSES.ONLINE) {
                // Auto-select saved printer
                await sessionManager.setSelectedPrinter(user._id, printer._id);

                message = `👋 Welcome back!\n\n🖨️ Using your saved printer:\n*${printer.name}*\n📍 ${printer.location.address}\n\n📄 Send your documents and type *print* when ready.`;
            } else {
                // Saved printer offline, need to select new one
                await sessionManager.updateState(user._id, config.USER_STATES.SELECTING_PRINTER);

                message = `👋 Welcome back!\n\nYour saved printer is currently offline. Let's find you another one!\n\n📍 Share your location or type *CODE:XXXX* if you have a printer code.`;
            }
        } else {
            // First-time user
            await sessionManager.updateState(user._id, config.USER_STATES.SELECTING_PRINTER);

            message = `👋 Welcome to QuickPrint!\n\nPrint your documents easily via WhatsApp.\n\nTo get started:\n📍 Share your location to find nearby printers, OR\n🔢 Type *CODE:XXXX* if you have a printer code`;
        }

        await whatsappService.sendTextMessage(user.phoneNumber, message);
    }

    /**
     * Handle help command
     */
    async handleHelp(user) {
        const helpText = `ℹ️ *QuickPrint Help*\n\n` +
            `*Commands:*\n` +
            `• hi/hello - Start printing\n` +
            `• help - Show this message\n` +
            `• print/ok/done - Submit your print job\n\n` +
            `*How to print:*\n` +
            `1️⃣ Share your location or enter printer CODE:XXXX\n` +
            `2️⃣ Send your documents (PDF, DOC, DOCX, JPG, PNG)\n` +
            `3️⃣ Type *print* to submit\n\n` +
            `*Limits:*\n` +
            `• Max 10 files per job\n` +
            `• Max 25MB per file\n\n` +
            `Need assistance? Contact support.`;

        await whatsappService.sendTextMessage(user.phoneNumber, helpText);
    }

    /**
     * Handle IDLE state
     */
    async handleIdleState(user, text) {
        await whatsappService.sendTextMessage(
            user.phoneNumber,
            "Type *hi* to start printing!"
        );
    }

    /**
     * Handle SELECTING_PRINTER state
     */
    async handleSelectingPrinterState(user, text) {
        // Check for printer code (CODE:XXXX)
        if (text.toUpperCase().startsWith('CODE:')) {
            const code = text.substring(5).trim();

            const printer = await printerService.findByCode(code);

            if (!printer) {
                await whatsappService.sendTextMessage(
                    user.phoneNumber,
                    `❌ Printer code *${code}* not found.\n\nPlease check the code and try again, or share your location to find nearby printers.`
                );
                return;
            }

            if (printer.status !== config.PRINTER_STATUSES.ONLINE) {
                await whatsappService.sendTextMessage(
                    user.phoneNumber,
                    `❌ Printer *${printer.name}* is currently offline.\n\nPlease try another printer or share your location.`
                );
                return;
            }

            // Printer found and online
            await sessionManager.setSelectedPrinter(user._id, printer._id);

            await whatsappService.sendTextMessage(
                user.phoneNumber,
                `✅ Printer selected!\n\n🖨️ *${printer.name}*\n📍 ${printer.location.address}\n\n📄 Now send your documents (PDF, DOC, DOCX, JPG, PNG).\nMax 10 files, 25MB each.\n\nType *print* when ready.`
            );
            return;
        }

        // Check for number selection (1-5)
        const selection = parseInt(text);
        if (!isNaN(selection) && selection >= 1 && selection <= 5) {
            // Check if user has a printer list
            if (!user.printerList || user.printerList.length === 0) {
                await whatsappService.sendTextMessage(
                    user.phoneNumber,
                    "📍 Please share your location first to see available printers."
                );
                return;
            }

            // Validate selection
            if (selection > user.printerList.length) {
                await whatsappService.sendTextMessage(
                    user.phoneNumber,
                    `❌ Invalid selection. Please choose a number between 1 and ${user.printerList.length}.`
                );
                return;
            }

            // Get selected printer
            const printerId = user.printerList[selection - 1];
            const printer = await printerService.getById(printerId);

            if (!printer) {
                await whatsappService.sendTextMessage(
                    user.phoneNumber,
                    `❌ Printer not found. Please share your location again.`
                );
                return;
            }

            if (printer.status !== config.PRINTER_STATUSES.ONLINE) {
                await whatsappService.sendTextMessage(
                    user.phoneNumber,
                    `❌ Printer *${printer.name}* is currently offline. Please select another.`
                );
                return;
            }

            // Select printer
            await sessionManager.setSelectedPrinter(user._id, printer._id);

            await whatsappService.sendTextMessage(
                user.phoneNumber,
                `✅ Printer selected!\\n\\n🖨️ *${printer.name}*\\n📍 ${printer.location.address}\\n\\n📄 Now send your documents (PDF, DOC, DOCX, JPG, PNG).\\nMax 10 files, 25MB each.\\n\\nType *print* when ready.`
            );
            return;
        }

        // Unknown input
        await whatsappService.sendTextMessage(
            user.phoneNumber,
            "📍 Please share your location to find nearby printers, or type *CODE:XXXX* if you have a printer code."
        );
    }

    /**
     * Handle UPLOADING/READY state
     */
    async handleUploadingState(user, text) {
        // Check for print command
        if (['print', 'ok', 'done'].includes(text)) {
            return await this.handlePrintCommand(user);
        }

        // Otherwise, prompt for files
        await whatsappService.sendTextMessage(
            user.phoneNumber,
            `📄 Send your documents (PDF, DOC, DOCX, JPG, PNG).\n\nCurrent files: ${user.files.length}\n\nType *print* when ready.`
        );
    }

    /**
     * Handle location message
     */
    async handleLocationMessage(user, location) {
        const { latitude, longitude } = location;

        // Find nearby printers
        const printers = await printerService.findNearbyPrinters(latitude, longitude);

        if (printers.length === 0) {
            await whatsappService.sendTextMessage(
                user.phoneNumber,
                `❌ No printers found within 5km.\n\nYou can:\n• Try from a different location\n• Type *CODE:XXXX* if you have a printer code`
            );
            return;
        }

        if (printers.length === 1) {
            // Auto-select the only printer
            await sessionManager.setSelectedPrinter(user._id, printers[0]._id);

            await whatsappService.sendTextMessage(
                user.phoneNumber,
                `✅ Printer selected!\n\n🖨️ *${printers[0].name}*\n📍 ${printers[0].address} (${printers[0].distanceText})\n\n📄 Now send your documents.\nType *print* when ready.`
            );
            return;
        }

        // Multiple printers - show list
        let message = `🖨️ *Nearby Printers:*\n\n`;

        printers.forEach((printer, index) => {
            message += `${index + 1}. *${printer.name}*\n`;
            message += `   📍 ${printer.address}\n`;
            message += `   📏 ${printer.distanceText}\n\n`;
        });

        message += `Reply with number (1-${printers.length}) to select\n`;
        message += `Or type *CODE:XXXX* if you have a printer code`;

        // Store printer list in user session (temporary - will enhance with caching)
        user.printerList = printers.map(p => p._id);
        user.lastActive = new Date();
        await user.save();

        await whatsappService.sendTextMessage(user.phoneNumber, message);
    }

    /**
     * Handle document message
     */
    async handleDocumentMessage(user, document) {
        const { id, filename, mime_type: mimeType } = document;

        // Validate file
        const validation = fileService.validateFile(mimeType, 0); // Size checked after download

        if (!validation.valid) {
            await whatsappService.sendTextMessage(
                user.phoneNumber,
                `❌ ${validation.errors.join('\n')}`
            );
            return;
        }

        // Check file count
        if (user.files.length >= config.MAX_FILES_PER_JOB) {
            await whatsappService.sendTextMessage(
                user.phoneNumber,
                `❌ Maximum ${config.MAX_FILES_PER_JOB} files allowed per job.\n\nType *print* to submit current files, or type *hi* to start over.`
            );
            return;
        }

        // Add to session
        const safeFilename = fileService.generateSafeFilename(filename, mimeType);

        await sessionManager.addFile(user._id, {
            mediaId: id,
            filename: safeFilename,
            mimeType,
            sizeBytes: 0, // Will be known after download
            timestamp: new Date()
        });

        await whatsappService.sendTextMessage(
            user.phoneNumber,
            `✅ Received: *${safeFilename}*\n📄 Total files: ${user.files.length + 1}\n\nSend more files or type *print* to proceed.`
        );
    }

    /**
     * Handle image message
     */
    async handleImageMessage(user, image) {
        const { id, mime_type: mimeType } = image;
        const filename = `image_${Date.now()}.${fileService.getExtension(mimeType)}`;

        // Validate
        const validation = fileService.validateFile(mimeType, 0);

        if (!validation.valid) {
            await whatsappService.sendTextMessage(
                user.phoneNumber,
                `❌ ${validation.errors.join('\n')}`
            );
            return;
        }

        // Check file count
        if (user.files.length >= config.MAX_FILES_PER_JOB) {
            await whatsappService.sendTextMessage(
                user.phoneNumber,
                `❌ Maximum ${config.MAX_FILES_PER_JOB} files allowed.\n\nType *print* to submit.`
            );
            return;
        }

        // Add to session
        await sessionManager.addFile(user._id, {
            mediaId: id,
            filename,
            mimeType,
            sizeBytes: 0,
            timestamp: new Date()
        });

        await whatsappService.sendTextMessage(
            user.phoneNumber,
            `✅ Received: *${filename}*\n📄 Total files: ${user.files.length + 1}\n\nSend more files or type *print* to proceed.`
        );
    }

    /**
     * Handle print command
     */
    async handlePrintCommand(user) {
        // Validate prerequisites
        if (!user.selectedPrinter) {
            await whatsappService.sendTextMessage(
                user.phoneNumber,
                `❌ No printer selected.\n\nPlease share your location or type *CODE:XXXX* first.`
            );
            return;
        }

        if (user.files.length === 0) {
            await whatsappService.sendTextMessage(
                user.phoneNumber,
                `❌ No files uploaded.\n\nPlease send at least one document or image.`
            );
            return;
        }

        // Get printer
        const printer = await printerService.getById(user.selectedPrinter);

        if (!printer) {
            await whatsappService.sendTextMessage(
                user.phoneNumber,
                `❌ Selected printer not found.\n\nPlease select a printer again.`
            );
            await sessionManager.clearSession(user._id);
            return;
        }

        if (printer.status !== config.PRINTER_STATUSES.ONLINE) {
            await whatsappService.sendTextMessage(
                user.phoneNumber,
                `❌ Printer *${printer.name}* is currently offline.\n\nPlease choose another printer.`
            );
            await sessionManager.updateState(user._id, config.USER_STATES.SELECTING_PRINTER);
            return;
        }

        try {
            // Create job
            const job = await jobService.createJob(user._id, printer._id, user.files);

            // Send confirmation
            await whatsappService.sendTextMessage(
                user.phoneNumber,
                `⏳ Submitting your print job...`
            );

            // Submit to printer (async)
            jobService.submitToPrinter(job, printer)
                .then(async () => {
                    await whatsappService.sendTextMessage(
                        user.phoneNumber,
                        `🎉 *Print Job Submitted!*\n\n📋 Job ID: *${job.jobId}*\n🖨️ Printer: ${printer.name}\n📄 Files: ${job.files.length}\n\nYour print will be ready shortly!\nShow Job ID at kiosk to collect.`
                    );

                    // Ask to save printer if not al ready saved
                    if (!user.savedPrinter || user.savedPrinter.toString() !== printer._id.toString()) {
                        setTimeout(async () => {
                            await whatsappService.sendTextMessage(
                                user.phoneNumber,
                                `Would you like to save *${printer.name}* as your default printer?\n\nReply *yes* to save, or *no* to skip.`
                            );
                        }, 2000);
                    }
                })
                .catch(async (error) => {
                    await whatsappService.sendTextMessage(
                        user.phoneNumber,
                        `❌ Failed to submit print job.\n\nError: ${error.message}\n\nPlease try again or contact support.`
                    );
                });

            // Clear session
            await sessionManager.clearSession(user._id);

        } catch (error) {
            logger.error('Print command failed', {
                userId: user._id,
                error: error.message
            });

            await whatsappService.sendTextMessage(
                user.phoneNumber,
                `❌ Failed to create print job.\n\nPlease try again or type *help*.`
            );
        }
    }
}

module.exports = new MessageRouter();
