(() => {
  "use strict";

  const ORIGIN_SCHEMA = "admin-x-manual-v1";
  const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{7,63}$/;
  const DETAIL_ID_PATTERN = /^(?:x_[a-z0-9_]{1,63}|xsub_[a-z0-9]{8,64})$/;
  const endpoints = Object.freeze({
    sources: "/api/admin/sources",
    source: (id) => `/api/admin/sources/${encodeURIComponent(id)}`,
    submissions: "/api/admin/x-submissions",
    submission: (id) => `/api/admin/x-submissions/${encodeURIComponent(id)}`,
    retire: (id) => `/api/admin/x-submissions/${encodeURIComponent(id)}/retire`,
    csrf: "/api/admin/csrf",
    loginOptions: "/api/admin/auth/login/options",
    loginVerify: "/api/admin/auth/login/verify",
    freshOptions: "/api/admin/auth/fresh/options",
    freshVerify: "/api/admin/auth/fresh/verify"
  });

  const elements = Object.freeze({
    root: document.documentElement,
    routeLabel: document.querySelector("#route-label"),
    connectionState: document.querySelector("#connection-state"),
    themeToggle: document.querySelector("#theme-toggle"),
    authView: document.querySelector("#auth-view"),
    authStatus: document.querySelector("#auth-status"),
    authActions: document.querySelector("#auth-actions"),
    loginPasskey: document.querySelector("#login-passkey"),
    appView: document.querySelector("#app-view"),
    navSources: document.querySelector("#nav-sources"),
    navSubmissions: document.querySelector("#nav-submissions"),
    workspaceKicker: document.querySelector("#workspace-kicker"),
    workspaceTitle: document.querySelector("#workspace-title"),
    workspaceSummary: document.querySelector("#workspace-summary"),
    refreshList: document.querySelector("#refresh-list"),
    submitForm: document.querySelector("#submit-form"),
    submittedUrl: document.querySelector("#submitted-url"),
    submitUrl: document.querySelector("#submit-url"),
    submitError: document.querySelector("#submit-error"),
    listSearch: document.querySelector("#list-search"),
    listState: document.querySelector("#list-state"),
    itemList: document.querySelector("#item-list"),
    mobileBack: document.querySelector("#mobile-back"),
    detailState: document.querySelector("#detail-state"),
    detailStateTitle: document.querySelector("#detail-state-title"),
    detailStateCopy: document.querySelector("#detail-state-copy"),
    detailRetry: document.querySelector("#detail-retry"),
    detailContent: document.querySelector("#detail-content"),
    detailKicker: document.querySelector("#detail-kicker"),
    detailTitle: document.querySelector("#detail-title"),
    detailMeta: document.querySelector("#detail-meta"),
    detailStatus: document.querySelector("#detail-status"),
    detailGrid: document.querySelector("#detail-grid"),
    detailActions: document.querySelector("#detail-actions"),
    operationStatus: document.querySelector("#operation-status"),
    retireDialog: document.querySelector("#retire-dialog"),
    retireForm: document.querySelector("#retire-form"),
    retireSummary: document.querySelector("#retire-summary"),
    retireReason: document.querySelector("#retire-reason"),
    retireCancel: document.querySelector("#retire-cancel"),
    retireConfirm: document.querySelector("#retire-confirm"),
    toast: document.querySelector("#toast")
  });

  const state = {
    mode: "sources",
    items: [],
    detail: null,
    selectedId: null,
    busy: false,
    detailRetryAction: null
  };

  class AdminUiError extends Error {
    constructor(message, options = {}) {
      super(message);
      this.name = "AdminUiError";
      this.status = options.status ?? 0;
      this.reasonCode = options.reasonCode ?? "ADMIN_UI_FAILURE";
      this.uncertain = options.uncertain === true;
    }
  }

  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function requireSchema(value, schemaVersion) {
    if (!isObject(value) || value.schemaVersion !== schemaVersion) {
      throw new AdminUiError("Admin API 响应格式无效", { reasonCode: "ADMIN_RESPONSE_INVALID" });
    }
    return value;
  }

  function errorCopy(error) {
    const code = error instanceof AdminUiError ? error.reasonCode : "ADMIN_UI_FAILURE";
    const known = {
      ADMIN_SESSION_REQUIRED: "会话已失效，请使用通行密钥重新登录。",
      ADMIN_ORIGIN_REJECTED: "请求来源校验失败，请从当前私有入口重试。",
      ADMIN_CSRF_REJECTED: "一次性操作令牌已失效，请重新发起操作。",
      ADMIN_REAUTH_REQUIRED: "再次认证未完成，请重新验证通行密钥。",
      ADMIN_REQUEST_INVALID: "请求内容不符合 X 人工管理合同，请核对 URL 或刷新状态。",
      ADMIN_BACKUP_STALE: "写入安全边界尚未就绪，当前没有执行写操作。",
      ADMIN_STORAGE_BUSY: "本地存储暂时忙碌，请刷新后再试。",
      ADMIN_NETWORK_FAILURE: "Admin 服务连接中断，请检查私有网络后重试。",
      ADMIN_RESPONSE_INVALID: "Admin 服务响应无法校验，请停止当前操作并刷新。",
      X_MANUAL_AUTHORITY_REQUIRED: "写入 authority 尚未就绪，当前没有执行写操作。"
    };
    return known[code] ?? `操作失败（${code}）`;
  }

  async function requestJson(path, options = {}) {
    let response;
    try {
      response = await window.fetch(path, {
        method: options.method ?? "GET",
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        headers: {
          Accept: "application/json",
          ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(options.headers ?? {})
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body)
      });
    } catch {
      throw new AdminUiError("Admin 服务连接中断", {
        reasonCode: "ADMIN_NETWORK_FAILURE",
        uncertain: options.method === "POST"
      });
    }
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new AdminUiError("Admin 服务返回了不可解析响应", {
        status: response.status,
        reasonCode: "ADMIN_RESPONSE_INVALID",
        uncertain: options.method === "POST"
      });
    }
    if (!response.ok) {
      const reasonCode = isObject(payload) && typeof payload.reasonCode === "string"
        ? payload.reasonCode
        : `HTTP_${response.status}`;
      throw new AdminUiError(reasonCode, {
        status: response.status,
        reasonCode,
        uncertain: options.method === "POST" && response.status >= 500
      });
    }
    return payload;
  }

  function canonicalJson(value) {
    if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
    if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
    if (!isObject(value)) throw new AdminUiError("无法规范化请求", { reasonCode: "ADMIN_REQUEST_INVALID" });
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }

  async function sha256(value) {
    const bytes = new TextEncoder().encode(value);
    const digest = await window.crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function randomId(prefix) {
    const bytes = new Uint8Array(12);
    window.crypto.getRandomValues(bytes);
    return `${prefix}_${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  }

  async function requestHash({ path, resourceId, expectedRevision, bodyWithoutMeta }) {
    return sha256(canonicalJson({
      method: "POST",
      canonicalPath: path,
      resourceId,
      expectedRevision,
      bodyWithoutMeta
    }));
  }

  async function operationId(kind, clientRequestId) {
    return `xop_${(await sha256(`admin-x-${kind}\n${clientRequestId}`)).slice(0, 32)}`;
  }

  async function bodyHash(value) {
    return sha256(canonicalJson(value));
  }

  function base64UrlToBuffer(value) {
    const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const binary = window.atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes.buffer;
  }

  function bufferToBase64Url(value) {
    const bytes = new Uint8Array(value);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return window.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function requestOptionsFromJson(publicKey) {
    if (typeof window.PublicKeyCredential?.parseRequestOptionsFromJSON === "function") {
      return window.PublicKeyCredential.parseRequestOptionsFromJSON(publicKey);
    }
    return {
      ...publicKey,
      challenge: base64UrlToBuffer(publicKey.challenge),
      allowCredentials: Array.isArray(publicKey.allowCredentials)
        ? publicKey.allowCredentials.map((credential) => ({ ...credential, id: base64UrlToBuffer(credential.id) }))
        : undefined
    };
  }

  function credentialToJson(credential) {
    const response = credential.response;
    return {
      id: credential.id,
      rawId: bufferToBase64Url(credential.rawId),
      type: credential.type,
      authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
      clientExtensionResults: credential.getClientExtensionResults(),
      response: {
        clientDataJSON: bufferToBase64Url(response.clientDataJSON),
        authenticatorData: bufferToBase64Url(response.authenticatorData),
        signature: bufferToBase64Url(response.signature),
        userHandle: response.userHandle ? bufferToBase64Url(response.userHandle) : undefined
      }
    };
  }

  async function getPasskey(publicKey) {
    if (!window.PublicKeyCredential || !navigator.credentials) {
      throw new AdminUiError("当前浏览器不支持通行密钥", { reasonCode: "ADMIN_PASSKEY_UNAVAILABLE" });
    }
    const credential = await navigator.credentials.get({ publicKey: requestOptionsFromJson(publicKey) });
    if (!credential) throw new AdminUiError("通行密钥验证已取消", { reasonCode: "ADMIN_PASSKEY_CANCELLED" });
    return credentialToJson(credential);
  }

  async function login() {
    const options = requireSchema(await requestJson(endpoints.loginOptions, {
      method: "POST",
      body: { schemaVersion: "admin-auth-login-options-v1" }
    }), "admin-auth-login-options-v1");
    const response = await getPasskey(options.publicKey);
    requireSchema(await requestJson(endpoints.loginVerify, {
      method: "POST",
      body: { schemaVersion: "admin-auth-login-verify-v1", response }
    }), "admin-auth-login-verify-v1");
  }

  async function freshReauth(mutation) {
    const options = requireSchema(await requestJson(endpoints.freshOptions, {
      method: "POST",
      body: { schemaVersion: "admin-auth-fresh-options-v1", mutation }
    }), "admin-auth-fresh-options-v1");
    const response = await getPasskey(options.publicKey);
    const verified = requireSchema(await requestJson(endpoints.freshVerify, {
      method: "POST",
      body: { schemaVersion: "admin-auth-fresh-verify-v1", mutation, response }
    }), "admin-auth-fresh-verify-v1");
    if (typeof verified.freshReceipt !== "string") {
      throw new AdminUiError("Fresh 收据缺失", { reasonCode: "ADMIN_REAUTH_REQUIRED" });
    }
    return verified.freshReceipt;
  }

  async function csrf(operationType, mutation, expectedPath, expectedOperationId) {
    const payload = requireSchema(await requestJson(endpoints.csrf, {
      method: "POST",
      body: { schemaVersion: "admin-review-csrf-v1", operationType, mutation }
    }), "admin-review-csrf-v1");
    const expectedBodyHash = await bodyHash(mutation);
    if (
      typeof payload.csrfToken !== "string" ||
      payload.operationId !== expectedOperationId ||
      payload.path !== expectedPath ||
      payload.bodyHash !== expectedBodyHash
    ) {
      throw new AdminUiError("CSRF 收据与当前操作不匹配", { reasonCode: "ADMIN_CSRF_REJECTED" });
    }
    return payload.csrfToken;
  }

  function setTheme(theme) {
    const resolved = theme === "light" ? "light" : "dark";
    elements.root.dataset.theme = resolved;
    elements.themeToggle.textContent = resolved === "dark" ? "深" : "浅";
    elements.themeToggle.setAttribute("aria-label", `当前${resolved === "dark" ? "深色" : "浅色"}主题，切换主题`);
    try { window.localStorage.setItem("f1-admin-theme", resolved); } catch { /* visible state remains authoritative */ }
  }

  function initialTheme() {
    try {
      const stored = window.localStorage.getItem("f1-admin-theme");
      if (stored === "dark" || stored === "light") return stored;
    } catch { /* use system preference */ }
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }

  function toast(message) {
    elements.toast.textContent = message;
    elements.toast.classList.add("is-visible");
    window.clearTimeout(toast.timer);
    toast.timer = window.setTimeout(() => elements.toast.classList.remove("is-visible"), 2600);
  }

  function setBusy(busy) {
    state.busy = busy;
    elements.refreshList.disabled = busy;
    elements.submitUrl.disabled = busy;
    elements.retireConfirm.disabled = busy;
  }

  function showAuth(error) {
    elements.appView.hidden = true;
    elements.authView.hidden = false;
    elements.authActions.hidden = false;
    elements.connectionState.textContent = "需要登录";
    elements.authStatus.innerHTML = "";
    const strong = document.createElement("strong");
    strong.textContent = error ? errorCopy(error) : "会话尚未建立";
    const copy = document.createElement("span");
    copy.textContent = "请使用当前设备的通行密钥。";
    elements.authStatus.append(strong, copy);
  }

  function showApp() {
    elements.authView.hidden = true;
    elements.appView.hidden = false;
    elements.connectionState.textContent = "私有会话已连接";
  }

  function parseRoute() {
    const segments = window.location.pathname.split("/").filter(Boolean);
    if (segments[0] !== "admin" || !["sources", "x-submissions"].includes(segments[1]) || segments.length > 3) {
      return { mode: "sources", detailId: null, invalid: true };
    }
    const mode = segments[1] === "sources" ? "sources" : "submissions";
    const detailId = segments[2] ?? null;
    return { mode, detailId, invalid: detailId !== null && !DETAIL_ID_PATTERN.test(detailId) };
  }

  function configureMode(mode) {
    state.mode = mode;
    const sources = mode === "sources";
    elements.navSources.toggleAttribute("aria-current", sources);
    elements.navSubmissions.toggleAttribute("aria-current", !sources);
    elements.navSources.classList.toggle("is-current", sources);
    elements.navSubmissions.classList.toggle("is-current", !sources);
    elements.submitForm.hidden = sources;
    elements.workspaceKicker.textContent = sources ? "Pinned X inventory" : "Manual URL inbox";
    elements.workspaceTitle.textContent = sources ? "X 信源" : "人工投稿";
    elements.routeLabel.textContent = sources ? "私有 Admin · /admin/sources" : "私有 Admin · /admin/x-submissions";
    elements.listSearch.placeholder = sources ? "搜索 handle 或 source ID" : "搜索 URL、投稿 ID 或状态";
    document.title = sources ? "F1+1 · X 信源" : "F1+1 · X 人工投稿";
  }

  function showListState(kind, message) {
    elements.listState.hidden = false;
    elements.listState.dataset.kind = kind;
    elements.listState.innerHTML = "";
    if (kind === "loading") {
      const spinner = document.createElement("span");
      spinner.className = "spinner";
      spinner.setAttribute("aria-hidden", "true");
      elements.listState.append(spinner);
    }
    const copy = document.createElement("span");
    copy.textContent = message;
    elements.listState.append(copy);
  }

  function formatTime(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "—";
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false
    }).format(date);
  }

  function listSearchText(item) {
    return state.mode === "sources"
      ? `${item.sourceId} ${item.handle} ${item.lifecycleStatus} ${item.collectionMode}`.toLowerCase()
      : `${item.submissionId} ${item.submittedUrl} ${item.canonicalUrl} ${item.state} ${item.sourceId ?? ""}`.toLowerCase();
  }

  function itemId(item) {
    return state.mode === "sources" ? item.sourceId : item.submissionId;
  }

  function renderList() {
    const query = elements.listSearch.value.trim().toLowerCase();
    const visible = state.items.filter((item) => listSearchText(item).includes(query));
    elements.itemList.innerHTML = "";
    elements.workspaceSummary.textContent = state.mode === "sources"
      ? `${state.items.length} 个钉死信源 · 全部 disabled / manual_url`
      : `${state.items.length} 条最近人工投稿 · 无外联`;
    if (visible.length === 0) {
      showListState("empty", query ? "没有匹配结果" : state.mode === "sources" ? "信源清单为空" : "尚无人工投稿");
      return;
    }
    elements.listState.hidden = true;
    for (const item of visible) {
      const id = itemId(item);
      const li = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "x-list-item";
      button.classList.toggle("is-selected", id === state.selectedId);
      button.setAttribute("aria-current", id === state.selectedId ? "true" : "false");
      const title = document.createElement("strong");
      title.textContent = state.mode === "sources" ? `@${item.handle}` : item.canonicalUrl;
      const meta = document.createElement("span");
      meta.textContent = state.mode === "sources"
        ? `${item.lifecycleStatus} · disabled · ${item.collectionMode}`
        : `${item.state} · rev ${item.revision} · ${formatTime(item.createdAt)}`;
      const code = document.createElement("code");
      code.textContent = id;
      button.append(title, meta, code);
      button.addEventListener("click", () => navigateDetail(id));
      li.append(button);
      elements.itemList.append(li);
    }
  }

  function addDetailRow(label, value, options = {}) {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    if (options.href) {
      const link = document.createElement("a");
      link.href = options.href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = value;
      dd.append(link);
    } else {
      dd.textContent = value;
    }
    elements.detailGrid.append(dt, dd);
  }

  function showDetailState(title, copy, retryAction = null) {
    elements.detailContent.hidden = true;
    elements.detailState.hidden = false;
    elements.detailStateTitle.textContent = title;
    elements.detailStateCopy.textContent = copy;
    state.detailRetryAction = retryAction;
    elements.detailRetry.hidden = retryAction === null;
  }

  function renderDetail() {
    const item = state.detail;
    if (!item) {
      showDetailState("选择一项查看详情", "列表和详情均来自当前私有 Admin 会话。");
      return;
    }
    elements.detailState.hidden = true;
    elements.detailContent.hidden = false;
    elements.detailGrid.innerHTML = "";
    elements.detailActions.innerHTML = "";
    elements.operationStatus.hidden = true;
    if (state.mode === "sources") {
      elements.detailKicker.textContent = "Pinned X source";
      elements.detailTitle.textContent = `@${item.handle}`;
      elements.detailMeta.textContent = item.sourceId;
      elements.detailStatus.textContent = `${item.lifecycleStatus} · disabled`;
      addDetailRow("Source ID", item.sourceId);
      addDetailRow("公开主页", item.canonicalUrl, { href: item.canonicalUrl });
      addDetailRow("来源类型", item.sourceKind);
      addDetailRow("收集方式", item.collectionMode);
      addDetailRow("启用状态", item.enabled ? "enabled" : "disabled");
      addDetailRow("Onboarding", item.collectionOnboardingStatus);
      addDetailRow("Normalization", item.normalizationStatus);
      addDetailRow("Dedup", item.dedupStatus);
      addDetailRow("Identity", item.identityStatus);
      addDetailRow("Relevance", item.relevanceStatus);
      addDetailRow("Monitorability", item.monitorability);
      addDetailRow("Adapter", `${item.adapterStatus} / ${item.adapterAuthorizationStatus}`);
      addDetailRow("Platform", item.platformAllowed);
      addDetailRow("Inventory SHA", item.inventorySha256);
      addDetailRow("更新时间", formatTime(item.updatedAt));
      return;
    }
    elements.detailKicker.textContent = "Manual X submission";
    elements.detailTitle.textContent = item.submissionId;
    elements.detailMeta.textContent = `revision ${item.revision} · ${formatTime(item.updatedAt)}`;
    elements.detailStatus.textContent = item.state;
    addDetailRow("投稿 URL", item.submittedUrl, { href: item.submittedUrl });
    addDetailRow("规范 URL", item.canonicalUrl, { href: item.canonicalUrl });
    addDetailRow("Status ID", item.statusId);
    addDetailRow("关联信源", item.sourceId ?? "未匹配钉死 inventory");
    addDetailRow("状态", item.state);
    addDetailRow("Dedupe key", item.dedupeKey);
    addDetailRow("候选", item.candidateId ?? "尚未创建");
    addDetailRow("oEmbed attempt", item.oembedAttemptId ?? "disabled / 未创建");
    addDetailRow("保留至", formatTime(item.retentionExpiresAt));
    if (["submitted", "validated"].includes(item.state)) {
      const retire = document.createElement("button");
      retire.type = "button";
      retire.className = "danger-button";
      retire.textContent = "退役这条投稿";
      retire.addEventListener("click", openRetireDialog);
      elements.detailActions.append(retire);
    }
  }

  async function loadList(options = {}) {
    showListState("loading", state.mode === "sources" ? "正在载入 X 信源" : "正在载入人工投稿");
    elements.refreshList.disabled = true;
    try {
      const payload = requireSchema(await requestJson(state.mode === "sources" ? endpoints.sources : endpoints.submissions), ORIGIN_SCHEMA);
      if (!Array.isArray(payload.items)) throw new AdminUiError("列表格式无效", { reasonCode: "ADMIN_RESPONSE_INVALID" });
      state.items = payload.items;
      showApp();
      renderList();
      if (options.selectId) await loadDetail(options.selectId);
      else renderDetail();
    } catch (error) {
      if (error instanceof AdminUiError && error.status === 401) {
        showAuth(error);
        return;
      }
      showApp();
      state.items = [];
      showListState("error", errorCopy(error));
      elements.workspaceSummary.textContent = "读取失败 · 可安全重试";
    } finally {
      elements.refreshList.disabled = false;
    }
  }

  async function loadDetail(id) {
    state.selectedId = id;
    state.detail = null;
    renderList();
    showDetailState("正在读取详情", "正在校验当前私有状态。");
    try {
      const payload = requireSchema(await requestJson(
        state.mode === "sources" ? endpoints.source(id) : endpoints.submission(id)
      ), ORIGIN_SCHEMA);
      state.detail = state.mode === "sources" ? payload.source : payload.submission;
      if (!isObject(state.detail) || itemId(state.detail) !== id) {
        throw new AdminUiError("详情身份不匹配", { reasonCode: "ADMIN_RESPONSE_INVALID" });
      }
      renderDetail();
    } catch (error) {
      if (error instanceof AdminUiError && error.status === 401) {
        showAuth(error);
        return;
      }
      showDetailState("详情读取失败", errorCopy(error), () => loadDetail(id));
    }
  }

  function navigateDetail(id) {
    const base = state.mode === "sources" ? "/admin/sources" : "/admin/x-submissions";
    window.history.pushState({}, "", `${base}/${id}`);
    elements.root.dataset.mobileView = "detail";
    void loadDetail(id);
  }

  async function submitManualUrl(event) {
    event.preventDefault();
    elements.submitError.textContent = "";
    const submittedUrl = elements.submittedUrl.value.trim();
    setBusy(true);
    try {
      const path = endpoints.submissions;
      const clientRequestId = randomId("xreq");
      const idempotencyKey = randomId("xidem");
      if (!ID_PATTERN.test(clientRequestId) || !ID_PATTERN.test(idempotencyKey)) throw new AdminUiError("请求 ID 无效");
      const hash = await requestHash({
        path,
        resourceId: "x-manual-inbox",
        expectedRevision: 0,
        bodyWithoutMeta: { submittedUrl }
      });
      const mutation = {
        meta: { idempotencyKey, expectedRevision: 0, requestHash: hash, clientRequestId },
        submittedUrl
      };
      const expectedOperationId = await operationId("submit", clientRequestId);
      const csrfToken = await csrf("x-submit", mutation, path, expectedOperationId);
      const result = requireSchema(await requestJson(path, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey, "X-CSRF-Token": csrfToken },
        body: mutation
      }), ORIGIN_SCHEMA);
      if (!isObject(result.submission)) throw new AdminUiError("投稿结果缺失", { reasonCode: "ADMIN_RESPONSE_INVALID" });
      elements.submittedUrl.value = "";
      toast(result.duplicate ? "已存在相同 status，显示原投稿" : "人工投稿已接收");
      await loadList({ selectId: result.submission.submissionId });
      window.history.pushState({}, "", `/admin/x-submissions/${result.submission.submissionId}`);
      elements.root.dataset.mobileView = "detail";
    } catch (error) {
      elements.submitError.textContent = error.uncertain
        ? `${errorCopy(error)} 提交结果未知，请先刷新列表，禁止直接重复提交。`
        : errorCopy(error);
      if (error instanceof AdminUiError && error.status === 401) showAuth(error);
    } finally {
      setBusy(false);
    }
  }

  function openRetireDialog() {
    if (!state.detail || state.mode !== "submissions") return;
    elements.retireSummary.textContent = `${state.detail.submissionId} · revision ${state.detail.revision} · ${state.detail.canonicalUrl}`;
    elements.retireDialog.showModal();
  }

  async function retireSubmission(event) {
    event.preventDefault();
    if (!state.detail || state.mode !== "submissions") return;
    const submission = state.detail;
    const reasonCode = elements.retireReason.value;
    setBusy(true);
    try {
      const path = endpoints.retire(submission.submissionId);
      const clientRequestId = randomId("xreq");
      const idempotencyKey = randomId("xidem");
      const hash = await requestHash({
        path,
        resourceId: submission.submissionId,
        expectedRevision: submission.revision,
        bodyWithoutMeta: { reasonCode }
      });
      const meta = {
        idempotencyKey,
        expectedRevision: submission.revision,
        requestHash: hash,
        clientRequestId
      };
      const fullMutation = { submissionId: submission.submissionId, meta, reasonCode };
      const expectedOperationId = await operationId("retire", clientRequestId);
      const freshReceipt = await freshReauth(fullMutation);
      const csrfToken = await csrf("x-retire", fullMutation, path, expectedOperationId);
      const result = requireSchema(await requestJson(path, {
        method: "POST",
        headers: {
          "Idempotency-Key": idempotencyKey,
          "X-CSRF-Token": csrfToken,
          "X-F1-Fresh-Reauth": freshReceipt
        },
        body: { meta, reasonCode }
      }), ORIGIN_SCHEMA);
      if (!isObject(result.submission) || result.submission.state !== "retired") {
        throw new AdminUiError("退役结果无法校验", { reasonCode: "ADMIN_RESPONSE_INVALID" });
      }
      elements.retireDialog.close();
      toast("投稿已退役");
      await loadList({ selectId: submission.submissionId });
    } catch (error) {
      elements.retireDialog.close();
      elements.operationStatus.hidden = false;
      elements.operationStatus.className = "operation-status is-error";
      elements.operationStatus.textContent = error.uncertain
        ? `${errorCopy(error)} 结果未知，请先刷新详情，禁止直接重复退役。`
        : errorCopy(error);
      if (error instanceof AdminUiError && error.status === 401) showAuth(error);
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    setTheme(initialTheme());
    const route = parseRoute();
    configureMode(route.mode);
    if (route.invalid) {
      showApp();
      showListState("error", "Admin 路径无效");
      showDetailState("页面不存在", "请从 X 信源或人工投稿列表重新进入。");
      return;
    }
    await loadList({ selectId: route.detailId });
  }

  elements.themeToggle.addEventListener("click", () => setTheme(elements.root.dataset.theme === "dark" ? "light" : "dark"));
  elements.loginPasskey.addEventListener("click", async () => {
    elements.loginPasskey.disabled = true;
    try {
      await login();
      await start();
    } catch (error) {
      showAuth(error);
    } finally {
      elements.loginPasskey.disabled = false;
    }
  });
  elements.refreshList.addEventListener("click", () => loadList({ selectId: state.selectedId }));
  elements.listSearch.addEventListener("input", renderList);
  elements.submitForm.addEventListener("submit", submitManualUrl);
  elements.mobileBack.addEventListener("click", () => {
    const base = state.mode === "sources" ? "/admin/sources" : "/admin/x-submissions";
    window.history.pushState({}, "", base);
    elements.root.dataset.mobileView = "list";
    state.selectedId = null;
    state.detail = null;
    renderList();
    renderDetail();
  });
  elements.detailRetry.addEventListener("click", () => state.detailRetryAction?.());
  elements.retireCancel.addEventListener("click", () => elements.retireDialog.close());
  elements.retireForm.addEventListener("submit", retireSubmission);
  window.addEventListener("popstate", start);

  void start();
})();
