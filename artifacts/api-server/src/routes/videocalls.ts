import { Router } from "express";
import { eq, and, ne, inArray } from "drizzle-orm";
import agoraToken from "agora-token";
import { db, sessionsTable, sessionParticipantsTable, usersTable } from "@workspace/db";
import { sendPushNotifications } from "../lib/pushNotifications.js";
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

    const [session] = await db.select({ creatorId: sessionsTable.creatorId })
      .from(sessionsTable).where(eq(sessionsTable.id, sessionId)).limit(1);

    if (caller && session) {
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
        const memberTokenRows = await db
          .select({ pushToken: usersTable.pushToken })
          .from(usersTable)
          .where(inArray(usersTable.id, otherUserIds));

        const pushTokens = memberTokenRows
          .map(r => r.pushToken)
          .filter((t): t is string => !!t);

        if (pushTokens.length > 0) {
          const callLabel = mode === "voice" ? "voice call" : "video call";
          await sendPushNotifications(
            pushTokens,
            `📞 Incoming ${callLabel}`,
            `${caller.name} is calling you`,
            { sessionId, mode, type: "incoming-call" },
          );
        }
      }
    }
  } catch {
    // Notification failure should not block the call
  }

  res.json({ appId: APP_ID, channel, token, uid });
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

  #videos { position: absolute; inset: 0; display: none; flex-wrap: wrap; gap: 4px; padding: 4px; }
  .video-container { flex: 1; min-width: 48%; background: #1a1a1a; border-radius: 10px; overflow: hidden; position: relative; min-height: 180px; }
  .video-container video { width: 100%; height: 100%; object-fit: cover; }
  .video-label { position: absolute; bottom: 6px; left: 8px; font-size: 12px; color: #fff; background: rgba(0,0,0,0.55); padding: 2px 8px; border-radius: 10px; }

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
    background: rgba(0,0,0,0.72);
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

  /* Pill buttons (WhatsApp / Messenger style) */
  .ctrl-btn {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: center;
    gap: 7px;
    padding: 0 18px;
    height: 50px;
    border-radius: 25px;
    border: none;
    cursor: pointer;
    background: rgba(40,40,40,0.88);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    box-shadow: 0 4px 20px rgba(0,0,0,0.45);
    transition: transform 0.1s, opacity 0.15s, background 0.2s;
    pointer-events: all;
    white-space: nowrap;
  }
  .ctrl-btn:active { transform: scale(0.94); opacity: 0.85; }
  .ctrl-btn svg { flex-shrink: 0; display: block; }
  .ctrl-label { font-size: 13px; font-weight: 600; color: #fff; letter-spacing: 0.1px; }

  .btn-mute.active { background: rgba(255,59,48,0.88); }
  .btn-video.active { background: rgba(255,59,48,0.88); }
  .btn-speaker.active { background: rgba(76,175,80,0.88); }
  .btn-end { background: rgba(220,38,38,0.95); box-shadow: 0 4px 20px rgba(220,38,38,0.5); }
</style>
</head>
<body>

<div id="status-screen">
  <div class="waiting-spinner"></div>
  <div id="status-text">Connecting…</div>
</div>

<div id="${isVoiceOnly ? "voice-ui" : "videos"}">
  ${isVoiceOnly ? `<div class="avatar">👤</div><div id="caller-name">Connecting…</div>` : ""}
</div>

<!-- Waiting for others overlay (shown after connected but no one else yet) -->
<div id="waiting-overlay" class="hidden">
  <div class="waiting-spinner"></div>
  <div class="waiting-text">Waiting for others to connect…</div>
  <div class="waiting-sub">Ringing participants</div>
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

function addLocalVideo() {
  const videos = document.getElementById('videos');
  let el = document.getElementById('local-video');
  if (!el) {
    el = document.createElement('div');
    el.id = 'local-video';
    el.className = 'video-container';
    el.innerHTML = '<span class="video-label">You</span>';
    videos.appendChild(el);
  }
  localVideoTrack?.play(el);
}

function addRemoteVideo(user) {
  const videos = document.getElementById('videos');
  let el = document.getElementById('remote-' + user.uid);
  if (!el) {
    el = document.createElement('div');
    el.id = 'remote-' + user.uid;
    el.className = 'video-container';
    el.innerHTML = '<span class="video-label">Participant</span>';
    videos.appendChild(el);
  }
  user.videoTrack?.play(el);
}

function removeRemoteVideo(uid) {
  const el = document.getElementById('remote-' + uid);
  if (el) el.remove();
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
