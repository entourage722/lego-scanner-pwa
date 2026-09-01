import { json } from "../../_lib/utils.js";

// 後臺統計 API：用固定密碼保護（Cloudflare 環境變數 ADMIN_PASSWORD），不使用一般使用者登入系統。
// GET /api/admin/stats            -> 全站總覽統計
// GET /api/admin/stats?user_id=X  -> 該使用者的收藏明細

export async function onRequestGet({ request, env }) {
  const configured = (env.ADMIN_PASSWORD || "").trim();
  if (!configured) return json({ error: "ADMIN_NOT_CONFIGURED" }, 500);

  const supplied = (request.headers.get("x-admin-password") || "").trim();
  if (!supplied || supplied !== configured) {
    return json({ error: "UNAUTHORIZED" }, 401);
  }

  const url = new URL(request.url);
  const userId = url.searchParams.get("user_id");

  if (userId) {
    return json(await getUserDetail(env, userId));
  }
  return json(await getOverview(env));
}

async function getOverview(env) {
  const [totals, condition, ranking, users] = await Promise.all([
    env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM users) AS total_users,
         (SELECT COUNT(DISTINCT user_id) FROM collection_items) AS active_users,
         (SELECT COUNT(*) FROM collection_items) AS total_entries,
         (SELECT COALESCE(SUM(quantity), 0) FROM collection_items) AS total_quantity,
         (SELECT COALESCE(SUM(value_amount * quantity), 0) FROM collection_items WHERE value_amount IS NOT NULL) AS total_value
      `
    ).first(),
    env.DB.prepare(
      `SELECT condition, COALESCE(SUM(quantity), 0) AS qty, COUNT(*) AS entries
       FROM collection_items GROUP BY condition`
    ).all(),
    env.DB.prepare(
      `SELECT item_type, item_ref, name, image_url,
              SUM(quantity) AS total_qty, COUNT(DISTINCT user_id) AS owners
       FROM collection_items
       GROUP BY item_type, item_ref
       ORDER BY total_qty DESC
       LIMIT 15`
    ).all(),
    env.DB.prepare(
      `SELECT u.id, u.name, u.email, u.picture,
              COALESCE(SUM(ci.quantity), 0) AS total_qty,
              COUNT(ci.id) AS entry_count,
              COALESCE(SUM(ci.value_amount * ci.quantity), 0) AS total_value
       FROM users u
       LEFT JOIN collection_items ci ON ci.user_id = u.id
       GROUP BY u.id
       ORDER BY total_qty DESC, total_value DESC`
    ).all(),
  ]);

  return {
    totals,
    condition: condition.results || [],
    ranking: ranking.results || [],
    users: users.results || [],
  };
}

async function getUserDetail(env, userId) {
  const user = await env.DB.prepare(`SELECT id, name, email, picture FROM users WHERE id = ?`).bind(userId).first();
  if (!user) return { error: "USER_NOT_FOUND" };

  const items = await env.DB.prepare(
    `SELECT item_type, item_ref, name, image_url, quantity, condition, value_amount, value_currency, added_at
     FROM collection_items WHERE user_id = ? ORDER BY added_at DESC`
  )
    .bind(userId)
    .all();

  return { user, items: items.results || [] };
}
