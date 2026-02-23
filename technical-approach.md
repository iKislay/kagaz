# PART 2: TECHNICAL APPROACH

## 1. ARCHITECTURE OVERVIEW

### 1.1 System Components
```
┌─────────────────────────────────────────────────┐
│               USER LAYER                        │
│          (WhatsApp Messenger)                   │
└─────────────┬───────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────┐
│          COMMUNICATION LAYER                    │
│     Meta WhatsApp Business Cloud API            │
│         (1000 free conversations/mo)            │
└─────────────┬───────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────┐
│          APPLICATION LAYER                      │
│                                                 │
│  ┌──────────────────────────────────────────┐  │
│  │   Node.js Backend (Express)              │  │
│  │   - WhatsApp Webhook Handler             │  │
│  │   - Message Router                       │  │
│  │   - Session Manager                      │  │
│  │   - Printer Discovery Service            │  │
│  │   - File Transfer Service                │  │
│  └──────────────────────────────────────────┘  │
│                                                 │
│         Hosted on: Koyeb (Free Tier)           │
└─────────────┬───────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────┐
│           DATA LAYER                            │
│                                                 │
│  ┌──────────────────────────────────────────┐  │
│  │   MongoDB Atlas (Free 512MB)             │  │
│  │   - Users Collection                     │  │
│  │   - Printers Collection                  │  │
│  │   - PrintJobs Collection                 │  │
│  └──────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────┐
│          EDGE LAYER                             │
│                                                 │
│  ┌──────────────────────────────────────────┐  │
│  │   Raspberry Pi Agent (Python/Flask)      │  │
│  │   - HTTP Server (Port 5000)              │  │
│  │   - File Receiver                        │  │
│  │   - Storage Manager (2TB Local)          │  │
│  │   - Print Queue Manager                  │  │
│  │   - CUPS Interface                       │  │
│  └──────────────────────────────────────────┘  │
│                                                 │
│              ↓                                  │
│  ┌──────────────────────────────────────────┐  │
│  │   Physical Printer (USB/Network)         │  │
│  └──────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
1.2 Technology Decisions & Rationale
ComponentTechnologyRationaleBackend LanguageNode.js- Excellent async I/O for webhooks- Large ecosystem for WhatsApp APIs- Fast prototypingBackend FrameworkExpress.js- Minimal, unopinionated- Easy webhook handling- Wide adoptionDatabaseMongoDB Atlas- Free 512MB tier- Flexible schema for MVP- Built-in geospatial queries- No SQL complexityHostingKoyeb- Free tier with auto-deploy- GitHub integration- HTTPS included- Easy scaling laterWhatsApp APIMeta Cloud API- Official & free (1000 conversations)- Reliable webhooks- Good documentationPi LanguagePython- Excellent for system tasks- CUPS integration available- Easy PDF manipulationPi Web ServerFlask- Lightweight- Simple HTTP endpoint creation- Good for embedded systemsPrint SystemCUPS- Industry standard on Linux- Wide printer support- Remote managementFile StorageLocal (Pi)- No cloud costs- Fast access- Simple architecture- 2TB is plenty

2. COMMUNICATION PROTOCOLS
2.1 WhatsApp ↔ Backend (Webhook)
Protocol: HTTPS POST
Direction: WhatsApp → Backend
Frequency: Event-driven (on user message)
Flow:

User sends message in WhatsApp
Meta servers receive message
Meta makes HTTP POST to registered webhook URL
Backend processes immediately
Backend returns 200 OK within 5 seconds
Backend processes async (send responses via WhatsApp API)

Key Points:

Backend MUST respond within 5 seconds or Meta retries
Use async processing for heavy operations
Verify webhook signature (optional for MVP)


2.2 Backend ↔ WhatsApp API (Send Messages)
Protocol: HTTPS POST
Direction: Backend → WhatsApp
Endpoint: https://graph.facebook.com/v18.0/{phone-id}/messages
Authentication: Bearer token in header
Example Send Message:
javascriptawait axios.post(
  'https://graph.facebook.com/v18.0/123456789/messages',
  {
    messaging_product: 'whatsapp',
    to: '919876543210',
    type: 'text',
    text: { body: 'Hello!' }
  },
  {
    headers: {
      'Authorization': 'Bearer YOUR_ACCESS_TOKEN',
      'Content-Type': 'application/json'
    }
  }
);
Rate Limits:

1000 free business-initiated conversations/month
Unlimited user-initiated responses (24hr window)


2.3 Backend ↔ MongoDB
Protocol: MongoDB Wire Protocol (via Mongoose)
Connection: mongoose.connect(MONGO_URI)
Connection Pooling:

Default pool size: 5
Reconnect automatically on failure
Timeout: 30 seconds

Query Pattern:
javascript// Example: Find nearby printers
const printers = await Printer.find({
  status: 'online',
  location: {
    $near: {
      $geometry: {
        type: 'Point',
        coordinates: [longitude, latitude]
      },
      $maxDistance: 5000 // meters
    }
  }
}).limit(5);
```

