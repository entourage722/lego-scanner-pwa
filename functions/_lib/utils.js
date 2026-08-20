// 共用工具函式（檔名以底線開頭，Cloudflare Pages Functions 不會把它當成路由）

export function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
          status,
          headers: { "content-type": "application/json; charset=utf-8" },
    });
}

export async function sha256Hex(text) {
    const enc = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest("SHA-256", enc);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomToken() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// 從 Authorization: Bearer TOKEN 解析出目前登入的使用者，找不到或過期回傳 null
export async function getSessionUser(request, env) {
    const auth = request.headers.get("authorization") || "";
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (!match) return null;
    const token = match[1].trim();
    if (!token) return null;
    const tokenHash = await sha256Hex(token);
    const now = Math.floor(Date.now() / 1000);
    const row = await env.DB.prepare(
          `SELECT u.id as id, u.email as email, u.name as name, u.picture as picture, s.expires_at as expires_at
               FROM sessions s JOIN users u ON u.id = s.user_id
                    WHERE s.token_hash = ?`
        )
      .bind(tokenHash)
      .first();
    if (!row) return null;
    if (row.expires_at < now) return null;
    return { id: row.id, email: row.email, name: row.name, picture: row.picture };
}
