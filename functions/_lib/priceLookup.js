// 共用工具：呼叫 BrickLink 的 Price Guide API 查詢組合／零件目前的市場價值（全新／二手）
// BrickLink API 完全免費，但需要在 Cloudflare 環境變數設定四個共用金鑰（在
// https://www.bricklink.com/v2/api/register_consumer.page 免費申請）：
//   BRICKLINK_CONSUMER_KEY, BRICKLINK_CONSUMER_SECRET, BRICKLINK_TOKEN_VALUE, BRICKLINK_TOKEN_SECRET
// 注意：BrickLink 的人偶編號跟 Rebrickable 用的 fig-XXXXXX 編號對不起來，所以人偶暫不支援自動查價。

const BL_BASE = "https://api.bricklink.com/api/store/v1";

// BrickLink 目錄用的類型代碼；minifig 不支援（見上方說明）
const TYPE_MAP = { set: "SET", part: "PART" };

export async function lookupValue(env, itemType, itemRef) {
  const blType = TYPE_MAP[itemType];
  if (!blType) return { ok: false, reason: "UNSUPPORTED_TYPE" };

  const creds = {
    consumerKey: (env.BRICKLINK_CONSUMER_KEY || "").trim(),
    consumerSecret: (env.BRICKLINK_CONSUMER_SECRET || "").trim(),
    tokenValue: (env.BRICKLINK_TOKEN_VALUE || "").trim(),
    tokenSecret: (env.BRICKLINK_TOKEN_SECRET || "").trim(),
  };
  if (!creds.consumerKey || !creds.consumerSecret || !creds.tokenValue || !creds.tokenSecret) {
    return { ok: false, reason: "NO_KEY" };
  }

  const no = itemRef.trim();
  const debugLog = [];

  try {
    const [valueNew, valueUsed] = await Promise.all([
      fetchPriceGuide(creds, blType, no, "N", debugLog),
      fetchPriceGuide(creds, blType, no, "U", debugLog),
    ]);
    if (valueNew == null && valueUsed == null) return { ok: false, reason: "NO_VALUE", debug: debugLog };
    return { ok: true, valueNew, valueUsed, currency: "TWD" };
  } catch (err) {
    return {
      ok: false,
      reason: err.message === "RATE_LIMITED" ? "RATE_LIMITED" : "FETCH_FAILED",
      debug: [...debugLog, `error: ${err.message}`],
    };
  }
}

// 先查最近 6 個月的實際成交價（sold），查不到再退而求其次查目前掛賣中的報價（stock）
async function fetchPriceGuide(creds, type, no, newOrUsed, debugLog) {
  for (const guideType of ["sold", "stock"]) {
    const url = `${BL_BASE}/items/${encodeURIComponent(type)}/${encodeURIComponent(no)}/price_guide?guide_type=${guideType}&new_or_used=${newOrUsed}&currency_code=TWD`;
    let res;
    try {
      res = await signedFetch(creds, "GET", url);
    } catch (e) {
      debugLog.push(`${guideType}/${newOrUsed}: fetch threw ${e.message}`);
      continue;
    }
    if (res.status === 429) throw new Error("RATE_LIMITED");
    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      debugLog.push(`${guideType}/${newOrUsed}: HTTP ${res.status} ${bodyText.slice(0, 200)}`);
      continue;
    }
    const payload = await res.json().catch(() => null);
    const d = payload && payload.data;
    const price = d && numOrNull(d.qty_avg_price ?? d.avg_price);
    if (price != null) return price;
    debugLog.push(`${guideType}/${newOrUsed}: HTTP 200 but no usable price (data=${JSON.stringify(d)})`);
  }
  return null;
}

function numOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ---------- OAuth 1.0a 簽章（BrickLink API 要求，兩腳式：金鑰已經是核准過的 access token） ----------
async function signedFetch(creds, method, url) {
  const authHeader = await buildOAuthHeader(creds, method, url);
  return fetch(url, { method, headers: { Authorization: authHeader } });
}

async function buildOAuthHeader(creds, method, url) {
  const u = new URL(url);
  const baseUrl = `${u.origin}${u.pathname}`;

  const oauthParams = {
    oauth_consumer_key: creds.consumerKey,
    oauth_token: creds.tokenValue,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_nonce: crypto.randomUUID().replace(/-/g, ""),
    oauth_version: "1.0",
  };

  const allParams = { ...oauthParams };
  u.searchParams.forEach((value, key) => {
    allParams[key] = value;
  });

  const paramString = Object.keys(allParams)
    .sort()
    .map((k) => `${oauthEncode(k)}=${oauthEncode(allParams[k])}`)
    .join("&");

  const baseString = [method.toUpperCase(), oauthEncode(baseUrl), oauthEncode(paramString)].join("&");
  const signingKey = `${oauthEncode(creds.consumerSecret)}&${oauthEncode(creds.tokenSecret)}`;
  const signature = await hmacSha1Base64(signingKey, baseString);

  const headerParams = { ...oauthParams, oauth_signature: signature };
  const headerStr = Object.keys(headerParams)
    .map((k) => `${oauthEncode(k)}="${oauthEncode(headerParams[k])}"`)
    .join(", ");
  return `OAuth ${headerStr}`;
}

// OAuth 規範要求的 percent-encoding 比 encodeURIComponent 多跳脫 ! * ' ( )
function oauthEncode(str) {
  return encodeURIComponent(str).replace(/[!*'()]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

async function hmacSha1Base64(key, message) {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sigBuf = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sigBuf)));
}
