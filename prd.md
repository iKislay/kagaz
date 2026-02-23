Kagaz - Comprehensive PRD & Technical Approach
Document Information

Product Name: Kagaz - WhatsApp Print Kiosk
Version: 1.0 (MVP)
Date: February 2026
Target: AI Coding Agent Implementation
Author: Product Team


PART 1: PRODUCT REQUIREMENTS DOCUMENT (PRD)
1. EXECUTIVE SUMMARY
1.1 Product Vision
Kagaz revolutionizes printing by eliminating the need for apps, websites, or complex workflows. Users simply send documents via WhatsApp to nearby printing kiosks powered by Raspberry Pi, making printing as easy as sending a message.
1.2 Problem Statement
Current printing solutions require:

Installing apps or visiting websites
Complex setup and authentication
Physical presence at the printer before initiating print
Technical knowledge to operate

1.3 Solution
A WhatsApp-first printing platform where:

Users interact through WhatsApp (no app needed)
Location-based printer discovery
Direct file transmission to Raspberry Pi kiosks
Simple conversational interface
Zero infrastructure costs for MVP

1.4 Success Metrics (MVP)

50+ successful print jobs in first month
<30 second average time from "print" command to physical output
90%+ job success rate
5+ active kiosks deployed
User satisfaction > 4/5 stars


2. TARGET USERS
2.1 Primary Personas
Persona 1: College Student (Rajesh)

Age: 20
Needs: Quick assignment printing between classes
Pain Points: No laptop, only phone; library printers have long queues
Usage: 5-10 prints per week

Persona 2: Small Business Owner (Priya)

Age: 35
Needs: Print invoices, receipts for customers
Pain Points: Doesn't want expensive printer; low volume
Usage: 3-5 prints per week

Persona 3: Traveler (Mike)

Age: 28
Needs: Print boarding passes, hotel confirmations
Pain Points: At airport/hotel, no access to computers
Usage: Occasional, urgent needs

2.2 Kiosk Operators
Persona 4: Shop Owner (Suresh)

Age: 45
Owns: Photocopy/stationery shop
Motivation: Additional revenue stream
Tech Savvy: Low to medium
Needs: Simple setup, minimal maintenance


3. DETAILED FEATURE REQUIREMENTS
3.1 FEATURE: WhatsApp Bot Interface
Priority: P0 (Must Have)
User Story:
As a user
I want to interact with the printing service through WhatsApp
So that I don't need to install any app or visit a website
Acceptance Criteria:

User can initiate conversation by sending "hi", "hello", or "start"
Bot responds within 2 seconds with welcome message
Bot provides clear instructions at each step
Bot handles multiple concurrent users (at least 100)
Bot maintains conversation state for 30 minutes
Bot provides helpful error messages (not technical jargon)

Functional Requirements:

FR-3.1.1: System shall respond to text commands: "hi", "hello", "start", "print", "ok", "done"
FR-3.1.2: System shall maintain user session state with timeout of 30 minutes
FR-3.1.3: System shall handle typos and common variations (case-insensitive)
FR-3.1.4: System shall provide help text when user sends "help"
FR-3.1.5: System shall support English language (Hindi in Phase 2)

Non-Functional Requirements:

NFR-3.1.1: Response time < 2 seconds for 95% of messages
NFR-3.1.2: Handle 100 concurrent conversations
NFR-3.1.3: Message delivery rate > 99%

Edge Cases:

User sends random text → Bot provides help message
User abandons mid-flow → Session expires after 30 min
User sends message after session expired → Start fresh flow
User sends "print" before uploading files → Show error with instructions


3.2 FEATURE: Location-Based Printer Discovery
Priority: P0 (Must Have)
User Story:
As a user
I want to find printers near my current location
So that I can print documents nearby without knowing specific printer addresses
Acceptance Criteria:

User can share location via WhatsApp location sharing
System finds printers within 5km radius
System displays printers sorted by distance (closest first)
System shows maximum 5 nearest printers
User can select printer by number (1-5)
System shows printer name, address, and distance

Functional Requirements:

FR-3.2.1: System shall accept WhatsApp location message
FR-3.2.2: System shall calculate distance using haversine formula
FR-3.2.3: System shall return printers within 5km radius
FR-3.2.4: System shall sort results by distance (ascending)
FR-3.2.5: System shall display distance in meters (if <1000m) or km
FR-3.2.6: System shall auto-select closest printer if only one available
FR-3.2.7: System shall allow manual printer selection via code

Search Algorithm:
1. Receive user latitude/longitude
2. Query database for all active printers
3. Calculate distance for each printer
4. Filter printers where distance < 5000m
5. Sort by distance ascending
6. Return top 5 results
7. If zero results, suggest expanding radius or entering code
Data Display Format:
🖨️ Nearby Printers:

1. Kagaz - MG Road
   📍 Near Cafe Coffee Day, 250m away
   
2. PrintHub - Koramangala
   📍 5th Block, 780m away

Reply with number (1-2) to select
Or type CODE:XXXX if you have printer code
Edge Cases:

No printers found → Show message + option to enter printer code
User location unavailable → Ask to share location or enter code
Multiple printers at same location → Show all with same distance
GPS coordinates inaccurate → Use buffer zone (+/- 100m tolerance)


3.3 FEATURE: Multi-File Upload
Priority: P0 (Must Have)
User Story:
As a user
I want to upload multiple documents in a single print job
So that I can print multiple files together without making separate requests
Acceptance Criteria:

User can send multiple files before triggering print
System accepts PDF, DOC, DOCX, JPG, PNG files
Maximum file size: 25MB per file
Maximum total files: 10 per job
System confirms each file upload
System shows running count of uploaded files
User triggers print with "print", "ok", or "done" command

Functional Requirements:

FR-3.3.1: System shall accept file types: PDF, DOC, DOCX, JPG, JPEG, PNG
FR-3.3.2: System shall reject files larger than 25MB
FR-3.3.3: System shall limit maximum 10 files per job
FR-3.3.4: System shall download files from WhatsApp API
FR-3.3.5: System shall store file metadata (name, type, size)
FR-3.3.6: System shall maintain file order as uploaded
FR-3.3.7: System shall validate file integrity

File Processing Pipeline:
1. User sends file via WhatsApp
2. System receives media_id from webhook
3. System validates:
   - File type (MIME type check)
   - File size (< 25MB)
   - Total files (< 10)
4. System downloads file from WhatsApp Media URL
5. System stores in user session
6. System sends confirmation message
7. Repeat until user sends "print"
Upload Confirmation Format:
✅ Received: assignment.pdf
📄 Total files: 1

Send more files or type 'print' to proceed.
Supported MIME Types:

application/pdf
application/msword
application/vnd.openxmlformats-officedocument.wordprocessingml.document
image/jpeg
image/png

Edge Cases:

Unsupported file type → Reject with clear message
File too large → Show error with size limit
More than 10 files → Reject 11th file, remind limit
Corrupted file → Download fails, ask to resend
Duplicate filename → Accept both, append timestamp


3.4 FEATURE: Print Job Submission
Priority: P0 (Must Have)
User Story:
As a user
I want to submit my print job with a simple command
So that I can quickly get my documents printed
Acceptance Criteria:

User triggers print with "print", "ok", or "done"
System validates printer selection and files exist
System creates unique job ID
System sends files to Raspberry Pi
System provides job confirmation with ID
System shows estimated completion time
System sends status updates (optional for MVP)

Functional Requirements:

FR-3.4.1: System shall validate printer is online before submission
FR-3.4.2: System shall validate at least 1 file uploaded
FR-3.4.3: System shall generate unique job ID (format: JOBYYYYMMDDHHMMSS)
FR-3.4.4: System shall transfer files to Raspberry Pi
FR-3.4.5: System shall store job record in database
FR-3.4.6: System shall clear user session after submission
FR-3.4.7: System shall send confirmation message

Job Submission Flow:
1. User sends "print" command
2. System validates:
   - Printer selected? → Yes/No
   - Printer online? → Yes/No
   - Files uploaded? → Yes/No
3. Create PrintJob record:
   - Generate job_id
   - Link to user, printer, files
   - Set status = PENDING
4. Package files for transmission:
   - Download from WhatsApp
   - Prepare multipart form data
