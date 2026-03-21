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
  body { background: #111; color: #fff; font-family: -apple-system, sans-serif; height: 100dvh; display: flex; flex-direction: column; }
  #status { text-align: center; padding: 20px; font-size: 14px; color: #aaa; }
  #videos { flex: 1; display: flex; flex-wrap: wrap; gap: 4px; padding: 4px; }
  .video-container { flex: 1; min-width: 48%; background: #222; border-radius: 8px; overflow: hidden; position: relative; min-height: 180px; }
  .video-container video { width: 100%; height: 100%; object-fit: cover; }
  .video-label { position: absolute; bottom: 6px; left: 8px; font-size: 12px; color: #fff; background: rgba(0,0,0,0.5); padding: 2px 6px; border-radius: 4px; }
  #voice-ui { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 24px; }
  .avatar { width: 96px; height: 96px; border-radius: 48px; background: #FF6B9D; display: flex; align-items: center; justify-content: center; font-size: 36px; font-weight: bold; }
  .speaking-ring { box-shadow: 0 0 0 6px rgba(255,107,157,0.4); }
  #caller-name { font-size: 20px; font-weight: 600; }
  #controls { display: flex; justify-content: center; align-items: flex-end; gap: 16px; padding: 20px 24px 32px; background: linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 100%); }
  .ctrl-wrap { display: flex; flex-direction: column; align-items: center; gap: 8px; }
  .ctrl-btn { width: 64px; height: 64px; border-radius: 32px; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: transform 0.1s, opacity 0.15s; background: rgba(255,255,255,0.15); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
  .ctrl-btn:active { transform: scale(0.92); opacity: 0.85; }
  .ctrl-btn svg { display: block; }
  .btn-mute.active { background: #FF3B30; }
  .btn-video.active { background: #FF3B30; }
  .btn-end { background: #FF3B30; width: 64px; height: 64px; border-radius: 32px; box-shadow: 0 4px 16px rgba(255,59,48,0.45); }
  .btn-label { font-size: 12px; font-weight: 500; color: rgba(255,255,255,0.75); text-align: center; letter-spacing: 0.1px; }
  #participants { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; }
  .participant { text-align: center; }
  .p-avatar { width: 56px; height: 56px; border-radius: 28px; background: #444; display: flex; align-items: center; justify-content: center; font-size: 20px; margin: 0 auto 4px; }
  .p-speaking { box-shadow: 0 0 0 3px #4CAF50; }
  .p-name { font-size: 11px; color: #aaa; }
</style>
</head>
<body>
<div id="status">Connecting…</div>
<div id="${isVoiceOnly ? "voice-ui" : "videos"}" style="display:none">
  ${isVoiceOnly ? `
  <div id="participants"></div>
  <div id="caller-name">Connected</div>
  ` : ""}
</div>
<div id="controls">
  <div class="ctrl-wrap">
    <button class="ctrl-btn btn-mute" id="btnMute" onclick="toggleMute()">
      <svg id="iconMute" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
    </button>
    <div class="btn-label" id="labelMute">Mute</div>
  </div>
  ${!isVoiceOnly ? `
  <div class="ctrl-wrap">
    <button class="ctrl-btn btn-video" id="btnVideo" onclick="toggleVideo()">
      <svg id="iconVideo" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
    </button>
    <div class="btn-label" id="labelVideo">Camera</div>
  </div>` : ""}
  <div class="ctrl-wrap">
    <button class="ctrl-btn btn-speaker" id="btnSpeaker" onclick="toggleSpeaker()">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
    </button>
    <div class="btn-label">Speaker</div>
  </div>
  <div class="ctrl-wrap">
    <button class="ctrl-btn btn-end" onclick="endCall()">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.42 19.42 0 0 1 4.26 8.63 19.79 19.79 0 0 1 1.19 0h0"/><line x1="23" y1="1" x2="1" y2="23"/></svg>
    </button>
    <div class="btn-label">End</div>
  </div>
</div>
<script src="https://cdn.agora.io/sdk/release/AgoraRTC_N-4.23.2.js"></script>
<script>
const isVoiceOnly = ${isVoiceOnly};
let client, localAudioTrack, localVideoTrack;
let muted = false, videoOff = false;
const remoteUsers = {};

async function init() {
  const params = new URLSearchParams(location.search);
  const appId = params.get('appId');
  const channel = params.get('channel');
  const token = params.get('token');
  const uid = parseInt(params.get('uid') || '0');

  if (!appId || !channel || !token) {
    document.getElementById('status').textContent = 'Missing call parameters.';
    return;
  }

  client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });

  client.on('user-published', async (user, mediaType) => {
    await client.subscribe(user, mediaType);
    if (mediaType === 'audio') {
      user.audioTrack?.play();
    }
    if (mediaType === 'video' && !isVoiceOnly) {
      addRemoteVideo(user);
    }
    updateParticipants();
  });

  client.on('user-unpublished', (user) => {
    if (!isVoiceOnly) removeRemoteVideo(user.uid);
    updateParticipants();
  });

  client.on('user-left', (user) => {
    delete remoteUsers[user.uid];
    if (!isVoiceOnly) removeRemoteVideo(user.uid);
    updateParticipants();
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

    document.getElementById('status').style.display = 'none';
    document.getElementById(isVoiceOnly ? 'voice-ui' : 'videos').style.display = isVoiceOnly ? 'flex' : 'flex';
    updateParticipants();
  } catch(e) {
    document.getElementById('status').textContent = 'Failed to connect: ' + e.message;
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
  remoteUsers[user.uid] = user;
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

function updateParticipants() {
  if (!isVoiceOnly) return;
  const container = document.getElementById('participants');
  const count = Object.keys(remoteUsers).length;
  document.getElementById('caller-name').textContent =
    count === 0 ? 'Waiting for others…' : count + ' participant' + (count !== 1 ? 's' : '') + ' connected';
}

function toggleMute() {
  muted = !muted;
  localAudioTrack?.setMuted(muted);
  const btn = document.getElementById('btnMute');
  btn.textContent = muted ? '🔇' : '🎤';
  btn.classList.toggle('active', muted);
}

function toggleVideo() {
  videoOff = !videoOff;
  localVideoTrack?.setMuted(videoOff);
  const btn = document.getElementById('btnVideo');
  btn.textContent = videoOff ? '🚫' : '📷';
  btn.classList.toggle('active', videoOff);
}

function toggleSpeaker() {
  // Signal to native app to toggle speaker
  if (window.ReactNativeWebView) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'toggleSpeaker' }));
  }
}

async function endCall() {
  if (localAudioTrack) { localAudioTrack.stop(); localAudioTrack.close(); }
  if (localVideoTrack) { localVideoTrack.stop(); localVideoTrack.close(); }
  if (client) await client.leave();
  if (window.ReactNativeWebView) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'endCall' }));
  } else {
    window.parent.postMessage(JSON.stringify({ type: 'endCall' }), '*');
  }
}

init();
</script>
</body>
</html>`;

  res.setHeader("Content-Type", "text/html");
  res.send(html);
});

export default router;
