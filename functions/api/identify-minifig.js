// 後端代理：把使用者拍的人偶照片送給 Claude 視覺模型辨識，使用伺服器上設定的共用 API Key
// 這樣大家可以共用同一把 Anthropic API Key，不用自己申請、貼上。
const MODEL = "claude-haiku-4-5-20251001";

const PROMPT = `你是樂高（LEGO）人偶（minifigure）辨識專家。請仔細觀察這張照片中的樂高人偶本體（不是包裝、不是說明書），描述牠的外觀特徵（頭部表情、髮型或頭盔、身體/軀幹印刷圖案、腿部顏色與印刷、手持配件等），並盡量推測這是哪一款樂高人偶、屬於哪個系列。

請「只」用以下 JSON 格式回覆，不要加任何其他文字、不要用 markdown code block 包起來：
{
  "description": "外觀特徵的簡短描述（繁體中文，1-2 句話）",
  "guesses": [
    {
      "name": "推測的角色或人偶名稱（越具體越好，例如角色本名）",
      "theme": "所屬樂高系列，例如 Star Wars、City、Harry Potter、Marvel Super Heroes",
      "confidence": "high" | "medium" | "low",
      "query": "拿去資料庫搜尋用的關鍵字（通常是角色名稱）"
    }
  ]
}

guesses 最多列出 3 個最可能的候選，依信心程度排序。如果完全看不出來是哪一款，也請盡量給出系列或角色類型的合理猜測，並把該項的 confidence 設為 "low"。如果照片中根本沒有樂高人偶，guesses 請回傳空陣列 []。`;

export async function onRequestPost({ request, env }) {
  const apiKey = (env.ANTHROPIC_API_KEY || "").trim();
  if (!apiKey) {
    return json({ error: "SERVER_API_KEY_NOT_CONFIGURED" }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "INVALID_BODY" }, 400);
  }

  const imageDataUrl = typeof body.image === "string" ? body.image : "";
  const match = imageDataUrl.match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,([a-zA-Z0-9+/=]+)$/);
  if (!match) {
    return json({ error: "INVALID_IMAGE" }, 400);
  }
  const mediaType = match[1] === "image/jpg" ? "image/jpeg" : match[1];
  const base64Data = match[2];

  let upstream;
  try {
    upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: base64Data } },
              { type: "text", text: PROMPT },
            ],
          },
        ],
      }),
    });
  } catch (err) {
    return json({ error: "UPSTREAM_FETCH_FAILED" }, 502);
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    return json({ error: "UPSTREAM_ERROR", status: upstream.status, detail }, upstream.status === 401 ? 401 : 502);
  }

  const data = await upstream.json();
  const text = Array.isArray(data.content)
    ? data.content.map((block) => block.text || "").join("")
    : "";

  let result = null;
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    result = JSON.parse(jsonMatch ? jsonMatch[0] : text);
  } catch {
    result = null;
  }

  return json({ raw: text, result });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
