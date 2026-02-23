const mongoose = require('mongoose');
const config = require('../config');

const userSchema = new mongoose.Schema({
    phoneNumber: {
        type: String,
        required: true,
        unique: true,
        index: true,
        trim: true
    },

    state: {
        type: String,
        enum: Object.values(config.USER_STATES),
        default: config.USER_STATES.IDLE
    },

    selectedPrinter: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Printer',
        default: null
    },

    savedPrinter: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Printer',
        default: null
    },

    files: [{
        mediaId: {
            type: String,
            required: true
        },
        filename: {
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
        },
        timestamp: {
            type: Date,
            default: Date.now
        }
    }],

    preferences: {
        language: {
            type: String,
            default: 'en'
        },
        notifyOnComplete: {
            type: Boolean,
            default: false
        }
    },

    // Temporary storage for printer search results
    printerList: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Printer'
    }],

    lastActive: {
        type: Date,
        default: Date.now,
        index: true
    }
}, {
    timestamps: true
});

// Update lastActive on save
userSchema.pre('save', function () {
    this.lastActive = new Date();
});

// Check if session has timed out
userSchema.methods.isSessionExpired = function () {
    const timeoutMs = config.SESSION_TIMEOUT_MINUTES * 60 * 1000;
    return (Date.now() - this.lastActive.getTime()) > timeoutMs;
};

// Method to clear session
userSchema.methods.clearSession = function () {
    this.state = config.USER_STATES.IDLE;
    this.selectedPrinter = null;
    this.files = [];
    this.printerList = [];
};

module.exports = mongoose.model('User', userSchema);
