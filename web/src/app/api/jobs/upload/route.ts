import { NextRequest, NextResponse } from 'next/server'
import { extractTokenFromRequest, getOrCreateGuestUser } from '@/lib/auth'
import { validateFile, uploadToR2 } from '@/lib/services/fileService'
import { Readable } from 'stream'
import formidable from 'formidable'
import fs from 'fs'
import { IncomingMessage } from 'http'
import connectDB from '@/lib/db'
import User from '@/lib/models/User'

export const dynamic = 'force-dynamic'

// Disable Next.js body parser for this route
export const runtime = 'nodejs'

function nodeRequestFromNextRequest(req: NextRequest): IncomingMessage {
  const body = req.body

  // Create a fake IncomingMessage compatible with formidable
  const readable = new Readable({
    read() {},
  })

  // Pipe the request body into the readable
  if (body) {
    const reader = body.getReader()
    const pump = () => {
      reader.read().then(({ done, value }) => {
        if (done) {
          readable.push(null)
          return
        }
        readable.push(Buffer.from(value))
        pump()
      }).catch((err) => {
        readable.destroy(err)
      })
    }
    pump()
  } else {
    readable.push(null)
  }

  // Attach headers so formidable can parse content-type/boundary
  const incomingMsg = readable as unknown as IncomingMessage
  const headers: Record<string, string> = {}
  req.headers.forEach((value, key) => {
    headers[key] = value
  })
  incomingMsg.headers = headers

  return incomingMsg
}

async function parseFormData(req: NextRequest): Promise<{
  files: formidable.File[]
}> {
  return new Promise((resolve, reject) => {
    const form = formidable({
      maxFileSize: 25 * 1024 * 1024, // 25MB
      maxFiles: 10,
      keepExtensions: true,
    })

    const incomingMsg = nodeRequestFromNextRequest(req)

    form.parse(incomingMsg, (err, _fields, files) => {
      if (err) {
        reject(err)
        return
      }

      const fileList: formidable.File[] = []
      for (const key of Object.keys(files)) {
        const fileOrArray = files[key]
        if (Array.isArray(fileOrArray)) {
          fileList.push(...fileOrArray)
        } else if (fileOrArray) {
          fileList.push(fileOrArray)
        }
      }

      resolve({ files: fileList })
    })
  })
}

export async function POST(request: NextRequest) {
  try {
    // Verify guest token
    const auth = await extractTokenFromRequest(request)
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get or create user
    const user = await getOrCreateGuestUser(auth.token)

    // Parse multipart form data
    let parsedFiles: formidable.File[]
    try {
      const parsed = await parseFormData(request)
      parsedFiles = parsed.files
    } catch (parseError) {
      console.error('[upload] Form parse error:', parseError)
      return NextResponse.json({ error: 'Failed to parse upload' }, { status: 400 })
    }

    if (!parsedFiles || parsedFiles.length === 0) {
      return NextResponse.json({ error: 'No files provided' }, { status: 400 })
    }

    const uploadedFiles: Array<{
      url: string
      filename: string
      mimeType: string
      sizeBytes: number
    }> = []

    for (const file of parsedFiles) {
      const filename = file.originalFilename || file.newFilename || 'unknown'
      const mimeType = file.mimetype || 'application/octet-stream'
      const sizeBytes = file.size

      // Validate file
      const validation = validateFile(filename, mimeType, sizeBytes)
      if (!validation.valid) {
        // Clean up temp files before returning
        for (const f of parsedFiles) {
          if (f.filepath) {
            fs.unlink(f.filepath, () => {})
          }
        }
        return NextResponse.json(
          { error: `Invalid file "${filename}": ${validation.error}` },
          { status: 400 }
        )
      }

      // Read file buffer
      const buffer = fs.readFileSync(file.filepath)

      // Upload to R2
      const url = await uploadToR2(buffer, filename, mimeType)

      uploadedFiles.push({ url, filename, mimeType, sizeBytes })

      // Clean up temp file
      fs.unlink(file.filepath, () => {})
    }

    // Save file metadata to user record
    await connectDB()
    await User.updateOne(
      { _id: user._id },
      {
        $push: {
          files: {
            $each: uploadedFiles.map((f) => ({
              url: f.url,
              filename: f.filename,
              mimeType: f.mimeType,
              sizeBytes: f.sizeBytes,
              uploadedAt: new Date(),
            })),
          },
        },
      }
    )

    return NextResponse.json({
      files: uploadedFiles,
    })
  } catch (error) {
    console.error('[POST /api/jobs/upload]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
