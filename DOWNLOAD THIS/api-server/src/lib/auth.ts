import crypto from "crypto";
import bcrypt from "bcryptjs";

const TOKEN_SECRET = process.env.TOKEN_SECRET || "focus_token_secret_2024";
const BCRYPT_ROUNDS = 10;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (hash.startsWith("$2")) {
    return bcrypt.compare(password, hash);
  }
  const sha256 = crypto.createHash("sha256").update(password + "focus_salt_2024").digest("hex");
  return sha256 === hash;
}

export function generateToken(userId: number): string {
  const timestamp = Date.now();
  const payload = `${userId}:${timestamp}`;
  const sig = crypto
    .createHmac("sha256", TOKEN_SECRET)
    .update(payload)
    .digest("hex");
  return `${payload}.${sig}`;
}

export function verifyToken(token: string): number | null {
  try {
    const lastDot = token.lastIndexOf(".");
    if (lastDot === -1) return null;
    const payload = token.substring(0, lastDot);
    const sig = token.substring(lastDot + 1);
    const expected = crypto
      .createHmac("sha256", TOKEN_SECRET)
      .update(payload)
      .digest("hex");
    if (sig !== expected) return null;
    const [userIdStr] = payload.split(":");
    const userId = parseInt(userIdStr, 10);
    return isNaN(userId) ? null : userId;
  } catch {
    return null;
  }
}
