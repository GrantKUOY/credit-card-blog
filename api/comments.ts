import { neon } from "@neondatabase/serverless";
import { ensureCommentsTable } from "./_comments-db.js";

export const config = {
  runtime: "nodejs",
};

const MAX_MESSAGE_LENGTH = 1000;
const MAX_NAME_LENGTH = 50;
const RATE_LIMIT_WINDOW_MS = 30_000;
const rateLimits = new Map<string, number>();
const sql = neon(process.env.DATABASE_URL!);

type CommentStatus = "published" | "pending";

type CommentBody = {
  post_slug?: unknown;
  name?: unknown;
  email?: unknown;
  message?: unknown;
  hp_check?: unknown;
};

type ApiRequest = AsyncIterable<Uint8Array> & {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
};

type ApiResponse = {
  status: (code: number) => ApiResponse;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
};

function getHeader(req: ApiRequest, name: string) {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function getClientIp(req: ApiRequest) {
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

async function readBody(req: ApiRequest) {
  if (req.body && typeof req.body === "object") return req.body as CommentBody;
  if (typeof req.body === "string") return JSON.parse(req.body) as CommentBody;

  const decoder = new TextDecoder();
  let rawBody = "";
  for await (const chunk of req) {
    rawBody += decoder.decode(chunk, { stream: true });
  }
  rawBody += decoder.decode();

  return rawBody ? (JSON.parse(rawBody) as CommentBody) : {};
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

function countLinks(value: string) {
  return value.match(/https?:\/\//gi)?.length ?? 0;
}

function getRequestUrl(req: ApiRequest) {
  return new URL(req.url || "/", "https://credit-card-blog.vercel.app");
}

async function sendNotification({
  postSlug,
  name,
  email,
  message,
  status,
}: {
  postSlug: string;
  name: string;
  email: string;
  message: string;
  status: CommentStatus;
}) {
  const apiKey = process.env.RESEND_API_KEY;
  const toEmail = process.env.CONTACT_TO_EMAIL;

  if (!apiKey || !toEmail) return;

  const statusLabel = status === "pending" ? "pending 待審" : "published 已公開";
  const adminUrl = "https://credit-card-blog.vercel.app/admin/comments";
  const text = [
    "Grant 信用卡部落格收到新留言",
    "",
    `文章 slug：${postSlug}`,
    `留言者：${name}`,
    `Email：${email || "未提供"}`,
    `狀態：${statusLabel}`,
    "",
    "留言內容：",
    message,
    "",
    `管理留言：${adminUrl}`,
  ].join("\n");

  const html = `
    <h2>Grant 信用卡部落格收到新留言</h2>
    <p><strong>文章 slug：</strong>${escapeHtml(postSlug)}</p>
    <p><strong>留言者：</strong>${escapeHtml(name)}</p>
    <p><strong>Email：</strong>${escapeHtml(email || "未提供")}</p>
    <p><strong>狀態：</strong>${escapeHtml(statusLabel)}</p>
    <hr />
    <p>${escapeHtml(message).replaceAll("\n", "<br />")}</p>
    <p><a href="${adminUrl}">前往 /admin/comments 管理留言</a></p>
  `;

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Grant Credit Card Blog <onboarding@resend.dev>",
      to: [toEmail],
      reply_to: email || undefined,
      subject: `[信用卡部落格留言] ${postSlug} - ${statusLabel}`,
      text,
      html,
    }),
  });
}

async function getPublishedComments(req: ApiRequest, res: ApiResponse) {
  const slug = asTrimmedString(getRequestUrl(req).searchParams.get("slug"));

  if (!slug) return res.status(400).json({ error: "MISSING_SLUG" });

  await ensureCommentsTable();
  const comments = await sql`
    SELECT name, message, created_at
    FROM comments WHERE post_slug = ${slug} AND status = 'published'
    ORDER BY created_at ASC
  `;

  return res.status(200).json({ comments });
}

async function createComment(req: ApiRequest, res: ApiResponse) {
  const ip = getClientIp(req);
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: "RATE_LIMITED" });
  }

  let body: CommentBody;
  try {
    body = await readBody(req);
  } catch {
    return res.status(400).json({ error: "INVALID_JSON" });
  }

  if (asTrimmedString(body.hp_check)) {
    return res.status(200).json({ ok: true });
  }

  const postSlug = asTrimmedString(body.post_slug);
  const name = asTrimmedString(body.name);
  const email = asTrimmedString(body.email);
  const message = asTrimmedString(body.message);

  if (!postSlug || !name || !message) {
    return res.status(400).json({ error: "INVALID_COMMENT" });
  }

  if (name.length > MAX_NAME_LENGTH || message.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({ error: "COMMENT_TOO_LONG" });
  }

  const status: CommentStatus =
    countLinks(message) >= 2 ? "pending" : "published";

  await ensureCommentsTable();
  await sql`
    INSERT INTO comments (post_slug, name, email, message, status)
    VALUES (${postSlug}, ${name}, ${email || null}, ${message}, ${status})
  `;

  await sendNotification({
    postSlug,
    name,
    email,
    message,
    status,
  });

  return res.status(200).json({
    ok: true,
    status,
    comment:
      status === "published"
        ? {
            name,
            message,
            created_at: new Date().toISOString(),
          }
        : undefined,
  });
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method === "GET") return getPublishedComments(req, res);
  if (req.method === "POST") return createComment(req, res);

  return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
}
