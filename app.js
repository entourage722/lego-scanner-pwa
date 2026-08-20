// ===== 積木掃描小幫手 =====
// Rebrickable API 直接從瀏覽器呼叫；API Key 只存在 localStorage（僅限本機瀏覽器）

const API_BASE = "/api/rebrickable";
const LS_KEY_HISTORY = "rb_history";
const LS_KEY_SESSION = "rb_session_token";
const LS_KEY_USER = "rb_user";
const GOOGLE_CLIENT_ID = "529227251585-n19luhp082iea90eau84uulsuh7kn3sb.apps.googleusercontent.com";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ---------- 導覽 ----------
const viewStack = ["home"];
let currentReviewMode = "set"; // 'set' | 'part'
let currentManualMode = "set";
let pendingScanSourceMode = "set"; // which mode to default review screen to

function showView(name, { pushHistory = true } = {}) {
  $$(".view").forEach((v) => v.classList.remove("active"));
  const el = $("#view-" + name);
  if (el) el.classList.add("active");

  const titles = {
    home: "積木掃描小幫手",
    "scan-ocr": "掃描組合盒",
    "scan-qr": "掃描零件 / QR",
    review: "確認辨識結果",
    result: "查詢結果",
    settings: "設定",
    collection: "我的收藏",
  };
  $("#pageTitle").textContent = titles[name] || "積木掃描小幫手";
  $("#backBtn").classList.toggle("hidden", name === "home");

  // stop camera streams when leaving their views
  if (name !== "scan-ocr") stopOcrCamera();
  if (name !== "scan-qr") stopQrScanner();

  if (name === "scan-ocr") startOcrCamera();
  if (name === "scan-qr") startQrScanner();

  if (pushHistory) {
    if (viewStack[viewStack.length - 1] !== name) viewStack.push(name);
  }
}

function goBack() {
  if (viewStack.length > 1) {
    viewStack.pop();
    const prev = viewStack[viewStack.length - 1];
    showView(prev, { pushHistory: false });
  } else {
    showView("home", { pushHistory: false });
  }
}

$("#backBtn").addEventListener("click", goBack);
$("#settingsBtn").addEventListener("click", () => {
  showView("settings");
});

$$("[data-goto]").forEach((btn) => {
  btn.addEventListener("click", () => {
    pendingScanSourceMode = btn.dataset.goto === "scan-ocr" ? "set" : "part";
    showView(btn.dataset.goto);
  });
});

// ---------- Toast ----------
let toastTimer;
function toast(msg, type = "") {
  const el = $("#toast");
  el.textContent = msg;
  el.className = "toast" + (type ? " " + type : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 3200);
}

// ---------- 帳號 / Google 登入 ----------
function getSessionToken() {
  return localStorage.getItem(LS_KEY_SESSION) || "";
}
function getCachedUser() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY_USER) || "null");
  } catch {
    return null;
  }
}
function isLoggedIn() {
  return !!getSessionToken();
}
function setSession(token, user) {
  localStorage.setItem(LS_KEY_SESSION, token);
  localStorage.setItem(LS_KEY_USER, JSON.stringify(user));
  renderAccountUI();
}
function clearSession() {
  localStorage.removeItem(LS_KEY_SESSION);
  localStorage.removeItem(LS_KEY_USER);
  renderAccountUI();
}

async function apiFetch(path, opts = {}) {
  const token = getSessionToken();
  const headers = Object.assign(
    {},
    opts.headers || {},
    token ? { Authorization: "Bearer " + token } : {}
  );
  const res = await fetch(path, { ...opts, headers });
  if (res.status === 401) clearSession();
  return res;
}

function renderAccountUI() {
  const user = getCachedUser();
  const signedOut = $("#accSignedOut");
  const signedIn = $("#accSignedIn");
  if (!signedOut || !signedIn) return;
  if (user && isLoggedIn()) {
    signedOut.classList.add("hidden");
    signedIn.classList.remove("hidden");
    $("#accName").textContent = user.name || user.email || "已登入";
    const avatar = $("#accAvatar");
    if (user.picture) {
      avatar.src = user.picture;
      avatar.style.display = "";
    } else {
      avatar.style.display = "none";
    }
  } else {
    signedOut.classList.remove("hidden");
    signedIn.classList.add("hidden");
  }
}

