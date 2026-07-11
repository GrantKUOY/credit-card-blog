import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

let setupPromise: Promise<void> | null = null;

export function ensureCommentsTable() {
  setupPromise ??= (async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS comments (
        id SERIAL PRIMARY KEY,
        post_slug TEXT NOT NULL,
        name TEXT NOT NULL,
        email TEXT,
        message TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'published',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_comments_post_slug
      ON comments(post_slug)
    `;
  })();

  return setupPromise;
}
