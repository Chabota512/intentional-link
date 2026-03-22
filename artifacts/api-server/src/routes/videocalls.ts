import { Router } from "express";
import { eq, and, ne, inArray } from "drizzle-orm";
import agoraToken from "agora-token";
import { db, sessionsTable, sessionParticipantsTable, usersTable, messagesTable, userDndSettingsTable, dndWhitelistTable } from "@workspace/db";
import { sendPushNotifications, saveNotification } from "../lib/pushNotifications.js";
import { emitToSession } from "../lib/socketio.js";
const { RtcTokenBuilder, RtcRole } = agoraToken;

const router = Router();

const APP_ID = process.env.AGORA_APP_ID!;
const APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE!;

function channelName(sessionId: number) {
  return `focus-session-${sessionId}`;
}

router.post("/sessions/:id/video-call", async (req, res) => {
  const userId = req.headers["x-user-id"];
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const sessionId = parseInt(req.params.id, 10);
  if (isNaN(sessionId)) return res.status(400).json({ error: "Invalid session id" });

  if (!APP_ID || !APP_CERTIFICATE) {
    return res.status(500).json({ error: "Voice/video calls not configured" });
  }

  const uid = parseInt(userId as string, 10);
  const mode: string = req.body?.mode ?? "video";

  const [sessionRow] = await db.select({ creatorId: sessionsTable.creatorId })
    .from(sessionsTable).where(eq(sessionsTable.id, sessionId)).limit(1);
  if (!sessionRow) return res.status(404).json({ error: "Session not found" });

  if (sessionRow.creatorId !== uid) {
    const [participant] = await db.select({ userId: sessionParticipantsTable.userId })
      .from(sessionParticipantsTable)
      .where(and(
        eq(sessionParticipantsTable.sessionId, sessionId),
        eq(sessionParticipantsTable.userId, uid),
      )).limit(1);
    if (!participant) return res.status(403).json({ error: "Not a session member" });
  }
  let participantStatus: { ringing: string[]; offline: string[]; dnd: string[] } = { ringing: [], offline: [], dnd: [] };

  const channel = channelName(sessionId);
  const expireTime = Math.floor(Date.now() / 1000) + 4 * 60 * 60;

  const token = RtcTokenBuilder.buildTokenWithUid(
    APP_ID,
    APP_CERTIFICATE,
    channel,
    uid,
    RtcRole.PUBLISHER,
    expireTime,
    expireTime,
  );

  // Send push notifications to all other session members
  try {
    const [caller] = await db.select({ name: usersTable.name })
      .from(usersTable).where(eq(usersTable.id, uid)).limit(1);

    if (caller) {
      const session = sessionRow;
      // Get all member user IDs except the caller
      const participantRows = await db
        .select({ userId: sessionParticipantsTable.userId })
        .from(sessionParticipantsTable)
        .where(and(
          eq(sessionParticipantsTable.sessionId, sessionId),
          ne(sessionParticipantsTable.userId, uid),
        ));

      const otherUserIds = participantRows.map(p => p.userId);
      if (session.creatorId !== uid) otherUserIds.push(session.creatorId);

      if (otherUserIds.length > 0) {
        const callLabel = mode === "voice" ? "voice call" : "video call";
        const notifTitle = `Incoming ${callLabel}`;
        const notifBody = `${caller.name} is calling you`;
        const notifData = { sessionId, mode, type: "incoming-call" };

        const memberRows = await db
          .select({ id: usersTable.id, pushToken: usersTable.pushToken })
          .from(usersTable)
          .where(inArray(usersTable.id, otherUserIds));

        // Check DND status for each recipient
        const dndRows = await db
          .select({ userId: userDndSettingsTable.userId, isDndActive: userDndSettingsTable.isDndActive })
          .from(userDndSettingsTable)
          .where(inArray(userDndSettingsTable.userId, otherUserIds));
        const dndMap = new Map(dndRows.map(d => [d.userId, d.isDndActive]));

        // Check if caller is whitelisted by each DND user
        const dndUserIds = otherUserIds.filter(id => dndMap.get(id) === true);
        let whitelistedByDndMap = new Map<number, boolean>();
        if (dndUserIds.length > 0) {
          const whitelistRows = await db
            .select({ userId: dndWhitelistTable.userId, contactUserId: dndWhitelistTable.contactUserId })
            .from(dndWhitelistTable)
            .where(inArray(dndWhitelistTable.userId, dndUserIds));
          for (const row of whitelistRows) {
            if (row.contactUserId === uid) {
              whitelistedByDndMap.set(row.userId, true);
            }
          }
        }

        const { emitToUser, isUserOnline } = await import("../lib/socketio.js");
        const notifiableUsers: typeof memberRows = [];

        for (const member of memberRows) {
          const inDnd = dndMap.get(member.id) === true;
          const callerWhitelisted = whitelistedByDndMap.get(member.id) === true;

          if (inDnd && !callerWhitelisted) {
            emitToUser(uid, "call_blocked_dnd", {
              userId: member.id,
              message: `${memberRows.find(m => m.id === member.id) ? caller.name : "This contact"} is in Do Not Disturb mode`,
            });
          } else {
            notifiableUsers.push(member);
            emitToUser(member.id, "incoming_call", {
              sessionId,
              mode,
              callerId: uid,
              callerName: caller.name || "Unknown",
            });
          }
        }

        if (notifiableUsers.length > 0) {
          await Promise.all(notifiableUsers.map(u =>
            saveNotification(u.id, "call", notifTitle, notifBody, notifData)
          ));

          const pushTokens = notifiableUsers
            .map(r => r.pushToken)
            .filter((t): t is string => !!t);

          if (pushTokens.length > 0) {
            await sendPushNotifications(pushTokens, `📞 ${notifTitle}`, notifBody, notifData);
          }
        }

        const allMemberNames = await db
          .select({ id: usersTable.id, name: usersTable.name })
          .from(usersTable)
          .where(inArray(usersTable.id, otherUserIds));

        const nameMap = new Map(allMemberNames.map(m => [m.id, m.name || "Unknown"]));

        const ringingNames: string[] = [];
        const offlineNames: string[] = [];
        const dndNames: string[] = [];

        for (const id of otherUserIds) {
          const name = nameMap.get(id) || "Unknown";
          const inDnd = dndMap.get(id) === true;
          const callerWhitelisted = whitelistedByDndMap.get(id) === true;

          if (inDnd && !callerWhitelisted) {
            dndNames.push(name);
          } else if (isUserOnline(id)) {
            ringingNames.push(name);
          } else {
            offlineNames.push(name);
          }
        }

        participantStatus = { ringing: ringingNames, offline: offlineNames, dnd: dndNames };
      }
    }
  } catch {
    // Notification failure should not block the call
  }

  res.json({ appId: APP_ID, channel, token, uid, participants: participantStatus });
});

