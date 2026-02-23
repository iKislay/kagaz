const mongoose = require('mongoose');
const config = require('../config');

const printJobSchema = new mongoose.Schema({
    jobId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },

    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },

    printerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Printer',
        required: true,
        index: true
    },

    files: [{
        filename: {
            type: String,
            required: true
        },
        mediaId: {
            type: String,
            required: true
        },
        mimeType: {
            type: String,
            required: true
        },
        sizeBytes: {
            type: Number,
            required: true
        }
    }],

    status: {
        type: String,
        enum: Object.values(config.JOB_STATUSES),
        default: config.JOB_STATUSES.PENDING,
        index: true
    },

    statusHistory: [{
        status: {
            type: String,
            enum: Object.values(config.JOB_STATUSES),
            required: true
        },
        timestamp: {
            type: Date,
            default: Date.now
        },
        message: String
    }],

    error: {
        type: String,
        default: null
    },

    metadata: {
        totalPages: Number,
        estimatedDuration: Number // in seconds
    },

    completedAt: Date
}, {
    timestamps: true
});

// Index for cleanup queries
printJobSchema.index({ createdAt: 1 });

// Add status to history before saving
printJobSchema.pre('save', function () {
    if (this.isModified('status')) {
        this.statusHistory.push({
            status: this.status,
            timestamp: new Date(),
            message: this.error || undefined
        });
    }

    if (this.status === config.JOB_STATUSES.COMPLETED || this.status === config.JOB_STATUSES.FAILED) {
        this.completedAt = new Date();
    }
});

module.exports = mongoose.model('PrintJob', printJobSchema);