5. Send HTTP POST to Raspberry Pi
6. Update job status = PROCESSING
7. Send confirmation to user
8. Clear user session
Confirmation Message Format:
🎉 Print Job Submitted!

📋 Job ID: JOB20260210143022
🖨️ Printer: Kagaz MG Road
📄 Files: 3
📏 Pages: ~8 pages

Your print will be ready shortly!
Show Job ID at kiosk to collect.
Validation Errors:
❌ No printer selected
Please share location or type CODE:XXXX

❌ No files uploaded
Please send at least one file to print

❌ Printer offline
Selected printer is currently unavailable
Would you like to choose another printer?
Edge Cases:

Printer goes offline during submission → Retry 3 times, then fail gracefully
Network timeout → Retry transmission, update user
Raspberry Pi unreachable → Mark job as FAILED, suggest another printer
File download fails → Retry download 3 times, then abort


3.5 FEATURE: Saved Printer Preference
Priority: P1 (Should Have)
User Story:
As a regular user
I want to save my preferred printer
So that I don't have to select it every time
Acceptance Criteria:

After first print, system asks to save printer
User can say "yes" or "no"
Saved printer is auto-selected in future sessions
User can override and choose different printer
User can update saved printer anytime

Functional Requirements:

FR-3.5.1: System shall prompt to save after first successful print
FR-3.5.2: System shall store saved printer in user profile
FR-3.5.3: System shall auto-select saved printer in new session
FR-3.5.4: System shall allow user to change printer mid-session
FR-3.5.5: System shall provide option to clear saved printer

Implementation Notes:

Store in User model: savedPrinter: ObjectId (reference to Printer)
Auto-select logic: If savedPrinter exists AND printer.status = online → use it
Override command: User sends location → ignore savedPrinter


3.6 FEATURE: Printer Code Entry
Priority: P1 (Should Have)
User Story:
As a user who knows the printer code
I want to directly enter the code
So that I can skip location sharing
Acceptance Criteria:

User can enter code in format: CODE:XXXX
System validates code exists
System validates printer is online
System proceeds to file upload step
Invalid code shows clear error

Functional Requirements:

FR-3.6.1: System shall accept format "CODE:XXXX" (case-insensitive)
FR-3.6.2: System shall validate printer exists with given code
FR-3.6.3: System shall check printer online status
FR-3.6.4: System shall set as selected printer
FR-3.6.5: System shall show printer name and location

Code Format:

Pattern: CODE: followed by alphanumeric string
Example: CODE:MG01, CODE:PRINT123
Validation: Must match a printer's printerId field


4. KIOSK OPERATOR FEATURES
4.1 FEATURE: Raspberry Pi Registration
Priority: P0 (Must Have)
User Story:
As a kiosk operator
I want my Raspberry Pi to automatically register with the backend
So that users can discover and use my printer
Functional Requirements:

FR-4.1.1: Agent shall auto-register on startup
FR-4.1.2: Agent shall send heartbeat every 5 minutes
FR-4.1.3: Agent shall report printer status (online/offline/busy)
FR-4.1.4: Agent shall update if IP address changes
FR-4.1.5: Agent shall include printer metadata (name, location, capabilities)

