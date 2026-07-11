export const config = {
  runtime: "nodejs",
};

const RATE_LIMIT_WINDOW_MS = 60_000;
const rateLimits = new Map<string, number>();

type ContactBody = {
  nickname?: unknown;
  email?: unknown;
  category?: unknown;
  message?: unknown;
  hp_check?: unknown;
};

type ContactRequest = AsyncIterable<Uint8Array> & {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
};

type ContactResponse = {
  status: (code: number) => ContactResponse;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
};

const categories = new Set([
  "美國信用卡申請",
  "ITIN・銀行開戶",
  "旅遊點數",
  "租車險理賠",
  "內容更正",
  "其他",
]);

function getHeader(req: ContactRequest, name: string) {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function getClientIp(req: ContactRequest) {
  const forwardedFor = getHeader(req, "x-forwarded-for");
  return forwardedFor?.split(",")[0]?.trim() || "unknown";
}

function isRateLimited(ip: string) {
  const now = Date.now();
  const lastSentAt = rateLimits.get(ip);

  if (lastSentAt && now - lastSentAt < RATE_LIMIT_WINDOW_MS) return true;

  rateLimits.set(ip, now);
  return false;
}

async function readBody(req: ContactRequest) {
  if (req.body && typeof req.body === "object") return req.body as ContactBody;
  if (typeof req.body === "string") return JSON.parse(req.body) as ContactBody;

  const decoder = new TextDecoder();
  let rawBody = "";
  for await (const chunk of req) {
    rawBody += decoder.decode(chunk, { stream: true });
  }
  rawBody += decoder.decode();

  return rawBody ? (JSON.parse(rawBody) as ContactBody) : {};
}

function asTrimmedString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export default async function handler(req: ContactRequest, res: ContactResponse) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  }

  const ip = getClientIp(req);
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: "RATE_LIMITED" });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const toEmail = process.env.CONTACT_TO_EMAIL;

  if (!apiKey || !toEmail) {
    return res.status(500).json({ error: "CONTACT_EMAIL_NOT_CONFIGURED" });
  }

  let body: ContactBody;
  try {
    body = await readBody(req);
  } catch {
    return res.status(400).json({ error: "INVALID_JSON" });
  }

  if (asTrimmedString(body.hp_check)) {
    return res.status(200).json({ ok: true });
  }

  const nickname = asTrimmedString(body.nickname) || "未提供";
  const email = asTrimmedString(body.email);
  const category = asTrimmedString(body.category);
  const message = asTrimmedString(body.message);

  if (!email || !email.includes("@") || !categories.has(category) || !message) {
    return res.status(400).json({ error: "INVALID_CONTACT_FORM" });
  }

  const text = [
    "Grant 信用卡部落格收到新訊息",
    "",
    `暱稱：${nickname}`,
    `Email：${email}`,
    `分類：${category}`,
    `來源 IP：${ip}`,
    "",
    "訊息內容：",
    message,
  ].join("\n");

  const html = `
    <h2>Grant 信用卡部落格收到新訊息</h2>
    <p><strong>暱稱：</strong>${escapeHtml(nickname)}</p>
    <p><strong>Email：</strong>${escapeHtml(email)}</p>
    <p><strong>分類：</strong>${escapeHtml(category)}</p>
    <p><strong>來源 IP：</strong>${escapeHtml(ip)}</p>
    <hr />
    <p>${escapeHtml(message).replaceAll("\n", "<br />")}</p>
  `;

  const resendResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Grant Credit Card Blog <onboarding@resend.dev>",
      to: [toEmail],
      reply_to: email,
      subject: `[信用卡部落格聯絡] ${category}`,
      text,
      html,
    }),
  });

  if (!resendResponse.ok) {
    return res.status(502).json({ error: "EMAIL_SEND_FAILED" });
  }

  return res.status(200).json({ ok: true });
}