---

### 2.4 Backend ↔ Raspberry Pi

**Protocol:** HTTP/1.1  
**Method:** POST multipart/form-data  
**Direction:** Backend → Raspberry Pi  
**Authentication:** X-API-Key header

**Request Structure:**
```
POST http://{pi-ip-address}:5000/print
Headers:
  X-API-Key: secret-key-12345
  Content-Type: multipart/form-data; boundary=----WebKitFormBoundary

Body:
------WebKitFormBoundary
Content-Disposition: form-data; name="jobId"

JOB20260210143022
------WebKitFormBoundary
Content-Disposition: form-data; name="file0"; filename="doc.pdf"
Content-Type: application/pdf

[binary data]
------WebKitFormBoundary--
Timeout: 30 seconds
Retry Logic: 3 attempts with exponential backoff (1s, 2s, 4s)
Error Handling:

Connection timeout → Retry
401 Unauthorized → Log error, don't retry
500 Server error → Retry
Network unreachable → Mark printer offline


2.5 Raspberry Pi ↔ Backend (Status Updates)
Protocol: HTTP/1.1 POST
Direction: Raspberry Pi → Backend
Frequency:

On startup (registration)
Every 5 minutes (heartbeat)
On status change (job updates)

Heartbeat Payload:
jsonPOST /api/printers/register
{
  "printerId": "PRINTER001",
  "ipAddress": "192.168.1.100",
  "status": "online"
}
Job Status Update:
jsonPOST /api/printers/jobs/JOBxxx/status
{
  "status": "COMPLETED"
}
```

---

## 3. DATA FLOW DIAGRAMS