router.post("/sessions/:id/call-log", async (req, res) => {
  const userIdStr = req.headers["x-user-id"];
  if (!userIdStr) return res.status(401).json({ error: "Unauthorized" });
  const uid = parseInt(userIdStr as string, 10);
  const sessionId = parseInt(req.params.id, 10);
  if (isNaN(sessionId)) return res.status(400).json({ error: "Invalid session id" });

  const { mode = "voice", status = "missed", duration = 0 } = req.body ?? {};

  try {
    const content = JSON.stringify({ mode, status, duration: Math.round(duration) });
    const [msg] = await db.insert(messagesTable).values({
      sessionId,
      senderId: uid,
      content,
      type: "call" as any,
      status: "sent",
    }).returning();

    const [sender] = await db.select({
      id: usersTable.id,
      name: usersTable.name,
      username: usersTable.username,
      avatarUrl: usersTable.avatarUrl,
      createdAt: usersTable.createdAt,
      lastSeenAt: usersTable.lastSeenAt,
    }).from(usersTable).where(eq(usersTable.id, uid)).limit(1);

    const fullMsg = { ...msg, sender, reactions: [] };
    emitToSession(sessionId, "new_message", fullMsg);

    res.json(fullMsg);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/sessions/:id/call-page", async (req, res) => {
  const { mode = "video" } = req.query;
  const isVoiceOnly = mode === "voice";

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${isVoiceOnly ? "Voice" : "Video"} Call</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #111; color: #fff; font-family: -apple-system, BlinkMacSystemFont, sans-serif; height: 100dvh; display: flex; flex-direction: column; overflow: hidden; position: relative; }

  /* Main content areas */
  #status-screen { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; z-index: 5; background: #111; }
  #status-text { font-size: 15px; color: #aaa; }

  /* Video container */
  #videos { position: absolute; inset: 0; display: none; }

  /* ── GRID MODE ────────────────────────────────── */
  #remote-grid {
    position: absolute; inset: 0;
    display: grid; gap: 3px; background: #0a0a0a;
    transition: grid-template-columns 0.3s, grid-template-rows 0.3s;
  }
  #remote-grid.count-1 { grid-template-columns: 1fr; grid-template-rows: 1fr; }
  #remote-grid.count-2 { grid-template-columns: 1fr; grid-template-rows: 1fr 1fr; }
  #remote-grid.count-3 { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; }
  #remote-grid.count-many { grid-template-columns: 1fr 1fr; grid-auto-rows: 200px; overflow-y: auto; }

  .remote-tile {
    position: relative; overflow: hidden;
    background: #1a1a1a; cursor: pointer;
    transition: opacity 0.2s;
  }
  .remote-tile:active { opacity: 0.85; }
  .remote-tile.span-full { grid-column: 1 / -1; }
  .remote-tile video { width: 100%; height: 100%; object-fit: cover; display: block; }

  /* tap-to-spotlight hint */
  .tap-hint {
    position: absolute; top: 8px; right: 8px;
    background: rgba(0,0,0,0.5); border-radius: 10px;
    padding: 3px 8px; font-size: 10px; color: rgba(255,255,255,0.7);
    opacity: 0; animation: fadeHint 3s forwards;
  }
  @keyframes fadeHint { 0%,60%{opacity:1} 100%{opacity:0} }

  /* ── SPOTLIGHT MODE ───────────────────────────── */
  #spotlight-view {
    position: absolute; inset: 0;
    background: #1a1a1a; display: none; cursor: pointer;
  }
  #spotlight-view video { width: 100%; height: 100%; object-fit: cover; display: block; }
  #spotlight-back-hint {
    position: absolute; top: 12px; left: 50%; transform: translateX(-50%);
    background: rgba(0,0,0,0.55); border-radius: 20px;
    padding: 5px 14px; font-size: 12px; color: rgba(255,255,255,0.8);
    pointer-events: none;
  }

  /* Thumbnail strip at bottom (spotlight mode) */
  #thumb-strip {
    position: absolute; bottom: 100px; left: 0; right: 0;
    height: 116px; display: none;
    flex-direction: row; gap: 6px;
    padding: 0 10px; overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    z-index: 7; align-items: center;
  }
  #thumb-strip::-webkit-scrollbar { display: none; }
  .thumb-tile {
    flex-shrink: 0; width: 72px; height: 104px;
    border-radius: 12px; overflow: hidden;
    background: #2a2a2a; cursor: pointer;
    border: 2px solid rgba(255,255,255,0.15);
    position: relative; transition: border-color 0.2s, transform 0.15s;
  }
  .thumb-tile:active { transform: scale(0.95); }
  .thumb-tile.is-spotlight { border-color: #FF6B9D; }
  .thumb-tile video { width: 100%; height: 100%; object-fit: cover; display: block; pointer-events: none; }
  .thumb-label {
    position: absolute; bottom: 4px; left: 0; right: 0;
    text-align: center; font-size: 9px; color: rgba(255,255,255,0.75);
    background: rgba(0,0,0,0.45); padding: 2px 0;
  }

  /* ── LOCAL VIDEO PiP ──────────────────────────── */
  #local-video-wrap {
    position: absolute; top: 16px; right: 14px;
    width: 96px; height: 148px;
    border-radius: 14px; overflow: hidden;
    background: #333;
    box-shadow: 0 4px 18px rgba(0,0,0,0.6);
    border: 2px solid rgba(255,255,255,0.15);
    z-index: 6; cursor: grab; touch-action: none;
    transition: box-shadow 0.15s, transform 0.15s;
    user-select: none;
  }
  #local-video-wrap.dragging {
    cursor: grabbing;
    box-shadow: 0 8px 30px rgba(0,0,0,0.75);
    transform: scale(1.04);
    transition: box-shadow 0.15s;
  }
  #local-video-wrap video { width: 100%; height: 100%; object-fit: cover; pointer-events: none; }

  .video-label { position: absolute; bottom: 6px; left: 8px; font-size: 11px; color: #fff; background: rgba(0,0,0,0.55); padding: 2px 8px; border-radius: 10px; }

  #voice-ui { position: absolute; inset: 0; display: none; flex-direction: column; align-items: center; justify-content: center; gap: 20px; }
  .avatar { width: 100px; height: 100px; border-radius: 50px; background: #FF6B9D; display: flex; align-items: center; justify-content: center; font-size: 38px; font-weight: bold; }
  #caller-name { font-size: 20px; font-weight: 600; }

  /* Waiting overlay — shown until first remote user joins */
  #waiting-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    background: rgba(0,0,0,0.92);
    z-index: 8;
    transition: opacity 0.4s;
  }
  #waiting-overlay.hidden { opacity: 0; pointer-events: none; }
  .waiting-spinner {
    width: 44px; height: 44px; border-radius: 50%;
    border: 3px solid rgba(255,255,255,0.15);
    border-top-color: #FF6B9D;
    animation: spin 1s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .waiting-text { font-size: 15px; color: #ccc; font-weight: 500; }
  .waiting-sub { font-size: 12px; color: #777; }

  /* Floating controls — no background container */
  #controls {
    position: absolute;
    bottom: 0;
    left: 0; right: 0;
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 10px;
    padding: 24px 16px 36px;
    z-index: 10;
    pointer-events: none;
  }

  /* Compact circular icon buttons */
  .ctrl-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 56px;
    height: 56px;
    border-radius: 28px;
    border: none;
    cursor: pointer;
    background: rgba(40,40,40,0.88);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    box-shadow: 0 4px 16px rgba(0,0,0,0.45);
    transition: transform 0.1s, opacity 0.15s, background 0.2s;
    pointer-events: all;
  }
  .ctrl-btn:active { transform: scale(0.90); opacity: 0.80; }
  .ctrl-btn svg { flex-shrink: 0; display: block; }
  .ctrl-label { display: none; }

  .btn-mute.active { background: rgba(255,59,48,0.88); }
  .btn-video.active { background: rgba(255,59,48,0.88); }
  .btn-speaker.active { background: rgba(76,175,80,0.88); }
  .btn-end { background: rgba(220,38,38,0.95); box-shadow: 0 4px 20px rgba(220,38,38,0.5); }
  .btn-flip { transition: transform 0.3s cubic-bezier(.4,0,.2,1), background 0.2s, opacity 0.15s; }
</style>
</head>
<body>

<div id="status-screen">
  <div class="waiting-spinner"></div>
  <div id="status-text">Connecting…</div>
</div>

<div id="${isVoiceOnly ? "voice-ui" : "videos"}">
  ${isVoiceOnly ? `<div class="avatar">👤</div><div id="caller-name">Connecting…</div>` : `
  <div id="remote-grid" class="count-1"></div>
  <div id="spotlight-view">
    <div id="spotlight-back-hint">Tap to go back to grid</div>
  </div>
  <div id="thumb-strip"></div>
  <div id="local-video-wrap">
    <span class="video-label">You</span>
  </div>
  `}
</div>

<!-- Waiting for others overlay (shown after connected but no one else yet) -->
<div id="waiting-overlay" class="hidden">
  <div class="waiting-spinner"></div>
  <div class="waiting-text">Waiting for others to join…</div>
  <div id="ringing-info" class="waiting-sub" style="color:#4CAF50;"></div>
  <div id="offline-info" class="waiting-sub" style="color:#94A3B8;"></div>
  <div id="dnd-info" class="waiting-sub" style="color:#FF9800;"></div>
</div>

<div id="controls">
  <button class="ctrl-btn btn-mute" id="btnMute" onclick="toggleMute()">
    <svg id="iconMute" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
    <span class="ctrl-label" id="labelMute">Mute</span>
  </button>

  ${!isVoiceOnly ? `
  <button class="ctrl-btn btn-video" id="btnVideo" onclick="toggleVideo()">
    <svg id="iconVideo" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
    <span class="ctrl-label" id="labelVideo">Camera</span>
  </button>
  <button class="ctrl-btn btn-flip" id="btnFlip" onclick="flipCamera()">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 4v6h6"/><path d="M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4-4.64 4.36A9 9 0 0 1 3.51 15"/></svg>
    <span class="ctrl-label">Flip</span>
  </button>` : ""}

  <button class="ctrl-btn btn-speaker" id="btnSpeaker" onclick="toggleSpeaker()">
    <svg id="iconSpeaker" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
    <span class="ctrl-label">Speaker</span>
  </button>

  <button class="ctrl-btn btn-end" onclick="endCall()">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.62 3.38 2 2 0 0 1 3.6 1.21h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.77a16 16 0 0 0 6.29 6.29l1.63-1.63a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
    <span class="ctrl-label">End Call</span>
  </button>
</div>

<script src="https://cdn.agora.io/sdk/release/AgoraRTC_N-4.23.2.js"></script>
<script>
const isVoiceOnly = ${isVoiceOnly};
let client, localAudioTrack, localVideoTrack;
let muted = false, videoOff = false, speakerActive = true;
const remoteUsers = {};
let availableCameras = [];
let currentCameraIndex = 0;

function postToNative(msg) {
  if (window.ReactNativeWebView) {
    window.ReactNativeWebView.postMessage(JSON.stringify(msg));
  } else {
    window.parent.postMessage(JSON.stringify(msg), '*');
  }
}

function updateWaitingOverlay() {
  const count = Object.keys(remoteUsers).length;
  const overlay = document.getElementById('waiting-overlay');
  if (count === 0) {
    overlay.classList.remove('hidden');
  } else {
    overlay.classList.add('hidden');
  }
  if (isVoiceOnly) {
    const nameEl = document.getElementById('caller-name');
    if (nameEl) {
      nameEl.textContent = count === 0
        ? 'Waiting for others to connect…'
        : count + ' participant' + (count !== 1 ? 's' : '') + ' connected';
    }
  }
}

async function init() {
  const params = new URLSearchParams(location.search);
  const appId = params.get('appId');
  const channel = params.get('channel');
  const token = params.get('token');
  const uid = parseInt(params.get('uid') || '0');

  const ringingNames = (params.get('ringing') || '').split(',').filter(Boolean);
  const offlineNames = (params.get('offline') || '').split(',').filter(Boolean);
  const dndNames = (params.get('dnd') || '').split(',').filter(Boolean);
  if (ringingNames.length > 0) document.getElementById('ringing-info').textContent = 'Ringing: ' + ringingNames.join(', ');
  if (offlineNames.length > 0) document.getElementById('offline-info').textContent = 'Offline: ' + offlineNames.join(', ');
  if (dndNames.length > 0) document.getElementById('dnd-info').textContent = 'Do Not Disturb: ' + dndNames.join(', ');

  if (!appId || !channel || !token) {
    document.getElementById('status-text').textContent = 'Missing call parameters.';
    return;
  }

  client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });

  client.on('user-published', async (user, mediaType) => {
    await client.subscribe(user, mediaType);
    if (mediaType === 'audio') user.audioTrack?.play();
    if (mediaType === 'video' && !isVoiceOnly) addRemoteVideo(user);
    remoteUsers[user.uid] = user;
    updateWaitingOverlay();
    postToNative({ type: 'participantJoined', count: Object.keys(remoteUsers).length });
  });

  client.on('user-unpublished', (user) => {
    if (!isVoiceOnly) removeRemoteVideo(user.uid);
    updateWaitingOverlay();
  });

  client.on('user-left', (user) => {
    delete remoteUsers[user.uid];
    if (!isVoiceOnly) removeRemoteVideo(user.uid);
    updateWaitingOverlay();
    postToNative({ type: 'participantLeft', count: Object.keys(remoteUsers).length });
  });

  try {
    await client.join(appId, channel, token, uid);

    localAudioTrack = await AgoraRTC.createMicrophoneAudioTrack();
    const tracks = [localAudioTrack];

    if (!isVoiceOnly) {
      try {
        localVideoTrack = await AgoraRTC.createCameraVideoTrack();
        tracks.push(localVideoTrack);
        addLocalVideo();
      } catch(e) {
        console.warn('Camera unavailable, audio only');
      }
    }

    await client.publish(tracks);

    document.getElementById('status-screen').style.display = 'none';
    const mainEl = document.getElementById(isVoiceOnly ? 'voice-ui' : 'videos');
    mainEl.style.display = isVoiceOnly ? 'flex' : 'flex';

    updateWaitingOverlay();
    postToNative({ type: 'callConnected' });
  } catch(e) {
    document.getElementById('status-text').textContent = 'Failed to connect: ' + e.message;
  }
}