Registration Payload:
json{
  "printerId": "PRINTER001",
  "name": "Kagaz MG Road",
  "location": {
    "address": "123 MG Road, Bangalore",
    "latitude": 12.9716,
    "longitude": 77.5946
  },
  "ipAddress": "192.168.1.100",
  "port": 5000,
  "apiKey": "secret-key-12345",
  "capabilities": {
    "color": false,
    "duplex": true,
    "maxPageSize": "A4"
  }
}
```

---

### 4.2 FEATURE: Print Job Reception

**Priority:** P0 (Must Have)

**User Story:**
```
As a Raspberry Pi agent
I want to receive print jobs from the backend
So that I can process and print documents
```

**Functional Requirements:**
- FR-4.2.1: Agent shall expose HTTP endpoint /print
- FR-4.2.2: Agent shall authenticate requests via API key
- FR-4.2.3: Agent shall receive files as multipart/form-data
- FR-4.2.4: Agent shall save files to local storage
- FR-4.2.5: Agent shall process files (convert to PDF if needed)
- FR-4.2.6: Agent shall send to printer via CUPS
- FR-4.2.7: Agent shall update job status to backend

**Job Reception Flow:**
```
1. Receive HTTP POST to /print
2. Validate API key in header
3. Extract job_id from form data
4. Save each file to /storage/{job_id}/
5. Update backend: status = PROCESSING
6. Convert non-PDF files to PDF
7. Merge multiple PDFs if needed
8. Update backend: status = PRINTING
9. Send to CUPS printer
10. Monitor print job completion
11. Update backend: status = COMPLETED
12. Cleanup: delete files after 3 days
```

---

### 4.3 FEATURE: Storage Management

**Priority:** P0 (Must Have)

**User Story:**
```
As a kiosk operator with 2TB storage
I want automatic cleanup of old files
So that storage doesn't fill up
```

**Functional Requirements:**
- FR-4.3.1: Agent shall store files in organized directory structure
- FR-4.3.2: Agent shall run cleanup every 24 hours
- FR-4.3.3: Agent shall delete files older than 3 days
- FR-4.3.4: Agent shall provide storage statistics
- FR-4.3.5: Agent shall alert if storage > 90% full

**Directory Structure:**
```
/home/pi/print-storage/
├── JOB20260210143022/
│   ├── file1.pdf
│   ├── file2.jpg
│   └── merged.pdf
├── JOB20260210144533/
│   └── document.pdf
└── ...
```

**Cleanup Logic:**
```
1. Scan /print-storage directory
2. For each job folder:
   - Get folder modification time
   - If age > 3 days:
     - Delete entire folder
     - Log deletion
3. Update storage statistics
4. Send metrics to backend (optional)

5. DATA MODELS
5.1 User Collection (MongoDB)
javascript{
  _id: ObjectId,
  phoneNumber: String,           // WhatsApp number (unique)
  savedPrinter: ObjectId,        // Reference to Printer
  files: [                        // Current session files
    {
      mediaId: String,            // WhatsApp media ID
      filename: String,
      mimeType: String,
      timestamp: Date
    }
  ],
  state: String,                 // IDLE, SELECTING_PRINTER, UPLOADING, READY
  preferences: {
    language: String,            // en, hi (Phase 2)
    notifyOnComplete: Boolean
  },
  createdAt: Date,
  lastActive: Date
}
Indexes:

phoneNumber (unique)
lastActive (for cleanup)

Validation:

phoneNumber: Required, matches E.164 format
state: Enum values only
files: Max 10 items


5.2 Printer Collection (MongoDB)
javascript{
  _id: ObjectId,
  printerId: String,             // Unique code (e.g., MG01)
  name: String,                  // Display name
  location: {
    address: String,
    latitude: Number,            // For geospatial queries
    longitude: Number,
    city: String,
    pincode: String
  },
  ipAddress: String,             // Current IP of Raspberry Pi
  port: Number,                  // Default 5000
  apiKey: String,                // For authentication
  status: String,                // online, offline, busy
  capabilities: {
    color: Boolean,
    duplex: Boolean,
    maxPageSize: String          // A4, Letter
  },
  stats: {
    totalJobs: Number,
    successfulJobs: Number,
    failedJobs: Number,
    lastJobAt: Date
  },
  lastSeen: Date,                // Last heartbeat
  createdAt: Date
}
Indexes:

printerId (unique)
location (2dsphere for geospatial queries)
status (for filtering online printers)
lastSeen (for offline detection)

Geospatial Index:
javascriptdb.printers.createIndex({ "location": "2dsphere" })

