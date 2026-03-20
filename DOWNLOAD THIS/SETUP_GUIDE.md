# Focus App – Local Development & Production Build Guide

## What's in This Folder

```
DOWNLOAD THIS/
├── mobile/          ← Expo React Native app (the Focus app)
├── api-server/      ← Node.js/Express backend API
├── lib/
│   ├── db/          ← PostgreSQL schema (Drizzle ORM)
│   ├── api-spec/    ← OpenAPI spec
│   ├── api-client-react/  ← React hooks for API calls
│   └── api-zod/     ← Zod validation schemas
├── package.json     ← Root monorepo config
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

---

## Prerequisites

Install these on your local machine before anything else:

| Tool | Version | Download |
|------|---------|----------|
| Node.js | 20+ | https://nodejs.org |
| pnpm | 10+ | `npm install -g pnpm` |
| Expo CLI | Latest | `npm install -g expo-cli` |
| EAS CLI | Latest | `npm install -g eas-cli` |
| PostgreSQL | 14+ | https://postgresql.org |

---

## Step 1 – Install Dependencies

```bash
# In the root of the downloaded folder
pnpm install
```

This installs all workspace dependencies across the mobile app, API server, and shared libraries.

---

## Step 2 – Set Up Environment Variables

### API Server (`.env` in `api-server/`)

Create `api-server/.env`:

```env
DATABASE_URL=postgresql://your_user:your_password@localhost:5432/focus_db
JWT_SECRET=your_super_secret_jwt_key_here
DAILY_API_KEY=your_daily_co_api_key_here
PORT=8080
```

### Mobile App (`mobile/.env` or `mobile/app.json`)

The mobile app reads `EXPO_PUBLIC_DOMAIN` to know where the API lives.

For local development create `mobile/.env.local`:

```env
EXPO_PUBLIC_DOMAIN=localhost:8080
```

For production, set this to your deployed API server's domain (without `https://`).

---

## Step 3 – Set Up the Database

```bash
# Make sure PostgreSQL is running, then:
createdb focus_db

# Run migrations (from repo root)
pnpm --filter @workspace/db run migrate
```

If there's no migrate script, you can push the schema directly:

```bash
pnpm --filter @workspace/db run push
```

---

## Step 4 – Run in Development Mode

Open **two terminals**:

**Terminal 1 – API Server:**
```bash
pnpm --filter @workspace/api-server run dev
# Runs on http://localhost:8080
```

**Terminal 2 – Mobile App:**
```bash
pnpm --filter @workspace/mobile run dev
# Opens Expo Dev Tools in your browser
# Scan the QR code with Expo Go (limited) or your dev build
```

---

## Step 5 – Build a Real Standalone App (Away from Dev Mode)

This is how you turn the Expo project into a real `.apk` / `.ipa` / `.aab` file.

### 5a – Create an Expo Account

Go to https://expo.dev and create a free account.

```bash
eas login
```

### 5b – Configure EAS Build

From the `mobile/` folder:

```bash
cd mobile
eas build:configure
```

This creates an `eas.json` file. A good starting config:

```json
{
  "cli": {
    "version": ">= 16.0.0"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "preview": {
      "distribution": "internal",
      "android": { "buildType": "apk" }
    },
    "production": {
      "autoIncrement": true
    }
  },
  "submit": {
    "production": {}
  }
}
```

### 5c – Update `app.json`

Make sure your `mobile/app.json` has a valid bundle identifier:

```json
{
  "expo": {
    "name": "Focus",
    "slug": "focus-app",
    "version": "1.0.0",
    "ios": {
      "bundleIdentifier": "com.yourname.focusapp"
    },
    "android": {
      "package": "com.yourname.focusapp"
    },
    "plugins": [
      "react-native-webview"
    ]
  }
}
```

### 5d – Build for Android (APK for testing)

```bash
cd mobile
eas build --platform android --profile preview
```

This uploads your code to Expo's build servers and gives you a download link for the `.apk` when done (takes ~5-10 minutes).

### 5e – Build for iOS

You need an Apple Developer account ($99/year) to build for iOS.

```bash
eas build --platform ios --profile production
```

### 5f – Build for Both Platforms

```bash
eas build --platform all --profile production
```

---

## Step 6 – Deploy the API Server