function initGoogleSignInWhenReady(retries = 20) {
  if (window.google && google.accounts && google.accounts.id) {
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleGoogleCredential,
      locale: "zh-TW",
    });
    const container = $("#googleSignInBtn");
    if (container) {
      google.accounts.id.renderButton(container, {
        type: "standard",
        theme: "filled_blue",
        size: "large",
        shape: "pill",
        text: "signin_with",
        locale: "zh-TW",
        width: 260,
      });
    }
  } else if (retries > 0) {
    setTimeout(() => initGoogleSignInWhenReady(retries - 1), 250);
  }
}

async function handleGoogleCredential(response) {
  try {
    const res = await fetch("/api/auth/google", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id_token: response.credential }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "LOGIN_FAILED");
    setSession(data.token, data.user);
    toast("登入成功，歡迎 " + (data.user.name || "回來"));
  } catch (err) {
    toast("登入失敗，請再試一次", "error");
  }
}

async function logout() {
  try {
    await apiFetch("/api/auth/logout", { method: "POST" });
  } catch {}
  clearSession();
  toast("已登出");
  if (viewStack[viewStack.length - 1] === "collection") goBack();
}
$("#accLogoutBtn").addEventListener("click", logout);

// ---------- 我的收藏 ----------
const COLLECTION_TYPE_LABEL = { set: "組合", part: "零件", minifig: "人偶" };

$("#goCollectionBtn").addEventListener("click", () => {
  showView("collection");
  loadCollection();
});
$("#goLoginFromCollectionBtn").addEventListener("click", () => showView("home"));

async function loadCollection() {
  const listEl = $("#collectionList");
  const emptyEl = $("#collectionEmptyHint");
  const signedOutEl = $("#collectionSignedOutHint");
  const contentEl = $("#collectionContent");
  if (!isLoggedIn()) {
    signedOutEl.classList.remove("hidden");
    contentEl.classList.add("hidden");
    return;
  }
  signedOutEl.classList.add("hidden");
  contentEl.classList.remove("hidden");
  emptyEl.classList.add("hidden");
  listEl.innerHTML = `<div class="state-msg"><div class="big">⏳</div>載入中…</div>`;
  try {
    const res = await apiFetch("/api/collection");
    if (!res.ok) throw new Error("LOAD_FAILED");
    const data = await res.json();
    renderCollectionList(data.items || []);
  } catch (err) {
    listEl.innerHTML = `<div class="state-msg"><div class="big">⚠️</div>收藏清單載入失敗，請再試一次</div>`;
  }
}

function renderCollectionList(items) {
  const listEl = $("#collectionList");
  const emptyEl = $("#collectionEmptyHint");
  if (!items.length) {
    listEl.innerHTML = "";
    emptyEl.classList.remove("hidden");
    return;
  }
  emptyEl.classList.add("hidden");
  listEl.innerHTML = items
    .map(
      (it) => `
    <div class="collection-item" data-id="${it.id}" data-type="${it.item_type}" data-ref="${escapeHtml(it.item_ref)}">
      ${it.image_url ? `<img src="${it.image_url}" alt="" />` : `<div style="width:44px;height:44px;background:var(--bg-elevated);border-radius:8px"></div>`}
      <div class="ci-text">
        <div class="ci-title">${escapeHtml(it.name || it.item_ref)}</div>
        <div class="ci-sub">${COLLECTION_TYPE_LABEL[it.item_type] || it.item_type} ・ ${escapeHtml(it.item_ref)}</div>
      </div>
      <span class="ci-qty">×${it.quantity}</span>
      <button class="ci-remove" data-remove-id="${it.id}" aria-label="移除">🗑</button>
    </div>`
    )
    .join("");
  $$("#collectionList .collection-item").forEach((row) => {
    row.addEventListener("click", (e) => {
      if (e.target.closest(".ci-remove")) return;
      runLookup(row.dataset.type, row.dataset.ref);
    });
  });
  $$("#collectionList .ci-remove").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = btn.dataset.removeId;
      btn.disabled = true;
      try {
        const res = await apiFetch("/api/collection/" + encodeURIComponent(id), { method: "DELETE" });
        if (!res.ok) throw new Error("REMOVE_FAILED");
        toast("已從收藏移除");
        loadCollection();
      } catch (err) {
        toast("移除失敗，請再試一次", "error");
        btn.disabled = false;
      }
    });
  });
}

