import { neon } from "@neondatabase/serverless";
import { ensureCommentsTable } from "./_comments-db.js";
import {
  verifyModerationToken,
  type ModerationAction,
} from "./_comments-moderation.js";

export const config = {
  runtime: "nodejs",
};

const sql = neon(process.env.DATABASE_URL!);
const actions = new Set<ModerationAction>(["approve", "reject"]);

type ApiRequest = AsyncIterable<Uint8Array> & {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
};

type ApiResponse = {
  status: (code: number) => ApiResponse;
  setHeader: (name: string, value: string) => void;
  end: (body: string) => void;
};

function getRequestUrl(req: ApiRequest) {
  return new URL(req.url || "/", "https://credit-card-blog.vercel.app");
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderPage(title: string, bodyHtml: string) {
  return `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8" />
<meta name="robots" content="noindex" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:520px;margin:80px auto;padding:0 24px;color:#1a1a1a;}
  h1{font-size:1.25rem;}
  blockquote{border-left:3px solid #ddd;margin:16px 0;padding:4px 12px;white-space:pre-wrap;color:#444;}
  button{font:inherit;padding:10px 20px;border:0;border-radius:6px;color:#fff;cursor:pointer;margin-right:8px;}
  .approve{background:#16a34a;}
  .reject{background:#dc2626;}
  a{color:#2563eb;}
</style></head>
<body><h1>${title}</h1>${bodyHtml}<p><a href="/admin/comments">前往留言管理頁</a></p></body></html>`;
}

async function readFormBody(req: ApiRequest) {
  if (req.body && typeof req.body === "object") {
    return req.body as Record<string, unknown>;
  }

  const decoder = new TextDecoder();
  let raw = "";
  if (typeof req.body === "string") {
    raw = req.body;
  } else {
    for await (const chunk of req) raw += decoder.decode(chunk, { stream: true });
    raw += decoder.decode();
  }

  return Object.fromEntries(new URLSearchParams(raw));
}

async function loadPendingComment(id: number) {
  await ensureCommentsTable();
  const rows = await sql`SELECT id, name, message, status FROM comments WHERE id = ${id}`;
  return rows[0] as { id: number; name: string; message: string; status: string } | undefined;
}

async function handleConfirmPage(req: ApiRequest, res: ApiResponse) {
  const params = getRequestUrl(req).searchParams;
  const id = Number(params.get("id"));
  const action = params.get("action") as ModerationAction | null;
  const token = params.get("token") || "";

  if (!Number.isInteger(id) || id <= 0 || !action || !actions.has(action)) {
    res.status(400);
    return res.end(renderPage("連結無效", "<p>這個連結的參數不正確。</p>"));
  }

  if (!verifyModerationToken(id, action, token)) {
    res.status(401);
    return res.end(
      renderPage("連結無效或已過期", "<p>驗證失敗，請改用留言管理頁處理這則留言。</p>")
    );
  }

  const comment = await loadPendingComment(id);
  if (!comment) {
    res.status(404);
    return res.end(renderPage("找不到留言", "<p>這則留言可能已經被刪除。</p>"));
  }

  if (comment.status !== "pending") {
    res.status(200);
    return res.end(
      renderPage(
        "這則留言已經處理過了",
        `<p>目前狀態：${comment.status === "published" ? "已核准公開" : "已拒絕"}。</p>`
      )
    );
  }

  const actionLabel = action === "approve" ? "核准" : "拒絕";
  const buttonClass = action === "approve" ? "approve" : "reject";
  res.status(200);
  return res.end(
    renderPage(
      `確認要${actionLabel}這則留言嗎？`,
      `
      <p><strong>${escapeHtml(comment.name)}</strong></p>
      <blockquote>${escapeHtml(comment.message)}</blockquote>
      <form method="POST" action="/api/comments-moderate">
        <input type="hidden" name="id" value="${id}" />
        <input type="hidden" name="action" value="${action}" />
        <input type="hidden" name="token" value="${escapeHtml(token)}" />
        <button type="submit" class="${buttonClass}">確認${actionLabel}</button>
      </form>
      `
    )
  );
}

async function handleAction(req: ApiRequest, res: ApiResponse) {
  const body = await readFormBody(req);
  const id = Number(body.id);
  const action = body.action as ModerationAction | undefined;
  const token = typeof body.token === "string" ? body.token : "";

  if (!Number.isInteger(id) || id <= 0 || !action || !actions.has(action)) {
    res.status(400);
    return res.end(renderPage("連結無效", "<p>這個請求的參數不正確。</p>"));
  }

  if (!verifyModerationToken(id, action, token)) {
    res.status(401);
    return res.end(
      renderPage("驗證失敗", "<p>請改用留言管理頁處理這則留言。</p>")
    );
  }

  const comment = await loadPendingComment(id);
  if (!comment) {
    res.status(404);
    return res.end(renderPage("找不到留言", "<p>這則留言可能已經被刪除。</p>"));
  }

  if (comment.status !== "pending") {
    res.status(200);
    return res.end(
      renderPage(
        "這則留言已經處理過了",
        `<p>目前狀態：${comment.status === "published" ? "已核准公開" : "已拒絕"}。</p>`
      )
    );
  }

  const newStatus = action === "approve" ? "published" : "rejected";
  await sql`UPDATE comments SET status = ${newStatus} WHERE id = ${id}`;

  res.status(200);
  return res.end(
    renderPage(
      action === "approve" ? "✅ 已核准" : "❌ 已拒絕",
      `<p>${action === "approve" ? "這則留言現在會顯示在文章頁面上。" : "這則留言不會公開顯示。"}</p>`
    )
  );
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");

  if (req.method === "GET") return handleConfirmPage(req, res);
  if (req.method === "POST") return handleAction(req, res);

  res.status(405);
  return res.end(renderPage("Method Not Allowed", "<p></p>"));
}
