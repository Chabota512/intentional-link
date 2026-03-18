# Workspace

## Overview

pnpm workspace monorepo using TypeScript. The main artifact is the Focus Communication System — a mobile-first app for intentional, distraction-free communication via structured focus sessions.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
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
- **Contacts**: Add/remove trusted contacts by searching username
- **Sessions**: Create focus sessions, invite contacts, join sessions
- **Messaging**: Real-time polling every 2s for new messages within a session
- **Archive**: Past completed sessions are retained for review
- **Tab navigation**: Sessions, Contacts, Profile
- **Invite UI**: Creator can invite contacts from inside a session via a People sheet
- **Participants panel**: Tap participant count in session header to see all participants and their status (invited/joined)
- **Profile editing**: Users can edit their name and username from the Profile tab
- **Tab badge**: Sessions tab shows a badge count for pending invites (sessions where user is invited but hasn't joined)
- **Message status**: Own messages show a read tick indicator

## Database Schema (Drizzle ORM)

- `users` — id, username, name, passwordHash, createdAt
- `contacts` — id, userId, contactUserId, createdAt
- `sessions` — id, title, description, creatorId, status, createdAt, endedAt
- `session_participants` — id, sessionId, userId, status (invited|joined)
- `messages` — id, sessionId, senderId, content, status, createdAt

## API Routes

All at `/api/*`:

- `POST /users/register` — register
- `POST /users/login` — login
- `GET /users/me` — get current user
- `PUT /users/me` — update name/username
- `GET /users/search?q=` — search users
- `GET/POST /contacts` — list/add contacts
- `DELETE /contacts/:id` — remove contact
- `GET/POST /sessions` — list/create sessions
- `GET/PATCH /sessions/:id` — get/update session (includes `creator` object with name/username)
- `POST /sessions/:id/invite` — invite participant
- `POST /sessions/:id/join` — join session
- `GET/POST /sessions/:id/messages` — list/send messages
- `GET /sessions/:id/messages/poll?since=` — poll for new messages

## Auth mechanism

HMAC-signed token: `${userId}:${timestamp}.${hmac_signature}`. Token is generated on login/register and sent by the mobile client as `Authorization: Bearer <token>`. The API middleware validates the token, extracts userId, and sets `x-user-id` header for the routes. The old `x-user-id` header also continues to work as a fallback.

## Mobile App Structure

```text
artifacts/mobile/
├── app/
│   ├── _layout.tsx          # Root layout (Auth + QueryClient providers)
│   ├── index.tsx            # Redirect based on auth state
│   ├── auth.tsx             # Login / Register screen
│   ├── (tabs)/
│   │   ├── _layout.tsx      # Tab navigation with pending invite badge
│   │   ├── sessions.tsx     # Sessions list with filter
│   │   ├── contacts.tsx     # Contacts management
│   │   └── profile.tsx      # User profile + edit modal + logout
│   ├── session/
│   │   ├── new.tsx          # Create session modal
│   │   └── [id].tsx         # Chat screen + participants sheet + invite sheet
│   └── contacts/
│       └── add.tsx          # Add contact modal
├── context/AuthContext.tsx  # Auth state (user, login, register, logout, updateUser)
├── hooks/useApi.ts          # Fetch wrapper with x-user-id + Authorization headers
├── hooks/useTheme.ts        # Theme from constants/colors.ts
├── hooks/usePendingInvites.ts # Returns count of pending session invites for badge
├── constants/colors.ts      # Light + dark color palette
└── utils/date.ts            # formatRelative, formatTime helpers
```

## App Icon

AI-generated icon: white geometric lightning bolt on an indigo-to-violet gradient background (#4F6EF7 → #7C5CFC). Stored as 1024×1024 master at `artifacts/mobile/assets/images/icon.png`. Resized copies for all target sizes live in `artifacts/mobile/public/icons/`.

## PWA Setup

The web landing page (served by `artifacts/mobile/server/serve.js`) is fully PWA-ready:

- **Web App Manifest** — `artifacts/mobile/public/manifest.webmanifest` (name, short_name, theme_color, background_color, display: standalone, icons with `any` and `maskable` purpose)
- **Service Worker** — `artifacts/mobile/public/sw.js` (stale-while-revalidate for static assets, network-first for everything else, skips `/api/` routes)
- **Icon sizes** — 16, 32, 152, 167, 180, 192, 512px PNG + maskable 192 and 512 + favicon.ico (multi-size)
- **HTML meta tags** — theme-color, apple-mobile-web-app-capable/title/status-bar-style, Open Graph, Twitter Card, manifest link, apple-touch-icon links
- **Serve.js routes** — `/manifest.webmanifest` (no-cache), `/sw.js` (no-store + Service-Worker-Allowed: /), `/icons/*` (1-year immutable cache)
- **app.json web** — name, shortName, description, themeColor, backgroundColor, lang, bundler: metro, output: static

## Color Palette

Indigo accent (#4F6EF7 light, #6B85FF dark) on a cool grey background (#F0F2F8). Clean, minimal, professional feel inspired by Linear and Notion.
