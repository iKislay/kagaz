const express = require('express');
const router = express.Router();
const Printer = require('../models/Printer');
const PrintJob = require('../models/PrintJob');
const logger = require('../utils/logger');
const config = require('../config');

// POST /api/printers/register - Register or update printer (heartbeat)
router.post('/register', async (req, res) => {
    try {
        const { printerId, name, location, ipAddress, port, apiKey, capabilities } = req.body;

        // Validate required fields
        if (!printerId || !name || !location || !ipAddress || !apiKey) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields'
            });
        }

        // Validate location coordinates
        if (!location.latitude || !location.longitude) {
            return res.status(400).json({
                success: false,
                error: 'Location coordinates required'
            });
        }

        // Convert to GeoJSON format
        const printerData = {
            printerId: printerId.toUpperCase(),
            name,
            location: {
                address: location.address,
                city: location.city,
                pincode: location.pincode,
                coordinates: {
                    type: 'Point',
                    coordinates: [location.longitude, location.latitude]
                }
            },
            ipAddress,
            port: port || 5000,
            apiKey,
            status: config.PRINTER_STATUSES.ONLINE,
            capabilities: capabilities || {},
            lastSeen: new Date()
        };

        // Upsert printer
        const printer = await Printer.findOneAndUpdate(
            { printerId: printerId.toUpperCase() },
            printerData,
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        logger.info('Printer registered/updated', {
            printerId: printer.printerId,
            name: printer.name,
            status: printer.status
        });

        res.json({
            success: true,
            printer: {
                _id: printer._id,
                printerId: printer.printerId,
                name: printer.name,
                status: printer.status,
                lastSeen: printer.lastSeen
            }
        });
    } catch (error) {
        logger.error('Printer registration failed', {
            error: error.message,
            stack: error.stack
        });

        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

// GET /api/printers/:printerId/status - Get printer status
router.get('/:printerId/status', async (req, res) => {
    try {
        const { printerId } = req.params;

        const printer = await Printer.findOne({ printerId: printerId.toUpperCase() });

        if (!printer) {
            return res.status(404).json({
                success: false,
                error: 'Printer not found'
            });
        }

        res.json({
            printerId: printer.printerId,
            name: printer.name,
            status: printer.status,
            location: {
                address: printer.location.address,
                latitude: printer.location.coordinates.coordinates[1],
                longitude: printer.location.coordinates.coordinates[0]
            },
            lastSeen: printer.lastSeen,
            stats: printer.stats
        });
    } catch (error) {
        logger.error('Get printer status failed', {
            error: error.message,
            printerId: req.params.printerId
        });

        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

// POST /api/printers/jobs/:jobId/status - Update job status from Pi
router.post('/jobs/:jobId/status', async (req, res) => {
    try {
        const { jobId } = req.params;
        const { status, error } = req.body;

        // Validate status
        if (!Object.values(config.JOB_STATUSES).includes(status)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid status'
            });
        }

        const job = await PrintJob.findOne({ jobId });

        if (!job) {
            return res.status(404).json({
                success: false,
                error: 'Job not found'
            });
        }

        // Update job
        job.status = status;
        if (error) {
            job.error = error;
        }
        await job.save();

        // Update printer stats if job completed or failed
        if (status === config.JOB_STATUSES.COMPLETED || status === config.JOB_STATUSES.FAILED) {
            const printer = await Printer.findById(job.printerId);
            if (printer) {
                if (status === config.JOB_STATUSES.COMPLETED) {
                    printer.stats.successfulJobs += 1;
                } else {
                    printer.stats.failedJobs += 1;
                }
                printer.stats.lastJobAt = new Date();
                printer.status = config.PRINTER_STATUSES.ONLINE; // Back to online after job
                await printer.save();
            }
        }

        logger.info('Job status updated', {
            jobId,
            status,
            error: error || null
        });

        res.json({ success: true });
    } catch (error) {
        logger.error('Job status update failed', {
            error: error.message,
            jobId: req.params.jobId
        });

        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

module.exports = router;
