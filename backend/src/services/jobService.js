const axios = require('axios');
const FormData = require('form-data');
const PrintJob = require('../models/PrintJob');
const fileService = require('./fileService');
const config = require('../config');
const logger = require('../utils/logger');

class JobService {
    /**
     * Generate unique job ID
     * @returns {string} - Job ID in format JOBYYYYMMDDHHmmssRRR
     */
    generateJobId() {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        const random = String(Math.floor(Math.random() * 1000)).padStart(3, '0');

        return `JOB${year}${month}${day}${hours}${minutes}${seconds}${random}`;
    }

    /**
     * Create a new print job
     * @param {string} userId - User ID
     * @param {string} printerId - Printer ID
     * @param {Array} files - Array of file metadata
     * @returns {Promise<PrintJob>}
     */
    async createJob(userId, printerId, files) {
        try {
            const jobId = this.generateJobId();

            const job = await PrintJob.create({
                jobId,
                userId,
                printerId,
                files,
                status: config.JOB_STATUSES.PENDING
            });

            logger.info('Print job created', {
                jobId: job.jobId,
                userId,
                printerId,
                fileCount: files.length
            });

            return job;
        } catch (error) {
            logger.error('Failed to create job', {
                userId,
                printerId,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Submit job to Raspberry Pi
     * @param {PrintJob} job - Print job
     * @param {Printer} printer - Target printer
     * @returns {Promise<boolean>}
     */
    async submitToPrinter(job, printer) {
        const maxRetries = 3;
        let lastError;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                logger.info('Submitting job to printer', {
                    jobId: job.jobId,
                    printerId: printer.printerId,
                    attempt,
                    maxRetries
                });

                // Download all files from WhatsApp
                const fileBuffers = [];
                for (const file of job.files) {
                    const buffer = await fileService.downloadFromWhatsApp(file.mediaId);
                    fileBuffers.push({
                        buffer,
                        filename: file.filename,
                        mimeType: file.mimeType
                    });
                }

                // Create multipart form data
                const formData = new FormData();
                formData.append('jobId', job.jobId);

                fileBuffers.forEach((file, index) => {
                    logger.debug('Adding file to form data', {
                        index,
                        filename: file.filename,
                        mimeType: file.mimeType,
                        bufferSize: file.buffer ? file.buffer.length : 0
                    });

                    formData.append('files', file.buffer, {
                        filename: file.filename,
                        contentType: file.mimeType
                    });
                });

                // Send to Raspberry Pi
                const printerUrl = printer.getUrl();
                const response = await axios.post(`${printerUrl}/print`, formData, {
                    headers: {
                        ...formData.getHeaders(),
                        'X-API-Key': printer.apiKey
                    },
                    timeout: 30000 // 30 second timeout
                });

                logger.info('Job submitted successfully', {
                    jobId: job.jobId,
                    printerId: printer.printerId,
                    response: response.data
                });

                // Update job status
                job.status = config.JOB_STATUSES.PROCESSING;
                await job.save();

                // Update printer status
                printer.status = config.PRINTER_STATUSES.BUSY;
                printer.stats.totalJobs += 1;
                await printer.save();

                return true;
            } catch (error) {
                lastError = error;

                logger.warn('Job submission attempt failed', {
                    jobId: job.jobId,
                    attempt,
                    error: error.message,
                    willRetry: attempt < maxRetries
                });

                if (attempt < maxRetries) {
                    // Exponential backoff: 1s, 2s, 4s
                    const delayMs = Math.pow(2, attempt - 1) * 1000;
                    await new Promise(resolve => setTimeout(resolve, delayMs));
                }
            }
        }

        // All retries failed
        logger.error('Job submission failed after all retries', {
            jobId: job.jobId,
            printerId: printer.printerId,
            error: lastError.message
        });

        job.status = config.JOB_STATUSES.FAILED;
        job.error = `Failed to submit to printer: ${lastError.message}`;
        await job.save();

        printer.stats.failedJobs += 1;
        await printer.save();

        throw new Error('Failed to submit job to printer');
    }

    /**
     * Update job status
     * @param {string} jobId - Job ID
     * @param {string} status - New status
     * @param {string} error - Error message (optional)
     * @returns {Promise<PrintJob>}
     */
    async updateJobStatus(jobId, status, error = null) {
        try {
            const job = await PrintJob.findOne({ jobId });

            if (!job) {
                throw new Error('Job not found');
            }

            job.status = status;
            if (error) {
                job.error = error;
            }
            await job.save();

            logger.info('Job status updated', {
                jobId,
                status,
                error: error || null
            });

            return job;
        } catch (error) {
            logger.error('Failed to update job status', {
                jobId,
                status,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Get job by ID
     * @param {string} jobId - Job ID
     * @returns {Promise<PrintJob>}
     */
    async getById(jobId) {
        try {
            const job = await PrintJob.findOne({ jobId })
                .populate('userId')
                .populate('printerId');

            return job;
        } catch (error) {
            logger.error('Failed to get job', {
                jobId,
                error: error.message
            });
            throw error;
        }
    }
}

module.exports = new JobService();
