import { json, getSessionUser } from "../../_lib/utils.js";

export async function onRequestDelete({ request, env, params }) {
    const user = await getSessionUser(request, env);
    if (!user) return json({ error: "UNAUTHORIZED" }, 401);

  const id = params.id;
    await env.DB.prepare("DELETE FROM collection_items WHERE id = ? AND user_id = ?")
      .bind(id, user.id)
      .run();

  return json({ ok: true });
}