5.3 PrintJob Collection (MongoDB)
javascript{
  _id: ObjectId,
  jobId: String,                 // Unique (e.g., JOB20260210143022)
  userId: ObjectId,              // Reference to User
  printerId: ObjectId,           // Reference to Printer
  files: [
    {
      filename: String,
      mediaId: String,           // WhatsApp media ID
      mimeType: String,
      sizeBytes: Number
    }
  ],
  status: String,                // PENDING, PROCESSING, PRINTING, COMPLETED, FAILED
  statusHistory: [
    {
      status: String,
      timestamp: Date,
      message: String
    }
  ],
  error: String,                 // Error message if failed
  metadata: {
    totalPages: Number,
    estimatedDuration: Number    // Seconds
  },
  createdAt: Date,
  completedAt: Date
}
```

**Indexes:**
- jobId (unique)
- userId (for user history)
- printerId (for printer stats)
- status (for queue management)
- createdAt (for cleanup)

**Validation:**
- status: Enum [PENDING, PROCESSING, PRINTING, COMPLETED, FAILED]
- files: Min 1, Max 10

---

## 6. USER FLOWS

### 6.1 First-Time User Flow
```
USER                          SYSTEM
  |                             |
  | "hi"                        |
  |---------------------------→|
  |                             | Create user record
  |                             | Set state = SELECTING_PRINTER
  |←---------------------------|
  | Welcome message             |
  | "Share location or          |
  |  type CODE:XXXX"            |
  |                             |
  | [Shares location]           |
  |---------------------------→|
  |                             | Calculate distances
  |                             | Find nearby printers
  |←---------------------------|
  | List of 3 printers          |
  | "Reply 1-3"                 |
  |                             |
  | "1"                         |
  |---------------------------→|
  |                             | Select printer
  |                             | Set state = UPLOADING
  |←---------------------------|
  | "Printer selected!          |
  |  Send documents"            |
  |                             |
  | [Sends file1.pdf]           |
  |---------------------------→|
  |                             | Download from WhatsApp
  |                             | Store in session
  |←---------------------------|
  | "✅ Received: file1.pdf     |
  |  Total: 1"                  |
  |                             |
  | [Sends image.jpg]           |
  |---------------------------→|
  |                             | Download & store
  |←---------------------------|
  | "✅ Received: image.jpg     |
  |  Total: 2"                  |
  |                             |
  | "print"                     |
  |---------------------------→|
  |                             | Validate inputs
  |                             | Create print job
  |                             | Send to Raspberry Pi
  |←---------------------------|
  | "🎉 Job submitted!          |
  |  Job ID: JOBxxx"            |
  |                             |
  | "Save printer?"             |
  |---------------------------→|
  | "yes"                       |
  |                             | Update user.savedPrinter
  |←---------------------------|
  | "Saved! Next time           |
  |  auto-selected"             |
```

---

### 6.2 Returning User Flow (with Saved Printer)
```
USER                          SYSTEM
  |                             |
  | "hi"                        |
  |---------------------------→|
  |                             | Load user
  |                             | Check savedPrinter
  |                             | Verify printer online
  |←---------------------------|
  | "Welcome back!              |
  |  Using: Kagaz MG       |
  |  Send documents"            |
  |                             |
  | [Sends files]               |
  |---------------------------→|
  |                             | Process files
  |←---------------------------|
  | Confirmations               |
  |                             |
  | "print"                     |
  |---------------------------→|
  |                             | Submit job
  |←---------------------------|
  | Confirmation                |
```

---

### 6.3 Backend to Raspberry Pi Flow
```
BACKEND                    RASPBERRY PI
  |                             |
  | POST /print                 |
  | Headers:                    |
  |   X-API-Key: xxx            |
  | Body:                       |
  |   jobId: JOBxxx             |
  |   file0: [binary]           |
  |   file1: [binary]           |
  |---------------------------→|
  |                             | Validate API key
  |                             | Save files locally
  |                             | POST /jobs/{id}/status
  |                             | { status: PROCESSING }
  |←---------------------------|
  |                             |
  |                             | Convert to PDF
  |                             | Merge files
  |                             | POST /jobs/{id}/status
  |                             | { status: PRINTING }
  |←---------------------------|
  |                             |
  |                             | Send to CUPS
  |                             | Monitor job
  |                             | POST /jobs/{id}/status
  |                             | { status: COMPLETED }
  |←---------------------------|
  | Update database             |
  | (Optional) Notify user      |