let spotlightUid = null;

function addLocalVideo() {
  const wrap = document.getElementById('local-video-wrap');
  if (wrap) {
    localVideoTrack?.play(wrap);
    initPipDrag(wrap);
  }
}

/* ── GRID / SPOTLIGHT LAYOUT ─────────────────────── */

function updateVideoLayout() {
  if (spotlightUid !== null && !remoteUsers[spotlightUid]) spotlightUid = null;
  if (spotlightUid !== null) {
    buildSpotlight();
  } else {
    buildGrid();
  }
}

function buildGrid() {
  const grid = document.getElementById('remote-grid');
  const spotlightView = document.getElementById('spotlight-view');
  const strip = document.getElementById('thumb-strip');
  const pip = document.getElementById('local-video-wrap');

  spotlightView.style.display = 'none';
  strip.style.display = 'none';
  grid.style.display = 'grid';
  if (pip) pip.style.display = 'block';

  grid.innerHTML = '';
  const uids = Object.keys(remoteUsers);
  const count = uids.length;

  if (count === 0) { grid.className = 'count-1'; return; }
  grid.className = count <= 4 ? 'count-' + count : 'count-many';

  uids.forEach((uid, i) => {
    const user = remoteUsers[uid];
    const tile = document.createElement('div');
    tile.className = 'remote-tile' + (count === 3 && i === 2 ? ' span-full' : '');
    tile.id = 'tile-' + uid;
    if (count > 1 && i === 0) {
      const hint = document.createElement('span');
      hint.className = 'tap-hint';
      hint.textContent = 'Tap to expand';
      tile.appendChild(hint);
    }
    const label = document.createElement('span');
    label.className = 'video-label';
    label.textContent = 'Participant';
    tile.appendChild(label);
    tile.onclick = () => setSpotlight(String(uid));
    grid.appendChild(tile);
    user.videoTrack?.play(tile);
  });
}

