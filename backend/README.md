# QuickPrint Backend

WhatsApp-first printing platform backend built with Node.js, Express, and MongoDB.

## Features

- 📱 WhatsApp Business API integration
- 🗺️ Geospatial printer discovery
- 📁 Multi-file upload support (PDF, DOC, DOCX,  JPG, PNG)
- 🖨️ Raspberry Pi print agent communication
- 💾 Session management with state machine
- 🔄 Automatic retry and error handling

## Prerequisites

- Node.js 18+ and npm
- MongoDB (Atlas or local)
- WhatsApp Business API account (Meta)

## Installation

1. Clone the repository
```bash
cd backend
npm install
```

2. Set up environment variables
```bash
cp .env.example .env
```

Edit `.env` with your configuration:
- `MONGO_URI`: MongoDB connection string
- `WHATSAPP_TOKEN`: WhatsApp Business API access token
- `WHATSAPP_PHONE_ID`: Your WhatsApp Business phone number ID
- `WEBHOOK_VERIFY_TOKEN`: Custom token for webhook verification

## Running the Server

### Development
```bash
npm run dev
```

### Production
```bash
npm start
```

The server will start on `http://localhost:3000` (or your configured PORT).

## API Endpoints

### Health Check
- `GET /health` - Server health status

###  Webhook (WhatsApp)
- `GET /webhook` - Webhook verification
- `POST /webhook` - Receive messages from WhatsApp

### Printer Management
- `POST /api/printers/register` - Register/heartbeat printer
- `GET /api/printers/:printerId/status` - Get printer status
- `POST /api/printers/jobs/:jobId/status` - Update job status (from Pi)

## User Flow

1. User sends "hi" to WhatsApp number
2. System asks for location or printer code
3. User shares location → system finds nearby printers
4. User selects printer (or types CODE:XXXX)
5. User uploads documents/images
6. User types "print" → job submitted to Raspberry Pi

## Architecture

```
WhatsApp ←→ Backend (this project) ←→ Raspberry Pi Agent ←→ Printer
```

### Components
- **Message Router**: Conversation flow state machine
- **Session Manager**: User state and file management
- **Printer Service**: Geospatial search and printer management
- **Job Service**: Print job creation and submission
- **WhatsApp Service**: Send/receive messages and media

## Database Models

### User
- Phone number
- State (IDLE, SELECTING_PRINTER, UPLOADING, READY)
- Selected/saved printer
- File session
- Preferences

### Printer
- Printer ID (code)
- Name and location (GeoJSON coordinates)
- IP address and API key
- Status (online/offline/busy)
- Stats

### PrintJob
- Job ID
- User and printer references
- Files array
- Status history
- Metadata

## Development

### Project Structure
```
backend/
├── src/
│   ├── config/          # Configuration
│   ├── models/          # MongoDB models
│   ├── routes/          # Express routes
│   ├── services/        # Business logic
│   │   ├── messageRouter.js      # Conversation flow
│   │   ├── sessionManager.js     # User sessions
│   │   ├── printerService.js     # Printer management
│   │   ├── jobService.js         # Print jobs
│   │   ├── fileService.js        # File handling
│   │   └── whatsapp.js           # WhatsApp API
│   ├── utils/           # Utilities (logger, db)
│   └── index.js         # Server entry point
├── .env.example
└── package.json
```

## License

ISC