7. API SPECIFICATIONS
7.1 WhatsApp Webhook Endpoints
POST /webhook
Purpose: Receive WhatsApp messages
Request (from Meta):
json{
  "object": "whatsapp_business_account",
  "entry": [{
    "id": "123456789",
    "changes": [{
      "value": {
        "messaging_product": "whatsapp",
        "messages": [{
          "from": "919876543210",
          "id": "wamid.xxx",
          "timestamp": "1707565200",
          "type": "text",
          "text": {
            "body": "hi"
          }
        }]
      }
    }]
  }]
}
Response:
json{
  "status": "success"
}
```

**Status Codes:**
- 200: Message received
- 403: Verification failed
- 500: Server error

---

#### GET /webhook
**Purpose:** Webhook verification

**Request (from Meta):**
```
GET /webhook?hub.mode=subscribe&hub.verify_token=xxx&hub.challenge=yyy
```

**Response:**
```
200 OK
Body: {hub.challenge value}

7.2 Printer Management Endpoints
POST /api/printers/register
Purpose: Register/update Raspberry Pi
Request:
json{
  "printerId": "PRINTER001",
  "name": "Kagaz MG Road",
  "location": {
    "address": "123 MG Road, Bangalore",
    "latitude": 12.9716,
    "longitude": 77.5946
  },
  "ipAddress": "192.168.1.100",
  "port": 5000,
  "apiKey": "secret-key-12345"
}
Response:
json{
  "success": true,
  "printer": {
    "_id": "65c1234567890abcdef",
    "printerId": "PRINTER001",
    "name": "Kagaz MG Road",
    "status": "online",
    "lastSeen": "2026-02-10T14:30:00Z"
  }
}
Status Codes:

200: Registration successful
400: Invalid data
401: Unauthorized


POST /api/printers/jobs/:jobId/status
Purpose: Update job status from Raspberry Pi
Request:
json{
  "status": "COMPLETED",
  "error": null
}
Response:
json{
  "success": true
}
Valid Status Values:

PROCESSING
PRINTING
COMPLETED
FAILED


GET /api/printers/:printerId/status
Purpose: Get printer status
Response:
json{
  "printerId": "PRINTER001",
  "name": "Kagaz MG Road",
  "status": "online",
  "location": {
    "address": "123 MG Road",
    "latitude": 12.9716,
    "longitude": 77.5946
  },
  "lastSeen": "2026-02-10T14:30:00Z",
  "stats": {
    "totalJobs": 45,
    "successfulJobs": 43,
    "failedJobs": 2
  }
}
```

---

### 7.3 Raspberry Pi Endpoints

#### POST /print
**Purpose:** Receive print job

**Headers:**
```
X-API-Key: secret-key-12345
Content-Type: multipart/form-data
```

**Request Body:**
```
jobId=JOB20260210143022
file0=[binary data]
file1=[binary data]
Response:
json{
  "success": true,
  "jobId": "JOB20260210143022",
  "filesReceived": 2
}
Status Codes:

200: Job accepted
401: Invalid API key
413: File too large
500: Processing error


GET /health
Purpose: Health check
Response:
json{
  "status": "ok",
  "printer": "Kagaz MG Road",
  "storage": {
    "total_size_mb": 1240.5,
    "file_count": 234,
    "job_count": 67
  }
}
```

---

## 8. NON-FUNCTIONAL REQUIREMENTS

### 8.1 Performance
- **Response Time:** 95% of WhatsApp messages processed in <2 seconds
- **Print Job Delivery:** Files delivered to Raspberry Pi in <10 seconds
- **Database Queries:** All queries complete in <500ms
- **Concurrent Users:** Support 100 simultaneous conversations

### 8.2 Reliability
- **Uptime:** Backend 99% uptime
- **Job Success Rate:** 90% of jobs complete successfully
- **Retry Logic:** 3 automatic retries for failed transmissions
- **Data Persistence:** No data loss on restart

### 8.3 Scalability
- **User Growth:** Handle 10x user growth without architecture changes
- **Printer Capacity:** Support 100+ printers in database
- **File Storage:** Efficiently manage 2TB+ across multiple kiosks

### 8.4 Security
- **API Authentication:** All Raspberry Pi requests authenticated
- **File Validation:** Strict MIME type and size validation
- **Data Privacy:** Auto-delete files after 3 days
- **No PII Storage:** Minimal user data collection

### 8.5 Maintainability
- **Logging:** Comprehensive error and access logs
- **Monitoring:** Health checks for all components
- **Code Quality:** Modular, well-documented code
- **Deployment:** One-command deployment process

---
