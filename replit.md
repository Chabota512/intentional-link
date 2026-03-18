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

- **Auth**: Register/login with username + password (hashed with SHA-256)
- **Contacts**: Add/remove trusted contacts by searching username
- **Sessions**: Create focus sessions, invite contacts, join sessions
- **Messaging**: Real-time polling every 2s for new messages within a session
- **Archive**: Past completed sessions are retained for review
- **Tab navigation**: Sessions, Contacts, Profile

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
- `GET /users/search?q=` — search users
- `GET/POST /contacts` — list/add contacts
- `DELETE /contacts/:id` — remove contact
- `GET/POST /sessions` — list/create sessions
- `GET/PATCH /sessions/:id` — get/update session
- `POST /sessions/:id/invite` — invite participant
- `POST /sessions/:id/join` — join session
- `GET/POST /sessions/:id/messages` — list/send messages
- `GET /sessions/:id/messages/poll?since=` — poll for new messages

## Auth mechanism

Simple header-based: `x-user-id: <userId>` sent from the mobile client (stored in AsyncStorage after login).

## Mobile App Structure

```text
artifacts/mobile/
├── app/
│   ├── _layout.tsx          # Root layout (Auth + QueryClient providers)
│   ├── index.tsx            # Redirect based on auth state
│   ├── auth.tsx             # Login / Register screen
│   ├── (tabs)/
│   │   ├── _layout.tsx      # Tab navigation (NativeTabs for iOS 26+)
│   │   ├── sessions.tsx     # Sessions list
│   │   ├── contacts.tsx     # Contacts management
│   │   └── profile.tsx      # User profile + logout
│   ├── session/
│   │   ├── new.tsx          # Create session modal
│   │   └── [id].tsx         # Chat screen for a session
│   └── contacts/
│       └── add.tsx          # Add contact modal
├── context/AuthContext.tsx  # Auth state (user, login, register, logout)
├── hooks/useApi.ts          # Simple fetch wrapper with x-user-id header
├── hooks/useTheme.ts        # Theme from constants/colors.ts
├── constants/colors.ts      # Light + dark color palette
└── utils/date.ts            # formatRelative, formatTime helpers
```

## Color Palette

Indigo accent (#4F6EF7 light, #6B85FF dark) on a cool grey background. Clean, minimal, professional feel inspired by Linear and Notion.
