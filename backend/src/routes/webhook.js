const express = require('express');
const router = express.Router();
const config = require('../config');
const logger = require('../utils/logger');

// GET /webhook - Webhook verification from Meta
router.get('/', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    logger.info('Webhook verification request received', { mode, token });

    if (mode === 'subscribe' && token === config.WEBHOOK_VERIFY_TOKEN) {
        logger.info('Webhook verified successfully');
        res.status(200).send(challenge);
    } else {
        logger.warn('Webhook verification failed', { mode, token });
        res.status(403).json({ error: 'Forbidden' });
    }
});

// POST /webhook - Receive messages from WhatsApp
router.post('/', async (req, res) => {
    try {
        const body = req.body;

        // Respond immediately to acknowledge receipt (Meta requires <5s response)
        res.status(200).json({ status: 'success' });

        // Log the incoming webhook
        logger.debug('Webhook received', { body: JSON.stringify(body) });

        // Check if this is a WhatsApp message
        if (body.object !== 'whatsapp_business_account') {
            logger.warn('Non-WhatsApp webhook received', { object: body.object });
            return;
        }

        // Extract entries
        const entries = body.entry || [];

        for (const entry of entries) {
            const changes = entry.changes || [];

            for (const change of changes) {
                const value = change.value;

                if (!value.messages || value.messages.length === 0) {
                    continue;
                }

                const messages = value.messages;

                for (const message of messages) {
                    // Process message asynchronously (don't block webhook response)
                    processMessage(message).catch(err => {
                        logger.error('Error processing message', {
                            error: err.message,
                            messageId: message.id
                        });
                    });
                }
            }
        }
    } catch (error) {
        logger.error('Webhook processing error', {
            error: error.message,
            stack: error.stack
        });
    }
});

// Process individual message using message router
async function processMessage(message) {
    const messageRouter = require('../services/messageRouter');

    try {
        await messageRouter.routeMessage(message);
    } catch (error) {
        logger.error('Message processing failed', {
            messageId: message.id,
            error: error.message,
            stack: error.stack
        });
    }
}

module.exports = router;
