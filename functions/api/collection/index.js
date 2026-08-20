import { json, getSessionUser } from "../../_lib/utils.js";

function mapRow(r) {
    return {
          id: r.id,
          item_type: r.item_type,
          item_ref: r.item_ref,
          name: r.name,
          image_url: r.image_url,
          extra: r.extra_json ? JSON.parse(r.extra_json) : null,
          quantity: r.quantity,
          added_at: r.added_at,
    };
}

export async function onRequestGet({ request, env }) {
    const user = await getSessionUser(request, env);
    if (!user) return json({ error: "UNAUTHORIZED" }, 401);

  const { results } = await env.DB.prepare(
        `SELECT id, item_type, item_ref, name, image_url, extra_json, quantity, added_at
             FROM collection_items WHERE user_id = ? ORDER BY added_at DESC`
      )
      .bind(user.id)
      .all();

  return json({ items: (results || []).map(mapRow) });
}

export async function onRequestPost({ request, env }) {
    const user = await getSessionUser(request, env);
    if (!user) return json({ error: "UNAUTHORIZED" }, 401);

  let body;
    try {
          body = await request.json();
    } catch (e) {
          return json({ error: "INVALID_BODY" }, 400);
    }

  const itemType = body.item_type;
    const itemRef = String(body.item_ref || "").trim();
    if (!["set", "part", "minifig"].includes(itemType) || !itemRef) {
          return json({ error: "INVALID_ITEM" }, 400);
    }

  const name = body.name || itemRef;
    const imageUrl = body.image_url || null;
    const extraJson = body.extra ? JSON.stringify(body.extra) : null;
    const now = Math.floor(Date.now() / 1000);
    const id = crypto.randomUUID();

  await env.DB.prepare(
        `INSERT INTO collection_items (id, user_id, item_type, item_ref, name, image_url, extra_json, quantity, added_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
                  ON CONFLICT(user_id, item_type, item_ref)
                       DO UPDATE SET quantity = quantity + 1, name = excluded.name, image_url = excluded.image_url, extra_json = excluded.extra_json`
      )
      .bind(id, user.id, itemType, itemRef, name, imageUrl, extraJson, now)
      .run();

  const row = await env.DB.prepare(
        `SELECT id, item_type, item_ref, name, image_url, extra_json, quantity, added_at
             FROM collection_items WHERE user_id = ? AND item_type = ? AND item_ref = ?`
      )
      .bind(user.id, itemType, itemRef)
      .first();

  return json({ item: mapRow(row) });
}
