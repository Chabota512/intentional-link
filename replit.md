# Workspace

## Overview

pnpm workspace monorepo using TypeScript. The main artifact is Intentional Link — a mobile-first app for intentional, distraction-free communication via structured focus sessions.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: Neon PostgreSQL + Drizzle ORM (NEON_DATABASE_URL env var)
- **File storage**: PostgreSQL bytea (uploads stored directly in Neon DB, fully independent of Replit)
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Mobile**: Expo (React Native) with Expo Router

## Structure

```text
artifacts-monorepo/
├── artifacts/
│   ├── api-server/         # Express API server
│   └── mobile/             # Expo React Native app
├── lib/
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── tsconfig.json
└── package.json
```

## Focus Communication System Features

- **Auth**: Register/login with username + password (hashed with SHA-256). Login returns an HMAC-signed token.
- **Token validation**: API middleware validates `Authorization: Bearer <token>` header on protected routes
- **Contacts**: Add/remove trusted contacts by searching username. Shows online/last seen status.
- **Sessions**: Create focus sessions, invite contacts, join sessions
- **Messaging**: Real-time via Socket.IO WebSocket (polling kept as fallback)
- **Media messages**: Send images (photo picker), files (document picker), voice notes (recorded audio)
- **Online/last seen**: Heartbeat every 30s updates `lastSeenAt`; contacts show "Online" or "Xm ago"
- **Archive**: Past completed sessions are retained for review
- **Tab navigation**: Sessions, Contacts, Activity, Profile
- **Notification History**: In-app Activity tab shows all past notifications (messages, calls, invites) with unread badges and read/mark-all-read support. Stored in `notifications` DB table, delivered in real-time via Socket.IO `new_notification` event.
- **Call history in chat**: Voice/video calls are logged as special message bubbles in the session chat showing call type, status (answered/missed), and duration.
- **Real-time messaging**: Full Socket.IO WebSocket integration for instant message delivery, typing indicators, read receipts, reactions, and presence status.
- **Invite UI**: Creator can invite contacts from inside a session via a People sheet
- **Participants panel**: Tap participant count to see all participants, their status and online presence
- **Profile editing**: Users can edit their name, username, and profile picture from the Profile tab
- **Tab badge**: Sessions tab shows combined unread message count + pending invites badge; Contacts tab shows count of pending requests
- **Read receipts**: Own messages show single grey tick (sent), double grey (delivered), double blue #2196F3 (read)
- **Voice notes**: VoicePlayer shows sender avatar, waveform, duration; raise-to-ear switches playback to earpiece (iOS auto via PlayAndRecord category); marks voice notes as read after playback
- **Online presence dots**: UserAvatar shows green dot for online users in all locations (contacts, participants panel, chat)
- **Delete Session**: Creator can delete session from chat screen via trash icon in navbar
- **Session logo**: Create-session modal supports image upload for session cover art
- **Push notifications**: App registers device token on launch; server sends push when new message arrives or contact request is made; uses Expo push notification service
- **Expanded Settings page**: Full-featured settings with Account, Privacy, Sessions, About, and Danger Zone sections; includes account deletion and data clearing
- **Message actions**: Long-press a message to get action menu with reactions, Copy, Reply, and Delete (own messages only)
- **Reply to messages**: Messages can quote a parent message with visual reply bar; replyToId stored in DB with same-session validation
- **Message search**: Global search across all sessions from sessions list; results grouped by session with sender info
- **Media gallery**: Per-session media & files view accessible from chat header; grid view for photos, list for files
- **Session completion insights**: Completed sessions show summary card with duration, message count, media count, and participant count

## Database Schema (Drizzle ORM)

- `users` — id, username, name, displayName, passwordHash, avatarUrl, pushToken, createdAt, lastSeenAt
- `contacts` — id, userId, contactUserId, status (pending|accepted), createdAt
- `sessions` — id, name, description, imageUrl, creatorId, status, createdAt, endedAt
- `session_participants` — id, sessionId, userId, status (invited|joined)
- `messages` — id, sessionId, senderId, content, type (text|image|file|voice), attachmentUrl, attachmentName, attachmentSize, replyToId, status (sent|delivered|read), createdAt
- `uploads` — id (uuid), data (bytea), contentType, filename, fileSize, uploadedBy (FK→users), createdAt

## API Routes

All at `/api/*`:

- `POST /users/register` — register
- `POST /users/login` — login (updates lastSeenAt)
- `GET /users/me` — get current user
- `PUT /users/me` — update name/username/pushToken
- `DELETE /users/me` — delete account
- `DELETE /users/me/data` — clear all user data
- `POST /users/heartbeat` — update lastSeenAt (called every 30s by client)
- `GET /users/search?q=` — search users
- `GET/POST /contacts` — list/add contacts (includes lastSeenAt); sends push notification on request
- `DELETE /contacts/:id` — remove contact
- `POST /contacts/requests/:id/accept` — accept contact request
- `POST /contacts/requests/:id/decline` — decline contact request
- `GET /contacts/requests` — list pending incoming contact requests
- `GET/POST /sessions` — list/create sessions
- `GET/PATCH /sessions/:id` — get/update session (includes creator + participant lastSeenAt)
- `DELETE /sessions/:id` — delete session (creator only)
- `POST /sessions/:id/invite` — invite participant
- `POST /sessions/:id/join` — join session
- `GET/POST /sessions/:id/messages` — list/send messages; sends push notification to other participants
- `GET /sessions/:id/messages/poll?since=` — poll for new messages
- `POST /sessions/:id/messages/:msgId/play` — mark voice note as read
- `POST /sessions/:id/messages/:msgId/react` — toggle emoji reaction on a message
- `DELETE /sessions/:id/messages/:msgId` — delete own message
- `GET /messages/search?q=&sessionId=` — search messages across sessions
- `GET /sessions/:id/media?type=&limit=&offset=` — get session media (images, files, voice notes)
- `POST /storage/upload` — multipart upload; stores file as bytea in DB, returns `{ uploadId, url }`
- `GET /storage/uploads/:id` — stream file from DB by upload UUID

## Real-Time (Socket.IO)

WebSocket server runs alongside Express on the same HTTP server. Auth via JWT token on connection handshake.

**Events emitted by server:**
- `new_message` — broadcast to session room when a message is sent
- `message_status_update` — broadcast when message status changes (delivered/read)
- `typing_start` / `typing_stop` — relayed between session participants
- `presence_update` — broadcast when a user goes online/offline
- `messages_read` — broadcast when a user reads messages in a session
- `reaction_added` / `reaction_removed` — broadcast on emoji reaction changes
- `message_deleted` — broadcast when a message is deleted

**Events from client:**
- `join_session` / `leave_session` — join/leave a session room
- `typing_start` / `typing_stop` — signal typing state (auto-expires after 5s)
- `mark_read` — signal that messages have been read

**Files:** `artifacts/api-server/src/lib/socketio.ts`, `artifacts/api-server/src/index.ts`

## Auth mechanism

HMAC-signed token: `${userId}:${timestamp}.${hmac_signature}`. Token is generated on login/register and sent by the mobile client as `Authorization: Bearer <token>`. The API middleware validates the token, extracts userId, and sets `x-user-id` header for the routes.

## Mobile App Structure

```text
artifacts/mobile/
├── app/
│   ├── _layout.tsx          # Root layout (Auth + QueryClient + HeartbeatProvider)
│   ├── index.tsx            # Redirect based on auth state
│   ├── auth.tsx             # Login / Register screen
│   ├── (tabs)/
│   │   ├── _layout.tsx      # Tab navigation with pending invite badge
│   │   ├── sessions.tsx     # Sessions list with filter
│   │   ├── contacts.tsx     # Contacts with online/last seen indicators
│   │   └── profile.tsx      # User profile + edit modal + logout
│   ├── search.tsx           # Global message search screen
│   ├── session/
│   │   ├── new.tsx          # Create session modal
│   │   ├── [id].tsx         # Chat screen with media support + participants sheet + message actions
│   │   └── media/[id].tsx   # Media gallery (photos grid + files list) per session
│   └── contacts/
│       └── add.tsx          # Add contact modal
├── context/AuthContext.tsx  # Auth state (user, login, register, logout, updateUser)
├── context/SocketContext.tsx # Socket.IO client (connects on auth, handles real-time events)
├── hooks/useApi.ts              # Fetch wrapper with auth headers + uploadFile helper
├── hooks/useTheme.ts            # Theme from constants/colors.ts
├── hooks/useHeartbeat.ts        # Sends POST /users/heartbeat every 30s
├── hooks/usePendingInvites.ts
├── hooks/usePushNotifications.ts  # Registers device for push notifications on app launch
├── constants/colors.ts      # Light + dark color palette
└── utils/
    ├── date.ts              # formatRelative, formatTime helpers
    └── lastSeen.ts          # isOnline(), formatLastSeen() helpers
```

## File Storage (Database-backed)

- Files stored as `bytea` in the `uploads` table in Neon PostgreSQL
- Fully independent of Replit — no GCS or object storage bucket needed
- Upload flow: client POSTs multipart form (`POST /api/storage/upload`) → stored in DB → returns `/api/storage/uploads/:id` URL
- Serving: `GET /api/storage/uploads/:id` reads from DB and streams bytes to client
- Max file size: 50MB per upload (configurable in multer options)
- Profile pictures: stored as uploads, URL saved in `users.avatar_url`
- Server files: `artifacts/api-server/src/routes/storage.ts`, `lib/db/src/schema/uploads.ts`

## Color Palette

Indigo accent (#4F6EF7 light, #6B85FF dark) on a cool grey background (#F0F2F8). Clean, minimal, professional feel inspired by Linear and Notion.
