const mongoose = require('mongoose');
const config = require('../config');

const printerSchema = new mongoose.Schema({
    printerId: {
        type: String,
        required: true,
        unique: true,
        index: true,
        trim: true,
        uppercase: true
    },

    name: {
        type: String,
        required: true,
        trim: true
    },

    location: {
        address: {
            type: String,
            required: true
        },
        city: String,
        pincode: String,
        coordinates: {
            type: {
                type: String,
                enum: ['Point'],
                default: 'Point'
            },
            coordinates: {
                type: [Number], // [longitude, latitude]
                required: true
            }
        }
    },

    ipAddress: {
        type: String,
        required: true
    },

    port: {
        type: Number,
        default: 5000
    },

    apiKey: {
        type: String,
        required: true
    },

    status: {
        type: String,
        enum: Object.values(config.PRINTER_STATUSES),
        default: config.PRINTER_STATUSES.OFFLINE,
        index: true
    },

    capabilities: {
        color: {
            type: Boolean,
            default: false
        },
        duplex: {
            type: Boolean,
            default: false
        },
        maxPageSize: {
            type: String,
            default: 'A4'
        }
    },

    stats: {
        totalJobs: {
            type: Number,
            default: 0
        },
        successfulJobs: {
            type: Number,
            default: 0
        },
        failedJobs: {
            type: Number,
            default: 0
        },
        lastJobAt: Date
    },

    lastSeen: {
        type: Date,
        default: Date.now,
        index: true
    }
}, {
    timestamps: true
});

// Create 2dsphere index for geospatial queries
printerSchema.index({ 'location.coordinates': '2dsphere' });

// Method to get printer URL
printerSchema.methods.getUrl = function () {
    return `http://${this.ipAddress}:${this.port}`;
};

// Method to check if printer is stale (no heartbeat in 10 minutes)
printerSchema.methods.isStale = function () {
    const staleThresholdMs = 10 * 60 * 1000; // 10 minutes
    return (Date.now() - this.lastSeen.getTime()) > staleThresholdMs;
};

module.exports = mongoose.model('Printer', printerSchema);