### 3.1 Complete Print Job Flow
```
┌──────┐
│ USER │
└───┬──┘
    │
    │ 1. Send "hi"
    ▼
┌────────────┐
│  WhatsApp  │
│   Cloud    │
└─────┬──────┘
      │
      │ 2. POST /webhook
      ▼
┌────────────────────┐
│  Backend Service   │
│                    │
│ ┌────────────────┐ │
│ │ Message Router │ │
│ └────────┬───────┘ │
│          │         │
│          │ 3. Get/Create User
│          ▼         │
│ ┌────────────────┐ │
│ │   MongoDB      │ │
│ │   - Users      │ │
│ └────────────────┘ │
│          │         │
│          │ 4. Send welcome
│          ▼         │
│ ┌────────────────┐ │
│ │ WhatsApp API   │ │
│ └────────────────┘ │
└────────────────────┘
      │
      │ 5. User shares location
      ▼
┌────────────────────┐
│  Backend Service   │
│                    │
│ ┌────────────────┐ │
│ │ Geo Search     │ │
│ └────────┬───────┘ │
│          │         │
│          │ 6. Find printers
│          ▼         │
│ ┌────────────────┐ │
│ │   MongoDB      │ │
│ │   - Printers   │ │
│ │  (2dsphere)    │ │
│ └────────────────┘ │
│          │         │
│          │ 7. Return list
│          ▼         │
│ ┌────────────────┐ │
│ │ WhatsApp API   │ │
│ └────────────────┘ │
└────────────────────┘
      │
      │ 8. User sends files
      ▼
┌────────────────────┐
│  Backend Service   │
│                    │
│ ┌────────────────┐ │
│ │ File Handler   │ │
│ └────────┬───────┘ │
│          │         │
│          │ 9. Download from WhatsApp
│          ▼         │
│ ┌────────────────┐ │
│ │ WhatsApp CDN   │ │
│ │ (get media URL)│ │
│ └────────────────┘ │
│          │         │
│          │ 10. Store in session
│          ▼         │
│ ┌────────────────┐ │
│ │   MongoDB      │ │
│ │   user.files[] │ │
│ └────────────────┘ │
└────────────────────┘
      │
      │ 11. User sends "print"
      ▼
┌────────────────────┐
│  Backend Service   │
│                    │
│ ┌────────────────┐ │
│ │ Job Processor  │ │
│ └────────┬───────┘ │
│          │         │
│          │ 12. Create job
│          ▼         │
│ ┌────────────────┐ │
│ │   MongoDB      │ │
│ │   - PrintJobs  │ │
│ └────────────────┘ │
│          │         │
│          │ 13. Package files
│          │         │
│          │ 14. POST multipart
│          ▼         │
│ ┌────────────────┐ │
│ │ HTTP Client    │ │
│ └────────────────┘ │
└──────────┬─────────┘
           │
           │ 15. HTTP POST
           ▼
┌───────────────────────┐
│   Raspberry Pi        │
│                       │
│ ┌───────────────────┐ │
│ │  Flask Server     │ │
│ │  Port 5000        │ │
│ └─────────┬─────────┘ │
│           │           │
│           │ 16. Save files
│           ▼           │
│ ┌───────────────────┐ │
│ │ Local Storage     │ │
│ │ /print-storage/   │ │
│ │   JOBxxx/         │ │
│ └───────────────────┘ │
│           │           │
│           │ 17. Convert to PDF
│           ▼           │
│ ┌───────────────────┐ │
│ │ PDF Processor     │ │
│ │ (PyPDF, Pillow)   │ │
│ └─────────┬─────────┘ │
│           │           │
│           │ 18. Send to printer
│           ▼           │
│ ┌───────────────────┐ │
│ │  CUPS             │ │
│ │  printFile()      │ │
│ └─────────┬─────────┘ │
│           │           │
│           ▼           │
│ ┌───────────────────┐ │
│ │ Physical Printer  │ │
│ │ (USB/Network)     │ │
│ └───────────────────┘ │
│           │           │
│           │ 19. Monitor job
│           │           │
│           │ 20. POST status
│           ▼           │
│ ┌───────────────────┐ │
│ │ HTTP Client       │ │
│ └───────────────────┘ │
└───────────┬───────────┘
            │
            │ 21. Update job status
            ▼
┌────────────────────┐
│  Backend Service   │
│                    │
│ ┌────────────────┐ │
│ │   MongoDB      │ │
│ │   - PrintJobs  │ │
│ │   status=DONE  │ │
│ └────────────────┘ │
│          │         │
│          │ 22. Notify user
│          ▼         │
│ ┌────────────────┐ │
│ │ WhatsApp API   │ │
│ └────────────────┘ │
└────────────────────┘
      │
      ▼
┌──────┐
│ USER │
│ 🎉   │
└──────┘
```

---

## 4. STATE MANAGEMENT

### 4.1 User Session States

**State Machine:**
```
         ┌─────────┐
    ┌───│  IDLE   │◄──────────┐
    │    └────┬────┘           │
    │         │                │
    │  User sends "hi"         │
    │         │                │
    │         ▼                │
    │   ┌──────────────────┐   │
    │   │ SELECTING_PRINTER│   │
    │   └────┬─────────────┘   │
    │        │                 │
    │  Location/Code entered   │
    │        │                 │
    │        ▼                 │
    │   ┌──────────┐           │
    └──►│ UPLOADING│           │
        └────┬─────┘           │
             │                 │
      Files uploaded           │
             │                 │
             ▼                 │
        ┌────────┐             │
        │ READY  │             │
        └────┬───┘             │
             │                 │
      User sends "print"       │
             │                 │
             └─────────────────┘
```

**State Transitions:**

| From State | Trigger | To State | Action |
|-----------|---------|----------|--------|
| IDLE | "hi" | SELECTING_PRINTER | Send welcome message |
| SELECTING_PRINTER | Location shared | UPLOADING | Find printers, ask for files |
| SELECTING_PRINTER | "CODE:XXX" | UPLOADING | Validate code, set printer |
| UPLOADING | File received | READY | Store file, confirm |
| READY | File received | READY | Store file, confirm |
| READY | "print" | IDLE | Submit job, clear session |
| ANY | Timeout (30min) | IDLE | Clear session |

---