async function addToCollection(itemType, itemRef, name, imageUrl) {
  if (!isLoggedIn()) {
    toast("請先在首頁登入 Google 帳號才能收藏", "error");
    showView("home");
    return;
  }
  try {
    const res = await apiFetch("/api/collection", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ item_type: itemType, item_ref: itemRef, name, image_url: imageUrl }),
    });
    if (!res.ok) throw new Error("ADD_FAILED");
    toast("已加入收藏 ⭐");
  } catch (err) {
    toast("加入收藏失敗，請再試一次", "error");
  }
}

// ---------- Manual search ----------
$("#manualModeSeg").addEventListener("click", (e) => {
  const btn = e.target.closest(".seg-btn");
  if (!btn) return;
  $$("#manualModeSeg .seg-btn").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  currentManualMode = btn.dataset.mode;
});

$("#manualSearchBtn").addEventListener("click", () => {
  const val = $("#manualInput").value.trim();
  if (!val) {
    toast("請輸入編號");
    return;
  }
  runLookup(currentManualMode, val);
});
$("#manualInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("#manualSearchBtn").click();
});

// ---------- Review screen (after OCR / QR) ----------
$("#reviewModeSeg").addEventListener("click", (e) => {
  const btn = e.target.closest(".seg-btn");
  if (!btn) return;
  $$("#reviewModeSeg .seg-btn").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  currentReviewMode = btn.dataset.mode;
});

const REVIEW_HINTS = {
  set: "會用編號查詢組合，例如 75192 或 75192-1",
  part: "會用零件編號查詢，例如 3001",
  minifig: "可輸入人偶編號（例如 fig-000001）或角色名稱（例如 Batman）",
};
function updateReviewHint() {
  const el = $("#reviewHint");
  if (el) el.textContent = REVIEW_HINTS[currentReviewMode] || "";
}
$("#reviewModeSeg").addEventListener("click", updateReviewHint);

$("#reviewSearchBtn").addEventListener("click", () => {
  const val = $("#reviewInput").value.trim();
  if (!val) {
    toast("辨識結果是空的，請重新掃描或手動輸入");
    return;
  }
  runLookup(currentReviewMode, val);
});

function goToReview(text, mode) {
  currentReviewMode = mode;
  $$("#reviewModeSeg .seg-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.mode === mode)
  );
  $("#reviewInput").value = text;
  updateReviewHint();
  showView("review");
}

// ============================================================
// OCR (組合編號) — Tesseract.js
// ============================================================
let ocrStream = null;

async function startOcrCamera() {
  try {
    ocrStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 960 } },
      audio: false,
    });
    $("#ocrVideo").srcObject = ocrStream;
  } catch (err) {
    toast("無法開啟相機：" + err.message, "error");
  }
}

function stopOcrCamera() {
  if (ocrStream) {
    ocrStream.getTracks().forEach((t) => t.stop());
    ocrStream = null;
  }
}

