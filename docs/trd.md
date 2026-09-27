# Technical Architecture & Specification Document

**Project Name:** luma
**Document Version:** 1.0.0  
**Status:** Architecture Locked  

---

## 1. Executive Summary & Core Philosophy

The application is a privacy-first web interface designed to help users free up local device storage by offloading photos, videos, and media directly into their personal Google Drive storage.

### Core Architectural Principles
* **Zero-Knowledge Media Storage:** Application backend servers **never permanently store, log, or retain** user media files.
* **Direct-to-Drive Uploads (Option B Architecture):** Media bytes route directly from the client browser to the Google Drive API, bypassing application servers to eliminate server bandwidth costs, reduce upload latency, and guarantee absolute privacy.
* **Principle of Least Privilege:** Requests only the restricted `https://www.googleapis.com/auth/drive.file` OAuth scope, granting access exclusively to files and folders created or explicitly opened by this application.
* **Single Source of Truth:** Google Drive serves as the primary data layer. File listings, thumbnails, and storage states are queried dynamically via the Drive API. The application database stores zero file-level metadata.

---

## 2. System Architecture & Component Diagram

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CLIENT BROWSER (React + TS)                        │
│                                                                             │
│  ┌──────────────────────┐  ┌───────────────────────┐  ┌──────────────────┐  │
│  │ Pre-Upload Decision  │  │ WASM HEIC Converter   │  │ Chunked Resumable│  │
│  │   (Raw/Device/Cloud) │  │  (heic2any / client)  │  │   Upload Engine  │  │
│  └──────────┬───────────┘  └───────────┬───────────┘  └────────┬─────────┘  │
└─────────────┼──────────────────────────┼───────────────────────┼────────────┘
              │                          │                       │
              │ 1. OAuth Code            │ 2b. Ephemeral Stream  │ 2a. Direct Upload
              │    Exchange              │     (Opt-in)          │     (Default)
              ▼                          ▼                       ▼
┌──────────────────────────┐   ┌───────────────────┐    ┌───────────────────┐
│     NODE.JS BACKEND      │   │ EPHEMERAL STREAM  │    │                   │
│  (Express + TypeScript)  │   │ TRANSCODER MODULE │    │                   │
└─────────────┬────────────┘   └─────────┬─────────┘    │   GOOGLE DRIVE    │
              │                          │              │        API        │
              │ 2. Store Session         │ Transcode &  │     (REST v3)     │
              │    Refresh Token         │ Direct Pipe  │                   │
              ▼                          └────────────► │                   │
┌──────────────────────────┐                            │                   │
│      MYSQL DATABASE      │                            │                   │
│   (Users & Auth Sessions)│                            └───────────────────┘
└──────────────────────────┘

```

---

## 3. Technology Stack

* **Frontend:** React, TypeScript, Vite, Tailwind CSS (or CSS Modules).
* **Backend:** Node.js, Express, TypeScript.
* **Database:** MySQL 8.x with Prisma ORM.
* **Authentication:** Google Identity Services (GIS) / OAuth 2.0.
* **Image Processing:**
* Client-side: `heic2any` / `heic-convert` (WebAssembly).
* Server-side (Ephemeral fallback): `sharp` / `libheif` (Native Node.js streams).



---

## 4. Data & Database Schema

The database is strictly isolated to identity and session management. No filenames, file IDs, sizes, or thumbnail links are stored.

### Prisma Schema (`schema.prisma`)

```prisma
datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model User {
  id           String   @id // Unique Google Profile 'sub' ID
  email        String   @unique
  refreshToken String   @db.Text
  appFolderId  String?  // Drive Folder ID for "Storage Relief"
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@map("users")
}

