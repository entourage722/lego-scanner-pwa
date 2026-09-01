import { json, getSessionUser, mapCollectionRow } from "../../_lib/utils.js";
import { lookupValue } from "../../_lib/priceLookup.js";

export async function onRequestDelete({ request, env, params }) {
  const user = await getSessionUser(request, env);
  if (!user) return json({ error: "UNAUTHORIZED" }, 401);

  const id = params.id;
  await env.DB.prepare("DELETE FROM collection_items WHERE id = ? AND user_id = ?")
    .bind(id, user.id)
    .run();

  return json({ ok: true });
}

// 編輯收藏項目：可修改數量／手動價格、要求重新查詢市場價格、或修改新舊狀態
export async function onRequestPatch({ request, env, params }) {
  const user = await getSessionUser(request, env);
  if (!user) return json({ error: "UNAUTHORIZED" }, 401);

  const id = params.id;
  const row = await env.DB.prepare(`SELECT * FROM collection_items WHERE id = ? AND user_id = ?`)
    .bind(id, user.id)
    .first();
  if (!row) return json({ error: "NOT_FOUND" }, 404);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "INVALID_BODY" }, 400);
  }

  const now = Math.floor(Date.now() / 1000);

  if (body.refresh_price) {
    const priceResult = await lookupValue(env, row.item_type, row.item_ref);
    if (!priceResult.ok) {
      return json({ error: "PRICE_LOOKUP_FAILED", reason: priceResult.reason, debug: priceResult.debug }, 502);
    }
    const valueAmount =
      row.condition === "used" ? priceResult.valueUsed ?? priceResult.valueNew : priceResult.valueNew ?? priceResult.valueUsed;
    await env.DB.prepare(`UPDATE collection_items SET value_amount = ?, value_currency = ?, value_updated_at = ? WHERE id = ?`)
      .bind(valueAmount, priceResult.currency, now, id)
      .run();
  }

  if (body.quantity != null) {
    const qty = Math.max(1, Math.floor(Number(body.quantity)) || 1);
    await env.DB.prepare(`UPDATE collection_items SET quantity = ? WHERE id = ?`).bind(qty, id).run();
  }

  if (body.value_amount != null) {
    const val = Number(body.value_amount);
    if (Number.isFinite(val) && val >= 0) {
      await env.DB.prepare(`UPDATE collection_items SET value_amount = ?, value_currency = ?, value_updated_at = ? WHERE id = ?`)
        .bind(val, row.value_currency || "TWD", now, id)
        .run();
    }
  }

  if (body.condition && (body.condition === "new" || body.condition === "used") && body.condition !== row.condition) {
    // 换成另一個狀態時，如果同一件物品已經有那個狀態的紀錄，就合併數量，否則直接改狀態
    const existing = await env.DB.prepare(
      `SELECT * FROM collection_items WHERE user_id = ? AND item_type = ? AND item_ref = ? AND condition = ? AND id != ?`
    )
      .bind(user.id, row.item_type, row.item_ref, body.condition, id)
      .first();
    if (existing) {
      await env.DB.prepare(`UPDATE collection_items SET quantity = quantity + ? WHERE id = ?`)
        .bind(row.quantity, existing.id)
        .run();
      await env.DB.prepare(`DELETE FROM collection_items WHERE id = ?`).bind(id).run();
      const merged = await env.DB.prepare(`SELECT * FROM collection_items WHERE id = ?`).bind(existing.id).first();
      return json({ item: mapCollectionRow(merged), merged: true });
    }
    await env.DB.prepare(`UPDATE collection_items SET condition = ? WHERE id = ?`).bind(body.condition, id).run();
  }

  const updated = await env.DB.prepare(`SELECT * FROM collection_items WHERE id = ?`).bind(id).first();
  return json({ item: mapCollectionRow(updated) });
}
