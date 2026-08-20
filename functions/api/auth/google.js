import { json, sha256Hex, randomToken } from "../../_lib/utils.js";

const FALLBACK_CLIENT_ID = "529227251585-n19luhp082iea90eau84uulsuh7kn3sb.apps.googleusercontent.com";

export async function onRequestPost({ request, env }) {
    let body;
    try {
          body = await request.json();
    } catch (e) {
          return json({ error: "INVALID_BODY" }, 400);
    }

  const idToken = body && body.id_token;
    if (!idToken) return json({ error: "MISSING_ID_TOKEN" }, 400);

  // 用 Google 官方 tokeninfo 端點驗證這個 ID token 是不是真的、沒過期
  const verifyResp = await fetch(
        "https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(idToken)
      );
    if (!verifyResp.ok) {
          return json({ error: "INVALID_TOKEN" }, 401);
    }
    const payload = await verifyResp.json();

  const clientId = env.GOOGLE_CLIENT_ID || FALLBACK_CLIENT_ID;
    const validIssuer = payload.iss === "https://accounts.google.com" || payload.iss === "accounts.google.com";
    const validAudience = payload.aud === clientId;
    const notExpired = payload.exp && Number(payload.exp) > Math.floor(Date.now() / 1000);

  if (!validIssuer || !validAudience || !notExpired || !payload.sub) {
        return json({ error: "TOKEN_VERIFICATION_FAILED" }, 401);
  }

  const now = Math.floor(Date.now() / 1000);
    let user = await env.DB.prepare("SELECT * FROM users WHERE google_sub = ?").bind(payload.sub).first();

  if (!user) {
        const id = crypto.randomUUID();
        await env.DB.prepare(
                "INSERT INTO users (id, google_sub, email, name, picture, created_at) VALUES (?, ?, ?, ?, ?, ?)"
              )
          .bind(id, payload.sub, payload.email || null, payload.name || null, payload.picture || null, now)
          .run();
        user = { id, google_sub: payload.sub, email: payload.email, name: payload.name, picture: payload.picture };
  } else {
        const newEmail = payload.email || user.email;
        const newName = payload.name || user.name;
        const newPicture = payload.picture || user.picture;
        await env.DB.prepare("UPDATE users SET email = ?, name = ?, picture = ? WHERE id = ?")
          .bind(newEmail, newName, newPicture, user.id)
          .run();
        user.email = newEmail;
        user.name = newName;
        user.picture = newPicture;
  }

  const token = randomToken();
    const tokenHash = await sha256Hex(token);
    const expiresAt = now + 60 * 60 * 24 * 30; // 30 天

  await env.DB.prepare(
        "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)"
      )
      .bind(tokenHash, user.id, now, expiresAt)
      .run();

  return json({
        token,
        user: { id: user.id, email: user.email, name: user.name, picture: user.picture },
  });
}