```

### SQL DDL Script

```sql
CREATE TABLE `users` (
  `id` VARCHAR(255) NOT NULL,
  `email` VARCHAR(255) NOT NULL,
  `refresh_token` TEXT NOT NULL,
  `app_folder_id` VARCHAR(255) DEFAULT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `users_email_key` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

```

---

## 5. Authentication & Permissions Flow

1. **Scope:** `https://www.googleapis.com/auth/drive.file`
2. **Consent Request:** Frontend triggers Google Identity Services popup requesting **offline access** (code response type).
3. **Authorization Handshake:**
* Frontend receives an authorization `code` from Google.
* Frontend posts `{ code }` to `POST /api/auth/exchange`.
* Node.js server exchanges `code` with Google for an `access_token` and `refresh_token`.
* Server checks if `app_folder_id` exists in MySQL. If `null`, it calls the Google Drive API to create the dedicated app folder ("Storage Relief Backup") and saves the `folderId`.
* Server stores the `refresh_token` in MySQL and returns an HTTP-only session cookie alongside the short-lived `access_token` to the client.


4. **Silent Refresh:** When the 1-hour `access_token` expires, the client calls `POST /api/auth/refresh`. The backend uses the stored `refresh_token` to request a new `access_token` from Google without user intervention.

---

## 6. Media Handling Strategy & Format Pipeline

### HEIC Image Management

iPhone photos taken in Apple's native HEIC format face cross-platform viewing limitations. The application presents a pre-upload modal when HEIC files are detected:

| Option | Pipeline Engine | Storage & Processing Location | Trade-Offs |
| --- | --- | --- | --- |
| **Convert on Device** *(Default)* | Client-side WebAssembly (`heic2any`) | Local Browser Memory (RAM) | **100% Private.** Zero server involvement. Slightly slower on older hardware. |
| **Fast Cloud Processing** *(Opt-in)* | Node.js Stream (`sharp`) | Ephemeral Memory Pipe on Backend | **Blazing Fast.** For budget/older phones. Streamed, converted, and purged immediately. |
| **Raw HEIC Upload** | Direct Binary Pipeline | Direct Client-to-Drive Transfer | **Fastest Upload.** Original quality retained; requires compatible viewers on Drive. |

### Apple Live Photos Strategy

* **V1 Strategy:** Defer grouped Live Photo handling. Live photo image components and video clips (`.mov`) are treated as independent files.
* **V2 Roadmap:** Implement client-side EXIF reading (Asset UUID identification) to group photo/video pairs in the UI and allow filtered uploads (e.g., "Photo Only" vs "Organized Subfolder").

---

## 7. Direct Upload Protocol (Resumable Uploads)

To prevent mobile browser memory crashes and survive intermittent mobile network failures, uploads utilize Google Drive's **Resumable Upload Protocol**.

```text
React Client                        Node.js Server                      Google Drive API
     │                                    │                                    │
     ├── 1. Get Access Token & Folder ID─>│                                    │
     │<── Return Credentials ─────────────┤                                    │
     │                                                                         │
     ├── 2. POST /upload/drive/v3/files?uploadType=resumable ─────────────────>│
     │      (Payload: Metadata + appFolderId)                                  │
     │<── 3. Return 200 OK + "Location" Header (Unique Resumable Session URI)─┤
     │                                                                         │
     ├── 4. PUT Chunk 1 (Bytes 0 - 5,242,879 via File.slice()) ───────────────>│
     │<──    Return 308 Resume Incomplete ─────────────────────────────────────┤
     │                                                                         │
     ├── 5. PUT Chunk 2 (Bytes 5,242,880 - End) ──────────────────────────────>│
     │<──    Return 200 OK (File Upload Complete) ─────────────────────────────┤

```

### Protocol Rules

* **Chunking:** Files are sliced using `Blob.slice()` into chunks in multiples of 256 KiB (Recommended default: 5 MB to 10 MB per chunk).
* **State Persistence:** Active Resumable Session URIs are saved in browser `IndexedDB` or `localStorage` alongside byte offsets, allowing interrupted multi-gigabyte uploads to resume seamlessly after network reconnections or page reloads.

---

## 8. Backend API Specifications (Node.js/Express)

### 1. Exchange Auth Code

* **Endpoint:** `POST /api/auth/exchange`
* **Request Body:** `{ "code": "STRING" }`
* **Response Body:** `{ "accessToken": "STRING", "user": { "email": "STRING", "appFolderId": "STRING" } }`

### 2. Refresh Access Token

* **Endpoint:** `POST /api/auth/refresh`
* **Request Body:** None (uses session cookie)
* **Response Body:** `{ "accessToken": "STRING" }`

### 3. User Configuration

* **Endpoint:** `GET /api/user/config`
* **Headers:** `Authorization: Bearer <SESSION_JWT>`
* **Response Body:** `{ "appFolderId": "STRING", "email": "STRING" }`

### 4. Ephemeral HEIC Transcode Stream (Opt-in Cloud Path)

* **Endpoint:** `POST /api/media/transcode-stream`
* **Headers:** `Authorization: Bearer <SESSION_JWT>`, `Content-Type: multipart/form-data`
* **Action:** Receives HEIC stream -> Transcodes to JPEG via `sharp` in memory -> Streams directly to Google Drive Resumable Session URI -> Flushes memory buffer.
* **Response Body:** `{ "status": "success", "driveFileId": "STRING" }`

---

## 9. Frontend Architecture & State Flow

### Screen Hierarchy

1. **Landing & Auth Page:** Value proposition banner ("Free up device storage"), privacy badges, and "Continue with Google" CTA.
2. **Dashboard (Gallery View):** Displays grid of uploaded files queried via `GET https://www.googleapis.com/drive/v3/files?q='<appFolderId>'+in+parents`. File thumbnails are rendered directly via Drive's `thumbnailLink`. Full file viewing redirects to Drive's `webViewLink`.
3. **Pre-Upload Decision Modal:** Intercepts selected files, checks for `.heic` extensions, and presents the user with format conversion options (Convert on Device / Fast Cloud / Keep Raw).
4. **Active Upload Queue View:** Renders per-file progress bars, transfer speeds, retry controls, and post-upload confirmation checks.

### UX Safety Verification Rule

* **Deletion Guidance Guardrail:** The UI must **never** suggest or prompt a user to delete a file from their local device until the application makes a verification request (`GET /drive/v3/files/<fileId>`) to confirm the file exists safely in their Google Drive folder.

---

## 10. Development Strategy & Milestones

* **Phase 1 (Proof of Concept):** Configure Google Cloud OAuth Console, setup Node.js/MySQL container, establish `drive.file` scope authorization, and verify creating the dedicated app folder.
* **Phase 2 (Upload Engine):** Implement the client-side `File.slice()` resumable upload utility and test multi-gigabyte video uploads directly to Drive.
* **Phase 3 (HEIC Integration):** Integrate `heic2any` WASM for on-device conversion, build the Express ephemeral `sharp` transcode stream, and hook up the pre-upload decision modal.
* **Phase 4 (Gallery UI & State):** Build React dashboard to list folder contents, render thumbnails, and handle session auto-refreshing.
* **Phase 5 (Mobile Refinement & Hardening):** Test upload recovery on mobile network drops, verify touch UI responsiveness, and run security/privacy reviews.