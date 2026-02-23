const Printer = require('../models/Printer');
const config = require('../config');
const logger = require('../utils/logger');

class PrinterService {
    /**
     * Find nearby printers using geospatial search
     * @param {number} latitude - User latitude
     * @param {number} longitude - User longitude
     * @param {number} radiusMeters - Search radius in meters
     * @returns {Promise<Array>} - Array of nearby printers
     */
    async findNearbyPrinters(latitude, longitude, radiusMeters = config.PRINTER_SEARCH_RADIUS_METERS) {
        try {
            const printers = await Printer.find({
                status: config.PRINTER_STATUSES.ONLINE,
                'location.coordinates': {
                    $near: {
                        $geometry: {
                            type: 'Point',
                            coordinates: [longitude, latitude] // [lng, lat]
                        },
                        $maxDistance: radiusMeters
                    }
                }
            }).limit(5);

            // Calculate distance for each printer
            const printersWithDistance = printers.map(printer => {
                const distance = this.calculateDistance(
                    latitude,
                    longitude,
                    printer.location.coordinates.coordinates[1], // lat
                    printer.location.coordinates.coordinates[0]  // lng
                );

                return {
                    _id: printer._id,
                    printerId: printer.printerId,
                    name: printer.name,
                    address: printer.location.address,
                    distance: Math.round(distance),
                    distanceText: distance < 1000 ? `${Math.round(distance)}m away` : `${(distance / 1000).toFixed(1)}km away`
                };
            });

            logger.info('Nearby printers found', {
                latitude,
                longitude,
                count: printersWithDistance.length
            });

            return printersWithDistance;
        } catch (error) {
            logger.error('Failed to find nearby printers', {
                latitude,
                longitude,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Find printer by code
     * @param {string} code - Printer code
     * @returns {Promise<Printer>}
     */
    async findByCode(code) {
        try {
            const printer = await Printer.findOne({
                printerId: code.toUpperCase()
            });

            if (!printer) {
                logger.warn('Printer not found by code', { code });
                return null;
            }

            if (printer.status !== config.PRINTER_STATUSES.ONLINE) {
                logger.warn('Printer found but offline', {
                    code,
                    status: printer.status
                });
            }

            return printer;
        } catch (error) {
            logger.error('Failed to find printer by code', {
                code,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Calculate distance between two coordinates using Haversine formula
     * @param {number} lat1 - Latitude 1
     * @param {number} lon1 - Longitude 1
     * @param {number} lat2 - Latitude 2
     * @param {number} lon2 - Longitude 2
     * @returns {number} - Distance in meters
     */
    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371e3; // Earth's radius in meters
        const φ1 = lat1 * Math.PI / 180;
        const φ2 = lat2 * Math.PI / 180;
        const Δφ = (lat2 - lat1) * Math.PI / 180;
        const Δλ = (lon2 - lon1) * Math.PI / 180;

        const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        return R * c;
    }

    /**
     * Mark stale printers as offline (no heartbeat in >10 min)
     */
    async markStalePrintersOffline() {
        try {
            const staleThresholdMs = 10 * 60 * 1000; // 10 minutes
            const staleTime = new Date(Date.now() - staleThresholdMs);

            const result = await Printer.updateMany(
                {
                    status: config.PRINTER_STATUSES.ONLINE,
                    lastSeen: { $lt: staleTime }
                },
                {
                    status: config.PRINTER_STATUSES.OFFLINE
                }
            );

            if (result.modifiedCount > 0) {
                logger.info('Stale printers marked offline', {
                    count: result.modifiedCount
                });
            }

            return result.modifiedCount;
        } catch (error) {
            logger.error('Failed to mark stale printers offline', {
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Get printer by ID
     * @param {string} printerId - Printer ObjectId
     * @returns {Promise<Printer>}
     */
    async getById(printerId) {
        try {
            const printer = await Printer.findById(printerId);
            return printer;
        } catch (error) {
            logger.error('Failed to get printer by ID', {
                printerId,
                error: error.message
            });
            throw error;
        }
    }
}

module.exports = new PrinterService();