$("#ocrCaptureBtn").addEventListener("click", async () => {
  const video = $("#ocrVideo");
  if (!video.videoWidth) {
    toast("相機還沒準備好，稍等一下再試");
    return;
  }
  const canvas = $("#ocrCanvas");
  // Crop exactly the area shown inside the on-screen guide frame. The video
  // element uses object-fit:cover, so its native pixel size (video.videoWidth/
  // videoHeight) usually has a different aspect ratio than what's displayed —
  // mapping the guide frame's on-screen rect through the actual cover scale
  // (instead of assuming raw-frame percentages) keeps OCR looking exactly
  // where the user aimed the camera.
  const guideEl = document.querySelector(".frame-guide");
  const videoRect = video.getBoundingClientRect();
  const guideRect = guideEl.getBoundingClientRect();
  const nativeW = video.videoWidth;
  const nativeH = video.videoHeight;
  const scale = Math.max(videoRect.width / nativeW, videoRect.height / nativeH) || 1;
  const offsetX = (nativeW - videoRect.width / scale) / 2;
  const offsetY = (nativeH - videoRect.height / scale) / 2;
  const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
  const cropX = clamp(offsetX + (guideRect.left - videoRect.left) / scale, 0, nativeW);
  const cropY = clamp(offsetY + (guideRect.top - videoRect.top) / scale, 0, nativeH);
  const cropW = clamp(guideRect.width / scale, 1, nativeW - cropX);
  const cropH = clamp(guideRect.height / scale, 1, nativeH - cropY);

  // Upscale the crop a bit — small/thin digits recognize far more reliably
  // when Tesseract has more pixels to work with.
  const UPSCALE = 2;
  canvas.width = cropW * UPSCALE;
  canvas.height = cropH * UPSCALE;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, canvas.width, canvas.height);

  toast("辨識中，請稍候…");
  try {
    const { data } = await Tesseract.recognize(canvas, "eng", {
      tessedit_char_whitelist: "0123456789-",
      tessedit_pageseg_mode: "7", // single text line — matches the thin guide-frame strip
    });
    const raw = (data.text || "").trim();
    // LEGO set numbers are 4-5 digits (the age "8+", short model-variant
    // numbers, and the piece count printed further down the box are 1-3
    // digits, so preferring a 4-5 digit run first avoids picking those up).
    const match =
      raw.match(/\d{4,5}(-\d{1,2})?/) || raw.match(/\d{3,7}(-\d{1,2})?/);
    const guess = match ? match[0] : raw.replace(/\s+/g, "");
    goToReview(guess, "set");
  } catch (err) {
    toast("辨識失敗：" + err.message, "error");
  }
});

// ============================================================
// QR / Barcode — html5-qrcode
// ============================================================
let qrScanner = null;
let qrRunning = false;

async function startQrScanner() {
  if (qrRunning) return;
  try {
    qrScanner = new Html5Qrcode("qrReader");
    qrRunning = true;
    await qrScanner.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 240, height: 240 } },
      (decodedText) => onQrDetected(decodedText),
      () => {} // ignore per-frame scan failures
    );
  } catch (err) {
    qrRunning = false;
    toast("無法啟動掃描器：" + err.message, "error");
  }
}

function stopQrScanner() {
  if (qrScanner && qrRunning) {
    qrRunning = false;
    qrScanner.stop().then(() => qrScanner.clear()).catch(() => {});
  }
  qrScanner = null;
}

function onQrDetected(text) {
  if (!qrRunning) return; // avoid double trigger
  stopQrScanner();
  // Try to pull a plausible LEGO number out of the text (handles URLs too)
  let guess = text.trim();
  const numMatch = text.match(/(\d{3,7})(-\d{1,2})?(?!.*\d)/);
  if (numMatch) guess = numMatch[0];
  goToReview(guess, "part");
}