function buildSpotlight() {
  const grid = document.getElementById('remote-grid');
  const spotlightView = document.getElementById('spotlight-view');
  const strip = document.getElementById('thumb-strip');
  const pip = document.getElementById('local-video-wrap');

  grid.style.display = 'none';
  spotlightView.style.display = 'block';
  strip.style.display = 'flex';
  if (pip) pip.style.display = 'none';

  // Clear spotlight video area (keep the back hint)
  const hint = document.getElementById('spotlight-back-hint');
  spotlightView.innerHTML = '';
  spotlightView.appendChild(hint);
  spotlightView.onclick = exitSpotlight;
  remoteUsers[spotlightUid]?.videoTrack?.play(spotlightView);

  // Build thumb strip
  strip.innerHTML = '';

  // Local camera thumb
  const localThumb = makeThumb('You', false, () => setLocalSpotlight());
  strip.appendChild(localThumb);
  localVideoTrack?.play(localThumb);

  // Other remote participants
  Object.keys(remoteUsers).forEach(uid => {
    const isActive = uid == spotlightUid;
    const thumb = makeThumb('Participant', isActive, isActive ? null : () => setSpotlight(String(uid)));
    strip.appendChild(thumb);
    remoteUsers[uid]?.videoTrack?.play(thumb);
  });
}

