import { neon } from "@neondatabase/serverless";
import { ensureCommentsTable } from "./_comments-db";

export const config = {
  runtime: "nodejs",
};

type AdminStatus = "published" | "pending" | "rejected";

type AdminBody = {
  status?: unknown;
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

const adminStatuses = new Set<AdminStatus>([
  "published",
  "pending",
  "rejected",
]);
const sql = neon(process.env.DATABASE_URL!);

function getHeader(req: ApiRequest, name: string) {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function isAuthorized(req: ApiRequest) {
  const token = process.env.ADMIN_TOKEN;
  const authorization = getHeader(req, "authorization");

  return Boolean(token && authorization === `Bearer ${token}`);
}

function getRequestUrl(req: ApiRequest) {
  return new URL(req.url || "/", "https://credit-card-blog.vercel.app");
}

async function readBody(req: ApiRequest) {
  if (req.body && typeof req.body === "object") return req.body as AdminBody;
  if (typeof req.body === "string") return JSON.parse(req.body) as AdminBody;

  const decoder = new TextDecoder();
  let rawBody = "";
  for await (const chunk of req) {
    rawBody += decoder.decode(chunk, { stream: true });
  }
  rawBody += decoder.decode();

  return rawBody ? (JSON.parse(rawBody) as AdminBody) : {};
}

function getCommentId(req: ApiRequest) {
  const id = Number(getRequestUrl(req).searchParams.get("id"));
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function getComments(res: ApiResponse) {
  await ensureCommentsTable();
  const comments = await sql`
    SELECT id, post_slug, name, email, message, status, created_at
    FROM comments
    ORDER BY created_at DESC
  `;

  return res.status(200).json({ comments });
}

async function updateComment(req: ApiRequest, res: ApiResponse) {
  const id = getCommentId(req);
  if (!id) return res.status(400).json({ error: "INVALID_COMMENT_ID" });

  let body: AdminBody;
  try {
    body = await readBody(req);
  } catch {
    return res.status(400).json({ error: "INVALID_JSON" });
  }

  const status = typeof body.status === "string" ? body.status : "";
  if (!adminStatuses.has(status as AdminStatus) || status === "pending") {
    return res.status(400).json({ error: "INVALID_STATUS" });
  }

  await ensureCommentsTable();
  await sql`
    UPDATE comments
    SET status = ${status}
    WHERE id = ${id}
  `;

  return res.status(200).json({ ok: true });
}

async function deleteComment(req: ApiRequest, res: ApiResponse) {
  const id = getCommentId(req);
  if (!id) return res.status(400).json({ error: "INVALID_COMMENT_ID" });

  await ensureCommentsTable();
  await sql`
    DELETE FROM comments
    WHERE id = ${id}
  `;

  return res.status(200).json({ ok: true });
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (!isAuthorized(req)) {
    return res.status(401).json({ error: "UNAUTHORIZED" });
  }

  if (req.method === "GET") return getComments(res);
  if (req.method === "PATCH") return updateComment(req, res);
  if (req.method === "DELETE") return deleteComment(req, res);

  return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
}
