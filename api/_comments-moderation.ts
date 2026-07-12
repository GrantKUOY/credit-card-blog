import { createHmac, timingSafeEqual } from "node:crypto";

export type ModerationAction = "approve" | "reject";

export function signModerationAction(id: number, action: ModerationAction) {
  const secret = process.env.ADMIN_TOKEN;
  if (!secret) return null;
  return createHmac("sha256", secret).update(`${id}:${action}`).digest("hex");
}

export function verifyModerationToken(
  id: number,
  action: ModerationAction,
  token: string
) {
  const expected = signModerationAction(id, action);
  if (!expected) return false;

  const expectedBuf = Uint8Array.from(Buffer.from(expected, "hex"));
  const providedBuf = Uint8Array.from(Buffer.from(token, "hex"));
  if (expectedBuf.length !== providedBuf.length) return false;

  return timingSafeEqual(expectedBuf, providedBuf);
}
