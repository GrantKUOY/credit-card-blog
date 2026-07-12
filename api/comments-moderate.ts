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

type ApiRequest = {
  url?: string;
};

type ApiResponse = {
  status: (code: number) => ApiResponse;
  setHeader: (name: string, value: string) => void;
  end: (body: string) => void;
};

function getRequestUrl(req: ApiRequest) {
  return new URL(req.url || "/", "https://credit-card-blog.vercel.app");
}

function renderPage(title: string, message: string) {
  return `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8" />
<meta name="robots" content="noindex" />
<title>${title}</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:480px;margin:80px auto;padding:0 24px;text-align:center;color:#1a1a1a;}
  h1{font-size:1.25rem;}
  a{color:#2563eb;}
</style></head>
<body><h1>${title}</h1><p>${message}</p><p><a href="/admin/comments">前往留言管理頁</a></p></body></html>`;
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");

  const params = getRequestUrl(req).searchParams;
  const id = Number(params.get("id"));
  const action = params.get("action") as ModerationAction | null;
  const token = params.get("token") || "";

  if (!Number.isInteger(id) || id <= 0 || !action || !actions.has(action)) {
    res.status(400);
    return res.end(renderPage("連結無效", "這個連結的參數不正確。"));
  }

  if (!verifyModerationToken(id, action, token)) {
    res.status(401);
    return res.end(renderPage("連結無效或已過期", "驗證失敗，請改用留言管理頁處理這則留言。"));
  }

  await ensureCommentsTable();

  const rows = await sql`SELECT status FROM comments WHERE id = ${id}`;
  const current = rows[0]?.status as string | undefined;

  if (!current) {
    res.status(404);
    return res.end(renderPage("找不到留言", "這則留言可能已經被刪除。"));
  }

  if (current !== "pending") {
    res.status(200);
    return res.end(
      renderPage(
        "這則留言已經處理過了",
        `目前狀態：${current === "published" ? "已核准公開" : "已拒絕"}。`
      )
    );
  }

  const newStatus = action === "approve" ? "published" : "rejected";
  await sql`UPDATE comments SET status = ${newStatus} WHERE id = ${id}`;

  res.status(200);
  return res.end(
    renderPage(
      action === "approve" ? "✅ 已核准" : "❌ 已拒絕",
      action === "approve" ? "這則留言現在會顯示在文章頁面上。" : "這則留言不會公開顯示。"
    )
  );
}
