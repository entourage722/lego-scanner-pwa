import { json, getSessionUser, mapCollectionRow } from "../../_lib/utils.js";
import { lookupValue } from "../../_lib/priceLookup.js";

export async function onRequestGet({ request, env }) {
  const user = await getSessionUser(request, env);
  if (!user) return json({ error: "UNAUTHORIZED" }, 401);

  const { results } = await env.DB.prepare(
    `SELECT id, item_type, item_ref, name, image_url, extra_json, quantity, condition, bricklink_ref, value_amount, value_currency, value_updated_at, added_at
     FROM collection_items WHERE user_id = ? ORDER BY added_at DESC`
  )
    .bind(user.id)
    .all();

  return json({ items: (results || []).map(mapCollectionRow) });
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
  const condition = body.condition === "used" ? "used" : "new";
  if (!["set", "part", "minifig"].includes(itemType) || !itemRef) {
    return json({ error: "INVALID_ITEM" }, 400);
  }

  const name = body.name || itemRef;
  const imageUrl = body.image_url || null;
  const extraJson = body.extra ? JSON.stringify(body.extra) : null;
  const now = Math.floor(Date.now() / 1000);
  const id = crypto.randomUUID();

  // 加入收藏時順便查一次目前市場價值；查不到的話先留空，之後可以在收藏清單裡手動輸入或重新查詢
  const priceResult = await lookupValue(env, itemType, itemRef);
  const valueAmount = priceResult.ok
    ? (condition === "used" ? priceResult.valueUsed ?? priceResult.valueNew : priceResult.valueNew ?? priceResult.valueUsed)
    : null;
  const valueCurrency = priceResult.ok ? priceResult.currency : null;
  const valueUpdatedAt = priceResult.ok ? now : null;

  await env.DB.prepare(
    `INSERT INTO collection_items (id, user_id, item_type, item_ref, name, image_url, extra_json, quantity, condition, value_amount, value_currency, value_updated_at, added_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, item_type, item_ref, condition)
       DO UPDATE SET quantity = quantity + 1, name = excluded.name, image_url = excluded.image_url, extra_json = excluded.extra_json`
  )
    .bind(id, user.id, itemType, itemRef, name, imageUrl, extraJson, condition, valueAmount, valueCurrency, valueUpdatedAt, now)
    .run();

  const row = await env.DB.prepare(
    `SELECT id, item_type, item_ref, name, image_url, extra_json, quantity, condition, bricklink_ref, value_amount, value_currency, value_updated_at, added_at
     FROM collection_items WHERE user_id = ? AND item_type = ? AND item_ref = ? AND condition = ?`
  )
    .bind(user.id, itemType, itemRef, condition)
    .first();

  return json({ item: mapCollectionRow(row), price_lookup: priceResult.ok ? "ok" : priceResult.reason });
}