function makeThumb(label, isActive, onClick) {
  const div = document.createElement('div');
  div.className = 'thumb-tile' + (isActive ? ' is-spotlight' : '');
  const lbl = document.createElement('span');
  lbl.className = 'thumb-label';
  lbl.textContent = label;
  div.appendChild(lbl);
  if (onClick) div.onclick = onClick;
  return div;
}

function setSpotlight(uid) {
  spotlightUid = uid;
  updateVideoLayout();
}

function exitSpotlight() {
  spotlightUid = null;
  updateVideoLayout();
}

function setLocalSpotlight() {
  // Swap: put local video full screen, remote goes to strip
  // For simplicity, exit spotlight (grid shows all)
  exitSpotlight();
}

function initPipDrag(el) {
  const W = 96, H = 148, MARGIN = 12;
  let startX, startY, startLeft, startTop, isDragging = false;

  // Convert from right-based to left-based positioning once
  function ensureLeftTop() {
    const rect = el.getBoundingClientRect();
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    el.style.left = rect.left + 'px';
    el.style.top = rect.top + 'px';
  }

  function snapToCorner() {
    const sw = window.innerWidth, sh = window.innerHeight;
    const curL = parseFloat(el.style.left) || 0;
    const curT = parseFloat(el.style.top) || 0;
    const cx = curL + W / 2, cy = curT + H / 2;
    const snapLeft = cx < sw / 2 ? MARGIN : sw - W - MARGIN;
    const snapTop  = cy < sh / 2 ? MARGIN : sh - H - MARGIN - 90; // leave room for controls
    el.style.transition = 'left 0.25s cubic-bezier(.25,.8,.25,1), top 0.25s cubic-bezier(.25,.8,.25,1), box-shadow 0.15s, transform 0.15s';
    el.style.left = snapLeft + 'px';
    el.style.top  = snapTop  + 'px';
    setTimeout(() => { el.style.transition = 'box-shadow 0.15s, transform 0.15s'; }, 260);
  }

  // Touch events (mobile)
  el.addEventListener('touchstart', e => {
    ensureLeftTop();
    const t = e.touches[0];
    startX = t.clientX; startY = t.clientY;
    startLeft = parseFloat(el.style.left); startTop = parseFloat(el.style.top);
    isDragging = false;
    el.style.transition = 'box-shadow 0.15s, transform 0.15s';
  }, { passive: true });

  el.addEventListener('touchmove', e => {
    const t = e.touches[0];
    const dx = t.clientX - startX, dy = t.clientY - startY;
    if (!isDragging && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    isDragging = true;
    e.preventDefault();
    el.classList.add('dragging');
    const sw = window.innerWidth, sh = window.innerHeight;
    el.style.left = Math.min(Math.max(startLeft + dx, MARGIN), sw - W - MARGIN) + 'px';
    el.style.top  = Math.min(Math.max(startTop  + dy, MARGIN), sh - H - MARGIN) + 'px';
  }, { passive: false });

  el.addEventListener('touchend', () => {
    el.classList.remove('dragging');
    if (isDragging) snapToCorner();
  });

  // Pointer events (desktop / fallback)
  el.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch') return;
    ensureLeftTop();
    startX = e.clientX; startY = e.clientY;
    startLeft = parseFloat(el.style.left); startTop = parseFloat(el.style.top);
    isDragging = false;
    el.setPointerCapture(e.pointerId);
    el.style.transition = 'box-shadow 0.15s, transform 0.15s';
  });

  el.addEventListener('pointermove', e => {
    if (e.pointerType === 'touch' || !el.hasPointerCapture(e.pointerId)) return;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    if (!isDragging && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    isDragging = true;
    el.classList.add('dragging');
    const sw = window.innerWidth, sh = window.innerHeight;
    el.style.left = Math.min(Math.max(startLeft + dx, MARGIN), sw - W - MARGIN) + 'px';
    el.style.top  = Math.min(Math.max(startTop  + dy, MARGIN), sh - H - MARGIN) + 'px';
  });

  el.addEventListener('pointerup', e => {
    if (e.pointerType === 'touch') return;
    el.classList.remove('dragging');
    if (isDragging) snapToCorner();
  });
}