### 4.2 Print Job Lifecycle
```
PENDING
   │
   │ Backend downloads files
   │ Backend sends to Pi
   ▼
PROCESSING
   │
   │ Pi saves files locally
   │ Pi converts to PDF
   ▼
PRINTING
   │
   │ Pi sends to CUPS
   │ Monitor print queue
   ▼
COMPLETED
   │
   │ Update database
   │ Notify user (optional)
   ▼
[ARCHIVED]
   │
   │ After 3 days
   ▼
[DELETED]
Status Update Triggers:
StatusTriggered ByLocationPENDINGBackend creates jobBackendPROCESSINGPi receives filesRaspberry PiPRINTINGPi sends to CUPSRaspberry PiCOMPLETEDCUPS job doneRaspberry PiFAILEDAny error occursBackend or Pi

5. ERROR HANDLING STRATEGY
5.1 Backend Error Categories
1. WhatsApp API Errors

Cause: Token expired, rate limit, invalid number
Handling: Log error, retry with backoff, alert admin
User Impact: Show generic error, suggest retry

2. Database Errors

Cause: Connection lost, query timeout, validation fail
Handling: Retry 3 times, use circuit breaker
User Impact: "Service temporarily unavailable"

3. Raspberry Pi Unreachable

Cause: Offline, network issue, wrong IP
Handling: Mark printer offline, suggest another printer
User Impact: "Printer offline, choose another"

4. File Processing Errors

Cause: Corrupted file, unsupported format, too large
Handling: Reject file, clear message
User Impact: "File type not supported, try PDF"

5.2 Raspberry Pi Error Categories
1. File Download Errors

Cause: Network timeout, corrupted data
Handling: Retry download 3 times
Fallback: Mark job as FAILED, notify backend

2. Printer Errors

Cause: Paper jam, out of paper, driver issue
Handling: Log to CUPS, mark job FAILED
Notification: Update backend with error message

3. Storage Errors

Cause: Disk full, permission denied
Handling: Alert operator, pause new jobs
Cleanup: Force delete old files


6. SCALABILITY CONSIDERATIONS
6.1 Current MVP Limits
ResourceLimitScaling TriggerKoyeb Free Tier2 services, 2GB RAM100+ concurrent usersMongoDB Free512MB storage~10,000 jobs storedWhatsApp Free1000 conversations1000+ monthly active usersRaspberry PiSingle printerNeed multiple locations
6.2 Scaling Path
Phase 1 → Phase 2:

Upgrade Koyeb to Paid ($7/mo)
Add Redis for session caching
Implement job queue (BullMQ)

Phase 2 → Phase 3:

Migrate to AWS/GCP
Database sharding
Load balancer for multiple backend instances
CDN for file delivery


7. SECURITY MEASURES
7.1 Authentication & Authorization
WhatsApp Webhook:

Verify webhook signature (Meta provides signature)
Check hub.verify_token on registration
Use HTTPS only

Raspberry Pi API:

Require X-API-Key header on all requests
Generate unique API key per printer
Store hashed version in database

MongoDB:

Use strong password
Whitelist only necessary IPs
Enable encryption at rest

7.2 Data Protection
Files:

Download over HTTPS only
Auto-delete after 3 days
No long-term storage

User Data:

Store only phone number (hashed optional)
No chat history retention
GDPR-compliant deletion on request

Secrets Management:

Store in .env file (never commit)
Use Koyeb environment variables
Rotate API keys quarterly


8. MONITORING & LOGGING
8.1 Backend Logging
Log Levels:

ERROR: Failed API calls, DB errors, crashes
WARN: Retry attempts, slow queries
INFO: Job submissions, printer registrations
DEBUG: All webhook payloads (dev only)

Log Format:
json{
  "timestamp": "2026-02-10T14:30:00Z",
  "level": "INFO",
  "message": "Print job submitted",
  "context": {
    "userId": "65c123...",
    "jobId": "JOB20260210143022",
    "printerId": "PRINTER001",
    "fileCount": 2
  }
}
8.2 Raspberry Pi Logging
Events to Log:

Startup/shutdown
Job received
Print status changes
Errors (printer, network, storage)
Storage cleanup runs

Log Location: /var/log/quickprint/agent.log
8.3 Health Checks
Backend Health Endpoint: GET /health
json{
  "status": "ok",
  "database": "connected",
  "timestamp": "2026-02-10T14:30:00Z"
}
Pi Health Endpoint: GET /health
json{
  "status": "ok",
  "printer": "QuickPrint MG Road",
  "cups": "running",
  "storage": {
    "used_gb": 1.2,
    "total_gb": 2000,
    "percent": 0.06
  }
}

9. DEPLOYMENT ARCHITECTURE
9.1 Backend Deployment (Koyeb)
Build Configuration:
yaml# koyeb.yaml
services:
  - name: quickprint-backend
    type: web
    build:
      buildCommand: npm install
    run:
      command: npm start
    env:
      - name: NODE_ENV
        value: production
      - name: MONGO_URI
        value: [FROM_SECRET]
      - name: WHATSAPP_TOKEN
        value: [FROM_SECRET]
    regions:
      - fra # Frankfurt for low latency
    scaling:
      min: 1
      max: 1 # Free tier
Deployment Flow:

Push to GitHub main branch
Koyeb auto-detects change
Runs npm install
Starts with npm start
Health check on /health
Routes traffic when healthy

9.2 Raspberry Pi Deployment
System Setup:
bash# 1. Install OS
Raspberry Pi Imager → Raspberry Pi OS Lite (64-bit)

# 2. Configure
- Enable SSH
- Set hostname: quickprint-001
- Configure WiFi

# 3. Install dependencies
sudo apt update
sudo apt install cups python3-pip git -y

# 4. Setup CUPS
sudo usermod -a -G lpadmin pi
sudo cupsctl --remote-any

# 5. Clone & install agent
git clone https://github.com/yourrepo/pi-agent.git
cd pi-agent
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# 6. Configure systemd
sudo cp quickprint.service /etc/systemd/system/
sudo systemctl enable quickprint
sudo systemctl start quickprint
Auto-Start Service:
ini[Unit]
Description=QuickPrint Agent
After=network.target cups.service

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/pi-agent
ExecStart=/home/pi/pi-agent/venv/bin/python agent.py
Restart=always
RestartSec=10
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target

10. TESTING STRATEGY
10.1 Backend Testing
Unit Tests:

Message routing logic
Geo distance calculation
File validation
Session state management

Integration Tests:

WhatsApp webhook flow
MongoDB CRUD operations
Raspberry Pi communication

End-to-End Tests:

Send "hi" → Verify welcome message
Share location → Verify printer list
Upload file → Verify stored in session
Send "print" → Verify job created

10.2 Raspberry Pi Testing
Unit Tests:

File saving
PDF conversion
Storage cleanup

Integration Tests:

Receive print job via HTTP
CUPS communication
Status update to backend

Hardware Tests:

Print actual document
Handle paper jam
Network disconnection recovery


11. MVP LAUNCH CHECKLIST
Pre-Launch:

 WhatsApp Business Account approved
 Webhook URL verified by Meta
 MongoDB cluster created
 Backend deployed to Koyeb
 3+ Raspberry Pi kiosks set up
 Test end-to-end flow
 Error handling tested
 Storage cleanup verified

Launch Day:

 Monitor logs continuously
 Test with 5 real users
 Check printer status every hour
 Verify files auto-delete after 3 days

Post-Launch (Week 1):

 Collect user feedback
 Monitor error rates
 Check storage usage
 Optimize slow queries


12. KNOWN LIMITATIONS & FUTURE ENHANCEMENTS
12.1 MVP Limitations

No Payment: Cash collection at kiosk
No Print Preview: Users can't see before printing
No Print Options: Always B&W, single-sided
No Job Cancellation: Once submitted, can't cancel
No User Dashboard: Can't see history
English Only: No multi-language support

12.2 Phase 2 Features

 Payment integration (Razorpay/Stripe)
 Print customization (color, duplex, copies)
 PDF preview generation
 Job history and reprint
 Multi-language support
 AI document optimization
 Printer analytics dashboard
 Email receipt option


13. IMPLEMENTATION PRIORITY
Week 1-2: Core Backend

Express server setup
MongoDB models
WhatsApp webhook handler
Message routing logic

Week 3-4: Printer Management

Geospatial search
Printer registration endpoint
File upload handling
Job submission logic

Week 5-6: Raspberry Pi Agent

Flask server setup
File receiver
CUPS integration
Storage manager

Week 7-8: Integration & Testing

End-to-end testing
Error handling
Deployment automation
Documentation