You need a publicly accessible server for the mobile app to talk to. Options:

### Option A – Railway (easiest)
1. Go to https://railway.app
2. Connect your GitHub repo
3. Deploy the `api-server/` as a service
4. Add all environment variables from Step 2

### Option B – Render
1. Go to https://render.com
2. Create a new Web Service pointing to `api-server/`
3. Set build command: `pnpm install && pnpm --filter @workspace/api-server run build`
4. Set start command: `pnpm --filter @workspace/api-server run start`

### Option C – VPS (DigitalOcean, Linode, etc.)
```bash
# On your server:
git clone your-repo
cd your-repo
pnpm install
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/api-server run start
```

Use `pm2` to keep it running:
```bash
npm install -g pm2
pm2 start "pnpm --filter @workspace/api-server run start" --name focus-api
pm2 save
```

---

## Step 7 – Point the Mobile App at Your Production API

Once your API is deployed (e.g., `https://api.focusapp.com`), update `mobile/app.json`:

```json
{
  "expo": {
    "extra": {
      "apiDomain": "api.focusapp.com"
    }
  }
}
```

Or set `EXPO_PUBLIC_DOMAIN=api.focusapp.com` in your EAS build environment:

```bash
eas secret:create --scope project --name EXPO_PUBLIC_DOMAIN --value api.focusapp.com
```

Then rebuild the app with `eas build`.

---

## Step 8 – Submit to App Stores

### Google Play Store
```bash
eas submit --platform android
```
You'll need a Google Play Developer account ($25 one-time fee) and a service account key.

### Apple App Store
```bash
eas submit --platform ios
```
You'll need an Apple Developer account ($99/year).

---

## Important Notes on Native Modules

This app uses the following packages that **require a native dev build** (not Expo Go):

| Package | Why |
|---------|-----|
| `react-native-webview` | Video calls (Daily.co) |
| `react-native-zeroconf` | Local network peer discovery |
| `expo-av` | Voice messages |
| `expo-document-picker` | File attachments |

To test these features locally, build a **development client**:

```bash
cd mobile
eas build --profile development --platform android
# Install the APK on your Android device, then run:
pnpm --filter @workspace/mobile run dev
```

---

## Video Calls (Daily.co)

The app uses Daily.co for video calls. Your API key is already stored in the server's environment variables. To get it working locally:

1. Sign in at https://daily.co
2. Copy your API key from **Dashboard → Developers → API Keys**
3. Add it to `api-server/.env` as `DAILY_API_KEY=your_key`

The app will create a Daily.co room automatically when someone taps the video camera icon inside an active session.

---

## Folder Structure Reference

```
mobile/
├── app/
│   ├── (tabs)/           ← Bottom tab screens (sessions, contacts, profile)
│   ├── session/
│   │   ├── [id].tsx      ← Session chat screen
│   │   ├── call/
│   │   │   └── [id].tsx  ← Video call screen (Daily.co)
│   │   └── new.tsx       ← Create session screen
│   ├── contacts/add.tsx  ← Add contact screen
│   ├── auth.tsx          ← Login/register
│   └── _layout.tsx       ← Root layout & providers
├── components/           ← Reusable UI components
├── context/              ← React context providers
├── hooks/                ← Custom hooks (API, theme, etc.)
├── utils/                ← Helpers (date, confirm, discovery)
└── constants/            ← Colors, theme

api-server/src/
├── routes/
│   ├── sessions.ts       ← Session CRUD
│   ├── messages.ts       ← Messaging + reactions
│   ├── contacts.ts       ← Contact management
│   ├── users.ts          ← Auth + user profiles
│   ├── storage.ts        ← File uploads
│   └── videocalls.ts     ← Daily.co room management
└── lib/
    ├── auth.ts           ← JWT helpers
    └── pushNotifications.ts
```

---

## Quick Reference Commands

```bash
# Install everything
pnpm install

# Run API server
pnpm --filter @workspace/api-server run dev

# Run mobile app
pnpm --filter @workspace/mobile run dev

# Type check everything
pnpm typecheck

# Build dev client (Android)
cd mobile && eas build --profile development --platform android

# Build production APK (Android)
cd mobile && eas build --profile production --platform android

# Build production (iOS)
cd mobile && eas build --profile production --platform ios
```
