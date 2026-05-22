import connectDB from '@/lib/db'
import WhatsAppUser from '@/lib/models/WhatsAppUser'
import { findNearbyPrinters, findByPrinterId } from '@/lib/services/printerService'
import { uploadToR2, validateFile } from '@/lib/services/fileService'
import { createJob } from '@/lib/services/jobService'
import { sendTextMessage, downloadMedia } from '@/lib/whatsapp'

const SUPPORTED_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/jpg',
  'image/png',
]

const WELCOME_GREETINGS = ['hi', 'hello', 'start', 'hey', 'hii', 'helo']
const PRINT_COMMANDS = ['print', 'ok', 'done', 'go', 'send']

export interface IncomingMessage {
  from: string
  type: 'text' | 'document' | 'image' | 'location' | 'unknown'
  text?: string
  media?: { id: string; mimeType: string; filename?: string }
  location?: { latitude: number; longitude: number }
}

export async function handleMessage(msg: IncomingMessage): Promise<void> {
  await connectDB()

  const user = await WhatsAppUser.findOneAndUpdate(
    { phoneNumber: msg.from },
    { $setOnInsert: { phoneNumber: msg.from, state: 'IDLE', files: [], printerOptions: [] } },
    { upsert: true, new: true }
  )

  // Reset idle sessions (state machine safety)
  if (!user) return

  try {
    await route(msg, user)
  } catch (err) {
    console.error('[whatsappBot] unhandled error:', err)
    await sendTextMessage(
      msg.from,
      '❌ Something went wrong. Please type *hi* to start again.'
    )
  }
}

async function route(msg: IncomingMessage, user: InstanceType<typeof WhatsAppUser>): Promise<void> {
  const text = msg.text?.toLowerCase().trim() ?? ''

  // "help" works from any state
  if (text === 'help') {
    await sendHelp(msg.from)
    return
  }

  // "reset" / "cancel" restarts the flow
  if (text === 'reset' || text === 'cancel') {
    await resetUser(user)
    await sendTextMessage(msg.from, '🔄 Session reset. Type *hi* to start again.')
    return
  }

  switch (user.state) {
    case 'IDLE':
      await handleIdle(msg, user, text)
      break
    case 'SELECTING_PRINTER':
      await handleSelectingPrinter(msg, user, text)
      break
    case 'UPLOADING':
      await handleUploading(msg, user, text)
      break
    case 'AWAITING_SAVE_PREFERENCE':
      await handleSavePreference(msg, user, text)
      break
    default:
      await sendTextMessage(msg.from, 'Type *hi* to start.')
  }

  // Update lastActive
  user.lastActive = new Date()
  await user.save()
}

async function handleIdle(
  msg: IncomingMessage,
  user: InstanceType<typeof WhatsAppUser>,
  text: string
) {
  if (!WELCOME_GREETINGS.includes(text)) {
    await sendTextMessage(
      msg.from,
      'Send *hi* to start printing! 🖨️\n\nType *help* for instructions.'
    )
    return
  }

  // Returning user with saved printer
  if (user.savedPrinterId) {
    const printer = await findByPrinterId(user.savedPrinterId)
    if (printer && printer.status === 'online') {
      user.selectedPrinterId = printer.printerId
      user.selectedPrinterName = printer.name
      user.state = 'UPLOADING'
      user.files = []
      await sendTextMessage(
        msg.from,
        `👋 Welcome back!\n\n🖨️ Using your saved printer: *${printer.name}*\n\nSend your files and type *print* when ready.`
      )
      return
    }
  }

  // First-time or no saved printer
  user.state = 'SELECTING_PRINTER'
  user.files = []
  user.printerOptions = []
  user.selectedPrinterId = undefined
  user.selectedPrinterName = undefined

  await sendTextMessage(
    msg.from,
    `👋 Welcome to *Kagaz*!\n\nFind a printer near you:\n\n📍 Share your *location* (tap the 📎 → Location)\n\n*OR* type your printer code:\n\`CODE:XXXX\``
  )
}

