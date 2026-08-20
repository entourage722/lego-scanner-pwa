import { json, sha256Hex } from "../../_lib/utils.js";

export async function onRequestPost({ request, env }) {
    const auth = request.headers.get("authorization") || "";
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (match && match[1].trim()) {
          const tokenHash = await sha256Hex(match[1].trim());
          await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
    }
    return json({ ok: true });
}
