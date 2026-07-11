import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = path => readFileSync(path, "utf8");

test("comments database setup is documented and uses the approved schema", () => {
  assert.equal(existsSync("scripts/setup-comments-db.mjs"), true);
  assert.equal(existsSync("docs/comments-setup.md"), true);

  const setup = read("scripts/setup-comments-db.mjs");
  assert.match(setup, /CREATE TABLE IF NOT EXISTS comments/);
  assert.match(setup, /post_slug TEXT NOT NULL/);
  assert.match(setup, /email TEXT/);
  assert.match(setup, /status TEXT NOT NULL DEFAULT 'published'/);
  assert.match(setup, /CREATE INDEX IF NOT EXISTS idx_comments_post_slug/);
  assert.match(setup, /@neondatabase\/serverless/);
  assert.match(setup, /DATABASE_URL/);

  const docs = read("docs/comments-setup.md");
  assert.match(docs, /DATABASE_URL/);
  assert.match(docs, /ADMIN_TOKEN/);
});

test("public comments API validates, rate limits, hides email, and sends notification", () => {
  assert.equal(existsSync("api/comments.ts"), true);

  const api = read("api/comments.ts");
  assert.match(api, /GET/);
  assert.match(api, /POST/);
  assert.match(api, /post_slug/);
  assert.match(api, /status = 'published'/);
  assert.match(api, /ORDER BY created_at ASC/);
  assert.match(api, /name, message, created_at/);
  assert.doesNotMatch(api, /SELECT[^;]*email[^;]*FROM comments WHERE post_slug/s);
  assert.match(api, /MAX_MESSAGE_LENGTH = 1000/);
  assert.match(api, /MAX_NAME_LENGTH = 50/);
  assert.match(api, /RATE_LIMIT_WINDOW_MS = 30_000/);
  assert.match(api, /website/);
  assert.match(api, /countLinks/);
  assert.match(api, /pending/);
  assert.match(api, /published/);
  assert.match(api, /CONTACT_TO_EMAIL/);
  assert.match(api, /RESEND_API_KEY/);
  assert.match(api, /\/admin\/comments/);
  assert.match(api, /escapeHtml/);
});

test("article layout includes the public comments island without exposing email", () => {
  const layout = read("src/layouts/PostDetails.astro");

  assert.match(layout, /public-comments/);
  assert.match(layout, /data-post-slug/);
  assert.match(layout, /\/api\/comments\?slug=/);
  assert.match(layout, /還沒有留言，來當第一個吧/);
  assert.match(layout, /請勿留下卡號、ITIN、密碼等敏感資訊，留言會公開顯示/);
  assert.match(layout, /留言含較多連結，將由站方確認後顯示/);
  assert.match(layout, /name="website"/);
  assert.doesNotMatch(layout, /comment\.email/);
});

test("admin comments page and API are protected by ADMIN_TOKEN", () => {
  assert.equal(existsSync("src/pages/admin/comments.astro"), true);
  assert.equal(existsSync("api/comments-admin.ts"), true);

  const page = read("src/pages/admin/comments.astro");
  assert.match(page, /localStorage/);
  assert.match(page, /Authorization/);
  assert.match(page, /Bearer/);
  assert.match(page, /核准/);
  assert.match(page, /拒絕/);
  assert.match(page, /刪除/);

  const api = read("api/comments-admin.ts");
  assert.match(api, /ADMIN_TOKEN/);
  assert.match(api, /status\(401\)/);
  assert.match(api, /GET/);
  assert.match(api, /PATCH/);
  assert.match(api, /DELETE/);
  assert.match(api, /ORDER BY created_at DESC/);
  assert.match(api, /published/);
  assert.match(api, /rejected/);
  assert.match(api, /pending/);
});