async function handleSelectingPrinter(
  msg: IncomingMessage,
  user: InstanceType<typeof WhatsAppUser>,
  text: string
) {
  // Location shared
  if (msg.type === 'location' && msg.location) {
    const { latitude, longitude } = msg.location
    const printers = await findNearbyPrinters(latitude, longitude)

    if (printers.length === 0) {
      await sendTextMessage(
        msg.from,
        `😕 No printers found within 5km.\n\nTry entering a printer code:\n\`CODE:XXXX\``
      )
      return
    }

    user.printerOptions = printers.slice(0, 5).map((p) => ({
      printerId: p.printerId,
      name: p.name,
      address: p.address,
      distance: p.distance,
      distanceText: p.distanceText,
    }))

    const list = user.printerOptions
      .map(
        (p, i) =>
          `${i + 1}. *${p.name}*\n   📍 ${p.address}\n   📏 ${p.distanceText}`
      )
      .join('\n\n')

    await sendTextMessage(
      msg.from,
      `🖨️ *Nearby Printers:*\n\n${list}\n\nReply with the number (1–${user.printerOptions.length}) to select.\n\nOr type \`CODE:XXXX\` to enter a code directly.`
    )
    return
  }

  // Printer code entry: CODE:XXXX
  if (text.startsWith('code:')) {
    const code = text.slice(5).trim().toUpperCase()
    const printer = await findByPrinterId(code)

    if (!printer) {
      await sendTextMessage(msg.from, `❌ Printer code *${code}* not found. Try again.`)
      return
    }
    if (printer.status !== 'online') {
      await sendTextMessage(
        msg.from,
        `❌ Printer *${printer.name}* is currently *offline*.\n\nShare your location to find another printer.`
      )
      return
    }

    await selectPrinter(user, printer.printerId, printer.name, msg.from)
    return
  }

  // Number selection from list
  const num = parseInt(text, 10)
  if (!isNaN(num) && num >= 1 && num <= user.printerOptions.length) {
    const chosen = user.printerOptions[num - 1]
    const printer = await findByPrinterId(chosen.printerId)

    if (!printer || printer.status !== 'online') {
      await sendTextMessage(
        msg.from,
        `❌ That printer is currently offline. Please choose another or share your location again.`
      )
      return
    }

    await selectPrinter(user, printer.printerId, printer.name, msg.from)
    return
  }

  // Fallback
  await sendTextMessage(
    msg.from,
    `Please 📍 share your *location* or type a printer code:\n\`CODE:XXXX\``
  )
}

async function selectPrinter(
  user: InstanceType<typeof WhatsAppUser>,
  printerId: string,
  printerName: string,
  from: string
) {
  user.selectedPrinterId = printerId
  user.selectedPrinterName = printerName
  user.state = 'UPLOADING'
  user.files = []

  await sendTextMessage(
    from,
    `✅ *${printerName}* selected!\n\nNow send your files (PDF, DOC, DOCX, JPG, PNG — max 25MB each, up to 10 files).\n\nType *print* when you're ready to print.`
  )
}

async function handleUploading(
  msg: IncomingMessage,
  user: InstanceType<typeof WhatsAppUser>,
  text: string
) {
  // Print command
  if (PRINT_COMMANDS.includes(text)) {
    await submitPrintJob(msg.from, user)
    return
  }

  // File received
  if ((msg.type === 'document' || msg.type === 'image') && msg.media) {
    if (user.files.length >= 10) {
      await sendTextMessage(
        msg.from,
        `⚠️ Maximum 10 files reached. Type *print* to submit, or *reset* to start over.`
      )
      return
    }

    if (!SUPPORTED_MIME_TYPES.includes(msg.media.mimeType)) {
      await sendTextMessage(
        msg.from,
        `❌ Unsupported file type. Please send: PDF, DOC, DOCX, JPG, or PNG.`
      )
      return
    }

    await sendTextMessage(msg.from, `⏳ Receiving your file...`)

    try {
      const { buffer, mimeType, filename: autoName } = await downloadMedia(msg.media.id)
      const filename = msg.media.filename || autoName

      const validation = validateFile(filename, mimeType, buffer.length)
      if (!validation.valid) {
        await sendTextMessage(msg.from, `❌ ${validation.error}`)
        return
      }

      const url = await uploadToR2(buffer, filename, mimeType)

      user.files.push({
        mediaId: msg.media.id,
        filename,
        mimeType,
        url,
        sizeBytes: buffer.length,
      })

      await sendTextMessage(
        msg.from,
        `✅ *${filename}* received\n📄 Total files: ${user.files.length}\n\nSend more or type *print* to proceed.`
      )
    } catch (err) {
      console.error('[whatsappBot] file download/upload error:', err)
      await sendTextMessage(
        msg.from,
        `❌ Failed to receive the file. Please try sending it again.`
      )
    }
    return
  }

  // Location or other input in UPLOADING state
  if (msg.type === 'location') {
    await sendTextMessage(
      msg.from,
      `📄 Send your files and type *print* when ready.\n\nPrinter: *${user.selectedPrinterName}*`
    )
    return
  }

  // Any other text
  await sendTextMessage(
    msg.from,
    `📎 Send your files (PDF, DOC, DOCX, JPG, PNG).\n\nType *print* when ready to print.\nType *reset* to start over.`
  )
}

