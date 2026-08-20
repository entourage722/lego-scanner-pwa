// 共用工具：呼叫 BrickEconomy API 查詢組合／人偶目前的市場價值（全新／二手）
// 需要在 Cloudflare 環境變數設定 BRICKECONOMY_API_KEY（共用金鑰，大家不用自己申請）。
// BrickEconomy 免費額度每天只有 100 次查詢，所以只在「加入收藏」或使用者按「重新查詢價格」
// 時才呼叫一次，不會在每次打開收藏清單時重複查詢。

const BE_BASE = "https://www.brickeconomy.com/api/v1";

export async function lookupValue(env, itemType, itemRef) {
  const apiKey = (env.BRICKECONOMY_API_KEY || "").trim();
  if (!apiKey) return { ok: false, reason: "NO_KEY" };

  // BrickEconomy 主要收錄「組合」與「人偶」的價格，零件沒有對應的價格資料
  if (itemType !== "set" && itemType !== "minifig") {
    return { ok: false, reason: "UNSUPPORTED_TYPE" };
  }

  const path = itemType === "set" ? `/set/${encodeURIComponent(itemRef)}` : `/minifig/${encodeURIComponent(itemRef)}`;

  let res;
  try {
    res = await fetch(`${BE_BASE}${path}?currency=TWD`, {
      headers: {
        "x-apikey": apiKey,
        "User-Agent": "lego-scanner-pwa (https://github.com/entourage722/lego-scanner-pwa)",
      },
    });
  } catch {
    return { ok: false, reason: "FETCH_FAILED" };
  }

  if (res.status === 429) return { ok: false, reason: "RATE_LIMITED" };
  if (!res.ok) return { ok: false, reason: "HTTP_" + res.status };

  let payload;
  try {
    payload = await res.json();
  } catch {
    return { ok: false, reason: "BAD_JSON" };
  }

  const d = payload.data || payload;
  const valueNew = numOrNull(d.current_value_new);
  const valueUsed = numOrNull(d.current_value_used);
  if (valueNew == null && valueUsed == null) return { ok: false, reason: "NO_VALUE" };

  return { ok: true, valueNew, valueUsed, currency: "TWD" };
}

function numOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}
