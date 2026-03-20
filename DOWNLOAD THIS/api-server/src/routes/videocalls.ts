import { Router } from "express";

const router = Router();

const DAILY_API_KEY = process.env.DAILY_API_KEY!;
const DAILY_BASE = "https://api.daily.co/v1";

async function dailyFetch(path: string, method = "GET", body?: object) {
  const res = await fetch(`${DAILY_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${DAILY_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Daily API error ${res.status}: ${text}`);
  }
  return res.json();
}

function roomName(sessionId: number) {
  return `focus-session-${sessionId}`;
}

router.post("/sessions/:id/video-call", async (req, res) => {
  const userId = req.headers["x-user-id"];
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const sessionId = parseInt(req.params.id, 10);
  if (isNaN(sessionId)) return res.status(400).json({ error: "Invalid session id" });

  const name = roomName(sessionId);

  let room: { url: string; name: string };
  try {
    room = await dailyFetch(`/rooms/${name}`);
  } catch {
    room = await dailyFetch("/rooms", "POST", {
      name,
      privacy: "private",
      properties: {
        exp: Math.floor(Date.now() / 1000) + 60 * 60 * 4,
        enable_chat: false,
        enable_screenshare: true,
        start_video_off: false,
        start_audio_off: false,
      },
    });
  }

  const token = await dailyFetch("/meeting-tokens", "POST", {
    properties: {
      room_name: name,
      user_id: String(userId),
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 4,
      is_owner: false,
      enable_recording: "local",
    },
  });

  res.json({ roomUrl: room.url, token: token.token, roomName: name });
});

router.delete("/sessions/:id/video-call", async (req, res) => {
  const userId = req.headers["x-user-id"];
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const sessionId = parseInt(req.params.id, 10);
  if (isNaN(sessionId)) return res.status(400).json({ error: "Invalid session id" });

  try {
    await dailyFetch(`/rooms/${roomName(sessionId)}`, "DELETE");
  } catch {
  }

  res.json({ ok: true });
});

export default router;