async function submitPrintJob(from: string, user: InstanceType<typeof WhatsAppUser>) {
  if (!user.selectedPrinterId) {
    await sendTextMessage(
      from,
      `❌ No printer selected. Type *hi* to start again.`
    )
    return
  }

  if (user.files.length === 0) {
    await sendTextMessage(
      from,
      `❌ No files uploaded. Please send at least one file before printing.`
    )
    return
  }

  // Verify printer is still online
  const printer = await findByPrinterId(user.selectedPrinterId)
  if (!printer || printer.status !== 'online') {
    await sendTextMessage(
      from,
      `❌ Printer *${user.selectedPrinterName}* is now offline.\n\nType *hi* to find another printer.`
    )
    await resetUser(user)
    return
  }

  await sendTextMessage(from, `⏳ Submitting your print job...`)

  try {
    const job = await createJob({
      userId: `whatsapp_${from}`,
      printerId: user.selectedPrinterId,
      fileUrls: user.files.map((f) => ({
        url: f.url,
        filename: f.filename,
        mimeType: f.mimeType,
        sizeBytes: f.sizeBytes,
      })),
      settings: {
        copies: 1,
        color: false,
        duplex: false,
        pageSize: 'A4',
      },
    })

    user.lastJobId = job.jobId

    const isFirstPrint = !user.savedPrinterId
    user.state = isFirstPrint ? 'AWAITING_SAVE_PREFERENCE' : 'IDLE'
    user.files = []

    const confirmMsg =
      `🎉 *Print Job Submitted!*\n\n` +
      `📋 Job ID: \`${job.jobId}\`\n` +
      `🖨️ Printer: *${user.selectedPrinterName}*\n` +
      `📄 Files: ${job.files.length}\n\n` +
      `Your documents will be ready shortly!`

    await sendTextMessage(from, confirmMsg)

    if (isFirstPrint) {
      await sendTextMessage(
        from,
        `💾 Would you like to save *${user.selectedPrinterName}* as your default printer?\n\nReply *yes* or *no*.`
      )
    }
  } catch (err) {
    console.error('[whatsappBot] job creation error:', err)
    await sendTextMessage(
      from,
      `❌ Failed to submit print job. Please try again or type *reset*.`
    )
  }
}

async function handleSavePreference(
  msg: IncomingMessage,
  user: InstanceType<typeof WhatsAppUser>,
  text: string
) {
  if (text === 'yes' || text === 'y') {
    user.savedPrinterId = user.selectedPrinterId
    user.savedPrinterName = user.selectedPrinterName
    user.state = 'IDLE'
    await sendTextMessage(
      msg.from,
      `✅ *${user.selectedPrinterName}* saved as your default printer!\n\nNext time just send *hi* and I'll have it ready. 🖨️`
    )
  } else {
    user.state = 'IDLE'
    await sendTextMessage(
      msg.from,
      `👍 Got it! Type *hi* whenever you want to print again.`
    )
  }
}

async function sendHelp(to: string) {
  await sendTextMessage(
    to,
    `📖 *Kagaz Help*\n\n` +
      `*hi* — Start a new print session\n` +
      `*CODE:XXXX* — Connect to a printer by code\n` +
      `*print / ok / done* — Submit your print job\n` +
      `*reset / cancel* — Start over\n` +
      `*help* — Show this message\n\n` +
      `*Supported files:* PDF, DOC, DOCX, JPG, PNG (max 25MB each, up to 10 files)`
  )
}

async function resetUser(user: InstanceType<typeof WhatsAppUser>) {
  user.state = 'IDLE'
  user.selectedPrinterId = undefined
  user.selectedPrinterName = undefined
  user.printerOptions = []
  user.files = []
  await user.save()
}