// ============================================================
// Rebrickable API calls
// ============================================================
async function rbFetch(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    const err = new Error("HTTP_" + res.status);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

function normalizeSetNum(raw) {
  raw = raw.trim();
  return raw.includes("-") ? raw : `${raw}-1`;
}

async function runLookup(mode, rawQuery) {
  showResultLoading();
  showView("result");
  try {
    if (mode === "set") {
      await lookupSet(rawQuery);
    } else if (mode === "minifig") {
      await lookupMinifig(rawQuery);
    } else {
      await lookupPart(rawQuery);
    }
  } catch (err) {
    showResultError(err);
  }
}

async function lookupSet(rawQuery) {
  const candidate = normalizeSetNum(rawQuery);
  try {
    const set = await rbFetch(`/lego/sets/${encodeURIComponent(candidate)}/`);
    await renderSetResult(set);
    saveHistory({ type: "set", num: set.set_num, name: set.name, image: set.set_img_url });
    return;
  } catch (err) {
    if (err.status !== 404) throw err;
  }
  // fallback: search
  const search = await rbFetch(`/lego/sets/?search=${encodeURIComponent(rawQuery)}&page_size=10`);
  if (search.results && search.results.length) {
    renderPicker(
      search.results.map((s) => ({
        label: `${s.set_num} — ${s.name} (${s.year})`,
        img: s.set_img_url,
        onPick: async () => {
          showResultLoading();
          const full = await rbFetch(`/lego/sets/${encodeURIComponent(s.set_num)}/`);
          await renderSetResult(full);
          saveHistory({ type: "set", num: full.set_num, name: full.name, image: full.set_img_url });
        },
      })),
      `找不到「${rawQuery}」的完整組合，這是相近的搜尋結果：`
    );
  } else {
    showResultNotFound(rawQuery);
  }
}

async function lookupPart(rawQuery) {
  try {
    const part = await rbFetch(`/lego/parts/${encodeURIComponent(rawQuery)}/`);
    await renderPartResult(part);
    saveHistory({ type: "part", num: part.part_num, name: part.name, image: part.part_img_url });
    return;
  } catch (err) {
    if (err.status !== 404) throw err;
  }
  const search = await rbFetch(`/lego/parts/?search=${encodeURIComponent(rawQuery)}&page_size=10`);
  if (search.results && search.results.length) {
    renderPicker(
      search.results.map((p) => ({
        label: `${p.part_num} — ${p.name}`,
        img: p.part_img_url,
        onPick: async () => {
          showResultLoading();
          const full = await rbFetch(`/lego/parts/${encodeURIComponent(p.part_num)}/`);
          await renderPartResult(full);
          saveHistory({ type: "part", num: full.part_num, name: full.name, image: full.part_img_url });
        },
      })),
      `找不到「${rawQuery}」的完整零件，這是相近的搜尋結果：`
    );
  } else {
    showResultNotFound(rawQuery);
  }
}

async function lookupMinifig(rawQuery) {
  const candidate = rawQuery.trim();
  // direct fig_num lookup only makes sense if it already looks like "fig-000001"
  if (/^fig-\d+$/i.test(candidate)) {
    try {
      const fig = await rbFetch(`/lego/minifigs/${encodeURIComponent(candidate)}/`);
      await renderMinifigResult(fig);
      saveHistory({ type: "minifig", num: fig.set_num, name: fig.name, image: fig.set_img_url });
      return;
    } catch (err) {
      if (err.status !== 404) throw err;
    }
  }
  // otherwise search by number or name text
  const search = await rbFetch(`/lego/minifigs/?search=${encodeURIComponent(candidate)}&page_size=15`);
  if (search.results && search.results.length) {
    renderPicker(
      search.results.map((f) => ({
        label: `${f.set_num} — ${f.name}`,
        img: f.set_img_url,
        onPick: async () => {
          showResultLoading();
          const full = await rbFetch(`/lego/minifigs/${encodeURIComponent(f.set_num)}/`);
          await renderMinifigResult(full);
          saveHistory({ type: "minifig", num: full.set_num, name: full.name, image: full.set_img_url });
        },
      })),
      `「${rawQuery}」的搜尋結果：`
    );
  } else {
    showResultNotFound(rawQuery);
  }
}

// ---------- Result rendering ----------
function showResultLoading() {
  $("#resultContent").innerHTML = `
    <div class="state-msg">
      <div class="big">⏳</div>
      查詢中，請稍候…
    </div>`;
}

function showResultNotFound(q) {
  $("#resultContent").innerHTML = `
    <div class="state-msg">
      <div class="big">🔍</div>
      找不到「${escapeHtml(q)}」<br/>試試看修正編號，或直接到 Rebrickable 網站搜尋
      <div><button class="pill-btn retry-btn" onclick="goBack()">重新輸入</button></div>
    </div>`;
}

function showResultError(err) {
  const msg =
    err.status === 401 || err.status === 403
      ? "伺服器暫時無法查詢，請稍後再試"
      : "查詢失敗，請檢查網路連線後再試 (" + err.message + ")";
  $("#resultContent").innerHTML = `
    <div class="state-msg">
      <div class="big">⚠️</div>
      ${escapeHtml(msg)}
      <div><button class="pill-btn retry-btn" onclick="goBack()">返回</button></div>
    </div>`;
}

function renderPicker(items, headline) {
  const rows = items
    .map(
      (it, i) => `
      <div class="part-row" data-idx="${i}" style="cursor:pointer">
        ${it.img ? `<img src="${it.img}" alt="" />` : ""}
        <div class="pr-text">${escapeHtml(it.label)}</div>
      </div>`
    )
    .join("");
  $("#resultContent").innerHTML = `
    <div class="result-card">
      <p class="muted">${escapeHtml(headline)}</p>
      <div class="parts-list">${rows}</div>
    </div>`;
  $$("#resultContent .part-row").forEach((row) => {
    row.addEventListener("click", async () => {
      showResultLoading();
      try {
        await items[+row.dataset.idx].onPick();
      } catch (err) {
        showResultError(err);
      }
    });
  });
}

async function renderSetResult(set) {
  const rebrickableUrl = `https://rebrickable.com/sets/${set.set_num}/`;
  $("#resultContent").innerHTML = `
    <div class="result-card">
      ${set.set_img_url ? `<img class="result-img" src="${set.set_img_url}" alt="${escapeHtml(set.name)}" />` : ""}
      <div class="result-title">${escapeHtml(set.name)}</div>
      <div class="result-sub">組合編號 ${set.set_num} ・ ${set.year} 年 ・ ${escapeHtml(set.theme_name || "")}</div>
      <div class="result-grid">
        <div class="stat-box"><div class="num">${set.num_parts}</div><div class="lbl">零件數</div></div>
        <div class="stat-box"><div class="num">${set.year}</div><div class="lbl">發行年份</div></div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="pill-btn full" id="loadSetPartsBtn">載入零件清單</button>
        <button class="pill-btn full" id="loadSetMinifigsBtn">查看人偶</button>
      </div>
      <button class="fav-btn" id="favBtn">⭐ 加入收藏</button>
      <p style="margin-top:12px"><a href="${rebrickableUrl}" target="_blank" rel="noopener" style="color:var(--accent)">在 Rebrickable 網站上查看完整資料 →</a></p>
      <div id="setMinifigsContainer"></div>
      <div id="setPartsContainer"></div>
    </div>`;

  $("#favBtn").addEventListener("click", () =>
    addToCollection("set", set.set_num, set.name, set.set_img_url)
  );

  $("#loadSetMinifigsBtn").addEventListener("click", async (e) => {
    e.target.disabled = true;
    e.target.textContent = "載入中…";
    try {
      const figs = await rbFetch(`/lego/sets/${encodeURIComponent(set.set_num)}/minifigs/?page_size=30`);
      if (!figs.results.length) {
        $("#setMinifigsContainer").innerHTML = `<p class="muted" style="margin-top:14px">這個組合沒有登記人偶資料。</p>`;
        e.target.remove();
        return;
      }
      const rows = figs.results
        .map(
          (f, i) => `
        <div class="part-row" data-idx="${i}" style="cursor:pointer">
          ${f.set_img_url ? `<img src="${f.set_img_url}" alt="" />` : ""}
          <div class="pr-text">${escapeHtml(f.name)}<br/><span class="muted">${f.set_num}</span></div>
          <div class="pr-qty">×${f.quantity}</div>
        </div>`
        )
        .join("");
      $("#setMinifigsContainer").innerHTML = `
        <p class="muted" style="margin-top:14px">這個組合包含 ${figs.results.length} 款人偶（點擊查看詳情）：</p>
        <div class="parts-list">${rows}</div>`;
      $$("#setMinifigsContainer .part-row").forEach((row) => {
        row.addEventListener("click", async () => {
          const f = figs.results[+row.dataset.idx];
          showResultLoading();
          try {
            const full = await rbFetch(`/lego/minifigs/${encodeURIComponent(f.set_num)}/`);
            await renderMinifigResult(full);
            saveHistory({ type: "minifig", num: full.set_num, name: full.name, image: full.set_img_url });
          } catch (err) {
            showResultError(err);
          }
        });
      });
      e.target.remove();
    } catch (err) {
      toast("人偶資料載入失敗：" + err.message, "error");
      e.target.disabled = false;
      e.target.textContent = "查看人偶";
    }
  });

  $("#loadSetPartsBtn").addEventListener("click", async (e) => {
    e.target.disabled = true;
    e.target.textContent = "載入中…";
    try {
      const parts = await rbFetch(`/lego/sets/${encodeURIComponent(set.set_num)}/parts/?page_size=30`);
      const rows = parts.results
        .map(
          (p) => `
        <div class="part-row">
          ${p.part.part_img_url ? `<img src="${p.part.part_img_url}" alt="" />` : ""}
          <div class="pr-text">${escapeHtml(p.part.name)}<br/><span class="muted">${p.part.part_num} ・ ${escapeHtml(p.color.name)}</span></div>
          <div class="pr-qty">×${p.quantity}</div>
        </div>`
        )
        .join("");
      $("#setPartsContainer").innerHTML = `
        <p class="muted" style="margin-top:14px">零件清單（前 ${parts.results.length} 筆，共 ${parts.count} 種）：</p>
        <div class="parts-list">${rows}</div>`;
      e.target.remove();
    } catch (err) {
      toast("零件清單載入失敗：" + err.message, "error");
      e.target.disabled = false;
      e.target.textContent = "載入零件清單";
    }
  });
}

async function renderPartResult(part) {
  const rebrickableUrl = `https://rebrickable.com/parts/${part.part_num}/`;
  $("#resultContent").innerHTML = `
    <div class="result-card">
      ${part.part_img_url ? `<img class="result-img" src="${part.part_img_url}" alt="${escapeHtml(part.name)}" />` : ""}
      <div class="result-title">${escapeHtml(part.name)}</div>
      <div class="result-sub">零件編號 ${part.part_num} ${part.part_cat_id ? "・ 分類 #" + part.part_cat_id : ""}</div>
      <button class="pill-btn full" id="loadPartColorsBtn">查看可用顏色</button>
      <button class="fav-btn" id="favBtn">⭐ 加入收藏</button>
      <p style="margin-top:12px"><a href="${rebrickableUrl}" target="_blank" rel="noopener" style="color:var(--accent)">在 Rebrickable 網站上查看完整資料 →</a></p>
      <div id="partColorsContainer"></div>
    </div>`;

  $("#favBtn").addEventListener("click", () =>
    addToCollection("part", part.part_num, part.name, part.part_img_url)
  );

  $("#loadPartColorsBtn").addEventListener("click", async (e) => {
    e.target.disabled = true;
    e.target.textContent = "載入中…";
    try {
      const [colors, colorMap] = await Promise.all([
        rbFetch(`/lego/parts/${encodeURIComponent(part.part_num)}/colors/?page_size=50`),
        getColorMap(),
      ]);
      const chips = colors.results
        .map((c) => {
          const hex = colorMap[c.color_id] || "999999";
          return `
        <span class="color-chip">
          <span class="color-dot" style="background:#${hex}"></span>
          ${escapeHtml(c.color_name)}
        </span>`;
        })
        .join("");
      $("#partColorsContainer").innerHTML = `
        <p class="muted" style="margin-top:14px">共 ${colors.results.length} 種可用顏色：</p>
        <div>${chips}</div>`;
      e.target.remove();
    } catch (err) {
      toast("顏色資料載入失敗：" + err.message, "error");
      e.target.disabled = false;
      e.target.textContent = "查看可用顏色";
    }
  });
}

async function renderMinifigResult(fig) {
  const rebrickableUrl = `https://rebrickable.com/minifigs/${fig.set_num}/`;
  $("#resultContent").innerHTML = `
    <div class="result-card">
      ${fig.set_img_url ? `<img class="result-img" src="${fig.set_img_url}" alt="${escapeHtml(fig.name)}" />` : ""}
      <div class="result-title">${escapeHtml(fig.name)}</div>
      <div class="result-sub">人偶編號 ${fig.set_num}</div>
      <div class="result-grid">
        <div class="stat-box"><div class="num">${fig.num_parts ?? "-"}</div><div class="lbl">零件數</div></div>
      </div>
      <button class="fav-btn" id="favBtn">⭐ 加入收藏</button>
      <p style="margin-top:12px"><a href="${rebrickableUrl}" target="_blank" rel="noopener" style="color:var(--accent)">在 Rebrickable 網站上查看完整資料 →</a></p>
    </div>`;

  $("#favBtn").addEventListener("click", () =>
    addToCollection("minifig", fig.set_num, fig.name, fig.set_img_url)
  );
}

// ---------- History ----------
function saveHistory(item) {
  const list = getHistory();
  list.unshift({ ...item, ts: Date.now() });
  const trimmed = list.slice(0, 20);
  localStorage.setItem(LS_KEY_HISTORY, JSON.stringify(trimmed));
  renderHistory();
}
function getHistory() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY_HISTORY) || "[]");
  } catch {
    return [];
  }
}
function renderHistory() {
  const list = getHistory();
  const el = $("#historyList");
  if (!list.length) {
    el.innerHTML = `<div class="empty-hint">還沒有查詢紀錄</div>`;
    return;
  }
  el.innerHTML = list
    .map(
      (it, i) => `
    <div class="history-item" data-idx="${i}">
      ${it.image ? `<img src="${it.image}" alt="" />` : `<div style="width:44px;height:44px;background:var(--bg-elevated);border-radius:8px"></div>`}
      <div class="hi-text">
        <div class="hi-title">${escapeHtml(it.name || it.num)}</div>
        <div class="hi-sub">${{ set: "組合", part: "零件", minifig: "人偶" }[it.type] || it.type} ・ ${it.num}</div>
      </div>
    </div>`
    )
    .join("");
  $$("#historyList .history-item").forEach((row) => {
    row.addEventListener("click", () => {
      const it = list[+row.dataset.idx];
      runLookup(it.type, it.num);
    });
  });
}
$("#clearHistoryBtn").addEventListener("click", () => {
  localStorage.removeItem(LS_KEY_HISTORY);
  renderHistory();
});

// ---------- color map cache ----------
const LS_KEY_COLORS = "rb_color_map_v1";
let colorMapMemo = null;
async function getColorMap() {
  if (colorMapMemo) return colorMapMemo;
  const cached = localStorage.getItem(LS_KEY_COLORS);
  if (cached) {
    try {
      colorMapMemo = JSON.parse(cached);
      return colorMapMemo;
    } catch {}
  }
  const map = {};
  let next = `/lego/colors/?page_size=1000`;
  while (next) {
    const data = await rbFetch(next.replace(API_BASE, ""));
    (data.results || []).forEach((c) => {
      map[c.id] = c.rgb;
    });
    next = data.next ? data.next.replace(API_BASE, "") : null;
  }
  colorMapMemo = map;
  localStorage.setItem(LS_KEY_COLORS, JSON.stringify(map));
  return map;
}

// ---------- utils ----------
function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

// ---------- init ----------
window.goBack = goBack; // used by inline onclick
renderHistory();
renderAccountUI();
initGoogleSignInWhenReady();

// ---------- Service worker ----------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  });
}
