const { createServer } = require('http')
const { parse } = require('url')
const next = require('next')
const { Server } = require('socket.io')
const mongoose = require('mongoose')

const dev = process.env.NODE_ENV !== 'production'
const port = parseInt(process.env.PORT || '3000', 10)

const app = next({ dev })
const handle = app.getRequestHandler()

// Connect to MongoDB
async function connectDB() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/kagaz'
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(uri)
    console.log('[server] MongoDB connected')
  }
}

// Lazy-load models after mongoose is connected
function getPrinterModel() {
  if (mongoose.models.Printer) return mongoose.models.Printer

  const printerSchema = new mongoose.Schema({
    printerId: { type: String, required: true, unique: true, uppercase: true, trim: true },
    apiKey: { type: String, required: true },
    status: { type: String, enum: ['online', 'offline', 'busy'], default: 'offline' },
    lastSeen: { type: Date, default: Date.now }
  }, { strict: false })

  return mongoose.model('Printer', printerSchema)
}

function getPrintJobModel() {
  if (mongoose.models.PrintJob) return mongoose.models.PrintJob

  const JOB_STATUSES = ['PENDING', 'PROCESSING', 'PRINTING', 'COMPLETED', 'FAILED']

  const printJobSchema = new mongoose.Schema({
    jobId: { type: String, required: true, unique: true },
    userId: { type: String, required: true },
    status: { type: String, enum: JOB_STATUSES, default: 'PENDING' },
    statusHistory: [{
      status: { type: String, enum: JOB_STATUSES },
      timestamp: { type: Date, default: Date.now },
      message: String
    }],
    error: { type: String, default: null },
    completedAt: Date
  }, { strict: false, timestamps: true })

  return mongoose.model('PrintJob', printJobSchema)
}

app.prepare().then(async () => {
  try {
    await connectDB()
  } catch (err) {
    console.error('[server] MongoDB connection error:', err.message)
  }

  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url, true)
    handle(req, res, parsedUrl)
  })

  const io = new Server(httpServer, {
    cors: {
      origin: process.env.NEXT_PUBLIC_APP_URL || '*',
      methods: ['GET', 'POST']
    },
    path: '/socket.io'
  })

  // Make io globally accessible from API routes
  global.io = io

  io.on('connection', (socket) => {
    console.log('[socket.io] Client connected:', socket.id)

    // Printer agent joins with its printerId and apiKey
    socket.on('printer:join', async ({ printerId, apiKey }) => {
      try {
        if (!printerId || !apiKey) {
          socket.emit('printer:join:error', { message: 'Missing printerId or apiKey' })
          return
        }

        await connectDB()
        const Printer = getPrinterModel()

        const printer = await Printer.findOne({ printerId: printerId.toUpperCase() })

        if (!printer) {
          socket.emit('printer:join:error', { message: 'Printer not found' })
          return
        }

        if (printer.apiKey !== apiKey) {
          socket.emit('printer:join:error', { message: 'Invalid API key' })
          return
        }

        // Put socket in printer's room
        socket.join(printerId.toUpperCase())

        // Store printerId on the socket for disconnect handling
        socket.data.printerId = printerId.toUpperCase()
        socket.data.printerDbId = printer._id.toString()

        // Mark printer online
        await Printer.updateOne(
          { printerId: printerId.toUpperCase() },
          { status: 'online', lastSeen: new Date() }
        )

        socket.emit('printer:join:success', { printerId: printerId.toUpperCase() })
        console.log('[socket.io] Printer joined room:', printerId.toUpperCase())
      } catch (err) {
        console.error('[socket.io] printer:join error:', err.message)
        socket.emit('printer:join:error', { message: 'Internal error' })
      }
    })

    // Printer agent updates job status
    socket.on('job:status', async ({ jobId, status, error, userId }) => {
      try {
        if (!jobId || !status) {
          return
        }

        await connectDB()
        const PrintJob = getPrintJobModel()

        const validStatuses = ['PENDING', 'PROCESSING', 'PRINTING', 'COMPLETED', 'FAILED']
        if (!validStatuses.includes(status)) {
          return
        }

        const job = await PrintJob.findOne({ jobId })
        if (!job) {
          console.warn('[socket.io] job:status - job not found:', jobId)
          return
        }

        job.status = status
        if (error) job.error = error
        if (status === 'COMPLETED' || status === 'FAILED') {
          job.completedAt = new Date()
        }
        job.statusHistory.push({
          status,
          timestamp: new Date(),
          message: error || undefined
        })
        await job.save()

        // Notify the user's browser room
        const targetUserId = userId || job.userId
        if (targetUserId) {
          io.to(`user_${targetUserId}`).emit('job:update', {
            jobId,
            status,
            error: error || null,
            timestamp: new Date().toISOString()
          })
        }

        console.log('[socket.io] Job status updated:', jobId, '->', status)
      } catch (err) {
        console.error('[socket.io] job:status error:', err.message)
      }
    })

    // Browser client joins its personal room for receiving job updates
    socket.on('user:join', ({ userId }) => {
      if (userId) {
        socket.join(`user_${userId}`)
        socket.data.userId = userId
        console.log('[socket.io] User joined room:', `user_${userId}`)
      }
    })

    socket.on('disconnect', async () => {
      console.log('[socket.io] Client disconnected:', socket.id)

      if (socket.data.printerId) {
        try {
          await connectDB()
          const Printer = getPrinterModel()
          await Printer.updateOne(
            { printerId: socket.data.printerId },
            { status: 'offline', lastSeen: new Date() }
          )
          console.log('[socket.io] Printer marked offline:', socket.data.printerId)
        } catch (err) {
          console.error('[socket.io] disconnect handler error:', err.message)
        }
      }
    })
  })

  httpServer.listen(port, () => {
    console.log(`[server] Ready on http://localhost:${port}`)
  })
})
