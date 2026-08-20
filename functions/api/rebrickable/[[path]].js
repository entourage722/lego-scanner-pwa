// 後端代理：幫大家轉發 Rebrickable API 請求，使用伺服器上設定的共用 API Key
// 這樣一般使用者就不用自己申請、貼上 API Key 了
export async function onRequestGet({ request, env, params }) {
  const keysRaw = env.REBRICKABLE_API_KEYS || env.REBRICKABLE_API_KEY || "";
  const keys = keysRaw
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);

  if (!keys.length) {
    return new Response(
      JSON.stringify({ error: "SERVER_API_KEY_NOT_CONFIGURED" }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }

  const key = keys[Math.floor(Math.random() * keys.length)];

  const url = new URL(request.url);
  const pathParts = Array.isArray(params.path) ? params.path : [params.path].filter(Boolean);
  const path = pathParts.join("/");
  const target = `https://rebrickable.com/api/v3/${path}${url.search}`;

  let upstream;
  try {
    upstream = await fetch(target, {
      headers: { Authorization: `key ${key}` },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "UPSTREAM_FETCH_FAILED" }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }

  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") || "application/json",
      "cache-control": "public, max-age=300",
    },
  });
}
