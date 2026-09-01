// ===== 積木收藏本 =====
// Rebrickable 查詢透過後端代理呼叫；BrickLink Price Guide 用來查詢目前市場價值（全新／二手）

const API_BASE = "/api/rebrickable";
const LS_KEY_SESSION = "rb_session_token";
const LS_KEY_USER = "rb_user";
const GOOGLE_CLIENT_ID = "529227251585-n19luhp082iea90eau84uulsuh7kn3sb.apps.googleusercontent.com";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ---------- 導覽 ----------
const viewStack = ["home"];
let currentManualMode = "set";

function showView(name, { pushHistory = true } = {}) {
  $$(".view").forEach((v) => v.classList.remove("active"));
  const el = $("#view-" + name);
  if (el) el.classList.add("active");

  const titles = {
    home: "我的收藏",
    result: "查詢結果",
    settings: "設定",
  };
  $("#pageTitle").textContent = titles[name] || "我的收藏";
  $("#backBtn").classList.toggle("hidden", name === "home");

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
    loadCollection();
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
  loadCollection();
}
$("#accLogoutBtn").addEventListener("click", logout);

// ---------- 我的收藏 ----------
const COLLECTION_TYPE_LABEL = { set: "組合", part: "零件", minifig: "人偶" };

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

function formatCurrency(amount) {
  try {
    return new Intl.NumberFormat("zh-Hant", {
      style: "currency",
      currency: "TWD",
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return "NT$" + Math.round(amount).toLocaleString();
  }
}

function updateTotalValueStat(items) {
  let total = 0;
  let knownCount = 0;
  let unknownCount = 0;
  items.forEach((it) => {
    if (it.value_amount != null) {
      total += it.value_amount * it.quantity;
      knownCount++;
    } else {
      unknownCount++;
    }
  });
  $("#totalValueAmount").textContent = formatCurrency(total);
  const sub = $("#totalValueSub");
  if (!items.length) {
    sub.textContent = "還沒有收藏任何東西";
  } else if (unknownCount > 0) {
    sub.textContent = `${knownCount} 項已知價值加總，還有 ${unknownCount} 項尚無價格資料`;
  } else {
    sub.textContent = `共 ${items.length} 項收藏`;
  }
}

function renderCollectionList(items) {
  const listEl = $("#collectionList");
  const emptyEl = $("#collectionEmptyHint");
  updateTotalValueStat(items);
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
        <div class="ci-sub">
          ${COLLECTION_TYPE_LABEL[it.item_type] || it.item_type} ・ ${escapeHtml(it.item_ref)}
          <span class="ci-condition ${it.condition === "used" ? "used" : "new"}">${it.condition === "used" ? "二手" : "全新"}</span>
        </div>
        <div class="ci-value">${it.value_amount != null ? formatCurrency(it.value_amount) + " / 個" : "價值未知"}</div>
      </div>
      <span class="ci-qty">×${it.quantity}</span>
      <button class="ci-edit" data-edit-id="${it.id}" aria-label="編輯">✏️</button>
      <button class="ci-remove" data-remove-id="${it.id}" aria-label="移除">🗑</button>
    </div>`
    )
    .join("");
  $$("#collectionList .collection-item").forEach((row) => {
    row.addEventListener("click", (e) => {
      if (e.target.closest(".ci-remove") || e.target.closest(".ci-edit")) return;
      runLookup(row.dataset.type, row.dataset.ref);
    });
  });
  $$("#collectionList .ci-edit").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const item = items.find((it) => it.id === btn.dataset.editId);
      if (item) openEditItem(item);
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

async function addToCollection(itemType, itemRef, name, imageUrl, condition) {
  if (!isLoggedIn()) {
    toast("請先登入 Google 帳號才能收藏", "error");
    return;
  }
  try {
    const res = await apiFetch("/api/collection", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ item_type: itemType, item_ref: itemRef, name, image_url: imageUrl, condition }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error("ADD_FAILED");
    const label = condition === "used" ? "二手" : "全新";
    if (data && data.item && data.item.value_amount != null) {
      toast(`已加入收藏（${label}，${formatCurrency(data.item.value_amount)}）⭐`);
    } else {
      toast(`已加入收藏（${label}）⭐ 尚無價格資料，可在收藏清單裡手動輸入`);
    }
    loadCollection();
  } catch (err) {
    toast("加入收藏失敗，請再試一次", "error");
  }
}

// ---------- 加入收藏：選擇全新／二手 ----------
let pendingAddItem = null;

function openConditionPicker(itemType, itemRef, name, imageUrl) {
  if (!isLoggedIn()) {
    toast("請先登入 Google 帳號才能收藏", "error");
    return;
  }
  pendingAddItem = { itemType, itemRef, name, imageUrl };
  $("#conditionModalSub").textContent = name || itemRef;
  $("#conditionModal").classList.remove("hidden");
}
function closeConditionModal() {
  $("#conditionModal").classList.add("hidden");
  pendingAddItem = null;
}
$$("#conditionModal .condition-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (!pendingAddItem) return;
    const { itemType, itemRef, name, imageUrl } = pendingAddItem;
    const condition = btn.dataset.condition;
    closeConditionModal();
    addToCollection(itemType, itemRef, name, imageUrl, condition);
  });
});
$("#conditionModalCancel").addEventListener("click", closeConditionModal);

// ---------- 編輯收藏項目 ----------
let editingItem = null;
let editingQty = 1;
let editingCondition = "new";

function openEditItem(item) {
  editingItem = item;
  editingQty = item.quantity;
  editingCondition = item.condition === "used" ? "used" : "new";
  $("#editItemName").textContent = `${item.name || item.item_ref}（${COLLECTION_TYPE_LABEL[item.item_type] || item.item_type} ・ ${item.item_ref}）`;
  $$("#editConditionSeg .seg-btn").forEach((b) => b.classList.toggle("active", b.dataset.condition === editingCondition));
  $("#editQtyValue").textContent = editingQty;
  $("#editValueInput").value = item.value_amount != null ? item.value_amount : "";
  $("#editItemModal").classList.remove("hidden");
}
function closeEditModal() {
  $("#editItemModal").classList.add("hidden");
  editingItem = null;
}
$("#editConditionSeg").addEventListener("click", (e) => {
  const btn = e.target.closest(".seg-btn");
  if (!btn) return;
  editingCondition = btn.dataset.condition;
  $$("#editConditionSeg .seg-btn").forEach((b) => b.classList.toggle("active", b === btn));
});
$("#editQtyMinus").addEventListener("click", () => {
  editingQty = Math.max(1, editingQty - 1);
  $("#editQtyValue").textContent = editingQty;
});
$("#editQtyPlus").addEventListener("click", () => {
  editingQty = Math.min(9999, editingQty + 1);
  $("#editQtyValue").textContent = editingQty;
});

function priceReasonMessage(reason) {
  const map = {
    NO_KEY: "尚未設定價格查詢金鑰",
    UNSUPPORTED_TYPE: "人偶目前不支援自動查詢市場價格，可以手動輸入",
    RATE_LIMITED: "查詢次數已用完，請稍後再試",
    NO_VALUE: "查無這個項目的價格資料",
  };
  return map[reason] || "價格查詢失敗，請稍後再試";
}

$("#editRefreshPriceBtn").addEventListener("click", async (e) => {
  if (!editingItem) return;
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = "查詢中…";
  try {
    const res = await apiFetch("/api/collection/" + encodeURIComponent(editingItem.id), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refresh_price: true }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error((data && data.reason) || "REFRESH_FAILED");
    if (data.item && data.item.value_amount != null) {
      $("#editValueInput").value = data.item.value_amount;
      toast("價格已更新");
    } else {
      toast("查無價格資料", "error");
    }
  } catch (err) {
    toast(priceReasonMessage(err.message), "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "🔄 重新查詢市場價格";
  }
});

$("#editSaveBtn").addEventListener("click", async () => {
  if (!editingItem) return;
  const valRaw = $("#editValueInput").value.trim();
  const body = {
    quantity: editingQty,
    condition: editingCondition,
  };
  if (valRaw !== "") {
    const num = Number(valRaw);
    if (Number.isFinite(num) && num >= 0) body.value_amount = num;
  }
  try {
    const res = await apiFetch("/api/collection/" + encodeURIComponent(editingItem.id), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error("SAVE_FAILED");
    toast("已更新");
    closeEditModal();
    loadCollection();
  } catch (err) {
    toast("更新失敗，請再試一次", "error");
  }
});
$("#editCancelBtn").addEventListener("click", closeEditModal);

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
    openConditionPicker("set", set.set_num, set.name, set.set_img_url)
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
    openConditionPicker("part", part.part_num, part.name, part.part_img_url)
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
    openConditionPicker("minifig", fig.set_num, fig.name, fig.set_img_url)
  );
}

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
renderAccountUI();
initGoogleSignInWhenReady();
loadCollection();

// ---------- Service worker ----------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  });
}