function addRemoteVideo(user) {
  remoteUsers[user.uid] = user;
  updateVideoLayout();
}

function removeRemoteVideo(uid) {
  delete remoteUsers[uid];
  updateVideoLayout();
}

async function flipCamera() {
  if (!localVideoTrack) return;
  try {
    if (availableCameras.length < 2) {
      availableCameras = await AgoraRTC.getCameras();
    }
    if (availableCameras.length < 2) return;
    currentCameraIndex = (currentCameraIndex + 1) % availableCameras.length;
    await localVideoTrack.setDevice(availableCameras[currentCameraIndex].deviceId);
    const btn = document.getElementById('btnFlip');
    if (btn) {
      btn.style.transform = 'scale(0.85) rotate(180deg)';
      setTimeout(() => { btn.style.transform = ''; }, 300);
    }
  } catch(e) {
    console.warn('Camera flip failed:', e);
  }
}

function toggleMute() {
  muted = !muted;
  localAudioTrack?.setMuted(muted);
  const btn = document.getElementById('btnMute');
  btn.classList.toggle('active', muted);
  document.getElementById('labelMute').textContent = muted ? 'Unmute' : 'Mute';
  const icon = document.getElementById('iconMute');
  icon.innerHTML = muted
    ? '<line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>'
    : '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>';
}

function toggleVideo() {
  videoOff = !videoOff;
  localVideoTrack?.setMuted(videoOff);
  const btn = document.getElementById('btnVideo');
  btn.classList.toggle('active', videoOff);
  document.getElementById('labelVideo').textContent = videoOff ? 'Start Cam' : 'Camera';
  const icon = document.getElementById('iconVideo');
  icon.innerHTML = videoOff
    ? '<line x1="1" y1="1" x2="23" y2="23"/><path d="M21 21H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3m3-3h6l2 3h2a2 2 0 0 1 2 2v9.34"/><line x1="16" y1="11" x2="22.56" y2="7.67"/><line x1="16" y1="16.44" x2="22" y2="19.31"/>'
    : '<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>';
}

function toggleSpeaker() {
  speakerActive = !speakerActive;
  const btn = document.getElementById('btnSpeaker');
  btn.classList.toggle('active', speakerActive);
  postToNative({ type: 'toggleSpeaker' });
}

async function endCall() {
  if (localAudioTrack) { localAudioTrack.stop(); localAudioTrack.close(); }
  if (localVideoTrack) { localVideoTrack.stop(); localVideoTrack.close(); }
  if (client) await client.leave();
  postToNative({ type: 'endCall' });
}

init();
</script>
</body>
</html>`;

  res.setHeader("Content-Type", "text/html");
  res.send(html);
});

export default router;
