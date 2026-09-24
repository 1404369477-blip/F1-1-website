(() => {
  "use strict";

  const SETTINGS_SCHEMA = "admin-refinement-model-v1";
  const CSRF_SCHEMA = "admin-bilingual-v1";
  const PATH = "/api/admin/settings/refinement-model";
  const endpoints = Object.freeze({
    settings: PATH,
    csrf: "/api/admin/csrf",
    loginOptions: "/api/admin/auth/login/options",
    loginVerify: "/api/admin/auth/login/verify",
    freshOptions: "/api/admin/auth/fresh/options",
    freshVerify: "/api/admin/auth/fresh/verify",
    credentials: "/api/admin/settings/model-credentials"
  });

  const elementIds = [
    "connection-state", "theme-toggle", "auth-view", "auth-status", "auth-actions", "login-passkey",
    "app-view", "toast", "current-model-name", "current-model-copy", "summary-status", "summary-hint",
    "model-deepseek-chat", "model-glm-5.3-flash", "deepseek-role", "glm-role", "deepseek-key-state",
    "glm-key-state", "deepseek-connection", "glm-connection", "settings-error", "retry-settings",
    "model-dialog", "dialog-title", "dialog-close", "footer-close", "detail-model-id", "detail-endpoint",
    "detail-symbol", "detail-active", "detail-purpose", "detail-connection-state", "detail-verified-at",
    "detail-key-updated", "key-badge", "support-note", "usage-copy", "stored-key", "key-editor", "new-key",
    "cancel-replacement", "replace-key", "test-current", "save-key", "toggle-key", "inline-message",
    "discard-notice", "keep-editing", "discard-changes", "select-model", "save-hint"
  ];
  const nodes = Object.fromEntries(elementIds.map((id) => [id, document.getElementById(id)]));
  const $ = (id) => nodes[id];
  const dialog = $("model-dialog");
  const elements = {
    root: document.documentElement,
    connectionState: $("connection-state"), themeToggle: $("theme-toggle"), authView: $("auth-view"),
    authStatus: $("auth-status"), authActions: $("auth-actions"), loginPasskey: $("login-passkey"),
    appView: $("app-view"), toast: $("toast")
  };

  class AdminUiError extends Error {
    constructor(message, options = {}) {
      super(message);
      this.name = "AdminUiError";
      this.status = options.status ?? 0;
      this.reasonCode = options.reasonCode ?? "ADMIN_UI_FAILURE";
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
      ADMIN_NETWORK_FAILURE: "Admin 服务连接中断，请检查私有网络后重试。",
      ADMIN_RESPONSE_INVALID: "Admin 服务响应无法校验，请刷新后重试。",
      ADMIN_PASSKEY_UNAVAILABLE: "当前浏览器不支持通行密钥。",
      ADMIN_PASSKEY_CANCELLED: "通行密钥验证已取消。",
      REFINEMENT_KEY_MISSING: "这个模型的密钥未配置，或文件格式、权限无效，不能保存。",
      REFINEMENT_MODEL_UNSUPPORTED: "这个模型尚未接入提炼，暂时不能保存。请选择已支持的模型。",
      ADMIN_SETTINGS_UNAVAILABLE: "设置目录还没准备好，不能改模型。",
      ADMIN_CSRF_REJECTED: "请求校验失败，请刷新后重试。",
      ADMIN_REAUTH_REQUIRED: "身份验证已失效，请重新使用通行密钥确认。",
      ADMIN_REQUEST_TIMEOUT: "请求超时，保存结果尚待确认。请重新读取设置后再操作。",
      CREDENTIAL_FORMAT_INVALID: "Key 格式无效，请检查后重试。",
      CREDENTIAL_KEY_MISSING: "请先配置这个模型的 API Key。",
      CREDENTIAL_PROVIDER_AUTH_REJECTED: "模型服务未接受此 Key，请检查密钥和服务权限。",
      CREDENTIAL_PROVIDER_TIMEOUT: "模型服务连接超时，请稍后重试。",
      CREDENTIAL_PROVIDER_RATE_LIMITED: "模型服务暂时限流，请稍后重试。",
      CREDENTIAL_PROVIDER_UNAVAILABLE: "暂时无法连接模型服务，请稍后重试。",
      CREDENTIAL_PROVIDER_REJECTED: "模型服务拒绝了验证请求，请检查模型权限和余额。",
      CREDENTIAL_PROVIDER_RESPONSE_INVALID: "模型服务响应无法校验，请稍后重试。",
      CREDENTIAL_REVISION_CONFLICT: "配置已在另一处更新。已重新读取，请核对后再操作。",
      CREDENTIAL_SAVE_FAILED: "保存失败，原配置保留，请稍后重试。",
      CREDENTIAL_COMMIT_UNKNOWN: "保存结果尚待确认，正在重新读取当前配置。",
      CREDENTIAL_STORAGE_UNSAFE: "密钥存储无法通过安全检查，请查看运行状态。",
      CREDENTIAL_NETWORK_DISABLED: "当前运行版本已暂停模型外联，暂时不能验证或更换 Key。",
      CREDENTIAL_BUSY: "这个模型正在处理另一项操作，请稍后重试。",
      MODEL_KEY_INVALID: "Key 格式无效，请检查后重试。",
      MODEL_CONNECTION_REJECTED: "模型服务未接受此 Key，请检查密钥和服务权限。",
      MODEL_CONNECTION_TIMEOUT: "模型服务连接超时，请稍后重试。",
      MODEL_CONNECTION_FAILED: "暂时无法验证模型连接，请稍后重试。",
      MODEL_CREDENTIAL_CONFLICT: "配置已在另一处更新。已重新读取，请核对后再操作。",
      MODEL_CREDENTIAL_SAVE_FAILED: "保存失败，请重新读取配置并确认 Key 更新时间。",
      RECOVERY_FENCE_REJECTED: "当前恢复条件未满足，暂时无法保存，请稍后重试。"
    };
    return known[code] ?? `操作失败（${code}）`;
  }

  async function requestJson(path, options = {}) {
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = window.setTimeout(() => {
        controller.abort();
        reject(new AdminUiError("请求超时", { reasonCode: "ADMIN_REQUEST_TIMEOUT" }));
      }, 8000);
    });
    try {
      return await Promise.race([(async () => {
        let response;
        try {
          response = await window.fetch(path, {
            method: options.method ?? "GET", credentials: "same-origin", cache: "no-store", redirect: "error",
            signal: controller.signal,
            headers: { Accept: "application/json", ...(options.body === undefined ? {} : { "Content-Type": "application/json" }), ...(options.headers ?? {}) },
            body: options.body === undefined ? undefined : JSON.stringify(options.body)
          });
        } catch {
          throw new AdminUiError("连接中断", { reasonCode: controller.signal.aborted ? "ADMIN_REQUEST_TIMEOUT" : "ADMIN_NETWORK_FAILURE" });
        }
        let payload;
        try { payload = await response.json(); } catch {
          throw new AdminUiError("响应无法解析", { status: response.status, reasonCode: response.status === 401 ? "ADMIN_SESSION_REQUIRED" : "ADMIN_RESPONSE_INVALID" });
        }
        if (!response.ok) {
          const reasonCode = isObject(payload) && typeof payload.reasonCode === "string" ? payload.reasonCode : `HTTP_${response.status}`;
          throw new AdminUiError(reasonCode, { status: response.status, reasonCode });
        }
        return payload;
      })(), timeout]);
    } finally { window.clearTimeout(timer); }
  }

  function canonicalJsonUi(value) {
    if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
    if (typeof value === "number") {
      if (!Number.isSafeInteger(value) || Object.is(value, -0)) throw new AdminUiError("请求包含非规范数字", { reasonCode: "ADMIN_REQUEST_INVALID" });
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) return `[${value.map(canonicalJsonUi).join(",")}]`;
    if (!isObject(value)) throw new AdminUiError("请求无法规范化", { reasonCode: "ADMIN_REQUEST_INVALID" });
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJsonUi(value[key])}`).join(",")}}`;
  }

  async function sha256Hex(value) {
    const digest = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function randomId(prefix) {
    const bytes = new Uint8Array(12);
    window.crypto.getRandomValues(bytes);
    return `${prefix}_${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
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
    let credential;
    try { credential = await navigator.credentials.get({ publicKey: requestOptionsFromJson(publicKey) }); }
    catch { throw new AdminUiError("通行密钥验证已取消", { reasonCode: "ADMIN_PASSKEY_CANCELLED" }); }
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
    elements.toast.classList.add("visible");
    window.clearTimeout(toast.timer);
    toast.timer = window.setTimeout(() => elements.toast.classList.remove("visible"), 2600);
  }

  function showAuth(error) {
    closeDetails();
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

  let snapshot = null;
  let credentialsSnapshot = null;
  let selectedId = null;
  let editing = false;
  let busy = false;
  let generation = 0;

  function current() {
    return snapshot?.catalog.find((item) => item.modelId === selectedId) ?? null;
  }

  function dateCopy(value, fallback = "未记录") {
    if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return fallback;
    return new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "medium" }).format(new Date(value));
  }

  function connectionCopy(item) {
    if (item.connection?.status === "passed") return "最近验证通过";
    if (item.connection?.status === "failed") return "最近验证失败";
    return "未验证";
  }

  function connectionTone(item) {
    return item.connection?.status === "passed" ? "success" : item.connection?.status === "failed" ? "error" : "neutral";
  }

  function message(copy, tone = "") {
    $("inline-message").hidden = !copy;
    $("inline-message").textContent = copy;
    $("inline-message").className = `inline-message ${tone}`;
  }

  function clearInput() {
    $("new-key").value = "";
    $("new-key").type = "password";
    $("toggle-key").textContent = "显示";
    $("toggle-key").setAttribute("aria-label", "显示本次输入的 Key");
  }

  function setBusy(value) {
    busy = value;
    const model = current();
    const typed = $("new-key").value.trim().length > 0;
    $("save-key").disabled = value || !typed;
    $("test-current").disabled = value || (editing ? !typed : model?.keyPresent !== true);
    for (const id of ["new-key", "replace-key", "cancel-replacement", "select-model", "toggle-key", "discard-changes", "keep-editing"]) $(id).disabled = value;
    $("save-key").textContent = value ? "正在处理…" : "验证并保存";
  }

  function renderCards() {
    const active = snapshot.catalog.find((item) => item.modelId === snapshot.current.modelId);
    if (!active) throw new AdminUiError("当前模型无效", { reasonCode: "ADMIN_RESPONSE_INVALID" });
    $("current-model-name").textContent = active.displayName;
    $("current-model-copy").textContent = active.persistSupported ? "后续中文提炼读取当前模型与已保存的 Key。" : "当前保存的模型暂不能用于提炼，请选择已支持的模型。";
    $("summary-status").textContent = active.keyPresent ? `已配置 · ${connectionCopy(active)}` : "未配置有效 Key";
    $("summary-status").className = `status ${connectionTone(active)}`;
    $("summary-hint").textContent = active.connection?.verifiedAt ? `最近验证：${dateCopy(active.connection.verifiedAt)}` : "尚未完成连接验证。";
    for (const [prefix, id] of [["deepseek", "deepseek-chat"], ["glm", "glm-5.3-flash"]]) {
      const item = snapshot.catalog.find((entry) => entry.modelId === id);
      $("model-" + id).disabled = !item;
      if (!item) continue;
      $(prefix + "-key-state").textContent = item.keyPresent ? "已配置" : "未配置有效 Key";
      $(prefix + "-connection").textContent = connectionCopy(item);
      $(prefix + "-role").textContent = !item.persistSupported ? "尚未接入" : snapshot.current.modelId === id ? "当前使用" : "可使用";
      $(prefix + "-role").className = `pill ${snapshot.current.modelId === id && item.persistSupported ? "active" : ""}`;
    }
  }

  function renderDetails() {
    const model = current();
    if (!model) return;
    const glm = model.modelId === "glm-5.3-flash";
    $("dialog-title").textContent = model.displayName;
    $("detail-model-id").textContent = model.modelId;
    $("detail-endpoint").textContent = model.endpointHost;
    $("detail-symbol").textContent = glm ? "G" : "D";
    $("detail-symbol").className = `model-symbol ${glm ? "violet" : "blue"}`;
    $("detail-active").textContent = !model.persistSupported ? "尚未接入" : snapshot.current.modelId === model.modelId ? "当前使用" : "可使用";
    $("detail-active").className = `pill ${model.persistSupported && snapshot.current.modelId === model.modelId ? "active" : ""}`;
    $("detail-purpose").textContent = model.persistSupported ? "中文标题、摘要与要点提炼" : "可提前配置，暂不能用于生产";
    $("detail-connection-state").textContent = connectionCopy(model);
    $("detail-connection-state").className = `status ${connectionTone(model)}`;
    $("detail-verified-at").textContent = dateCopy(model.connection?.verifiedAt, "尚未验证");
    $("detail-key-updated").textContent = dateCopy(model.keyUpdatedAt);
    $("key-badge").textContent = model.keyPresent ? "已配置" : "未配置";
    $("support-note").hidden = model.persistSupported;
    $("usage-copy").textContent = model.persistSupported ? "保存后，后续中文提炼会读取新 Key。已完成的草稿保留原结果；审核和发布继续遵循运行页配置。" : "可以提前配置并验证 Key。此模型尚未接入提炼，保存 Key 后当前模型保持原选择。";
    $("stored-key").hidden = editing || !model.keyPresent;
    $("key-editor").hidden = !editing && model.keyPresent;
    $("cancel-replacement").hidden = !model.keyPresent;
    $("test-current").textContent = editing ? "验证本次输入" : "验证当前连接 ↗";
    $("select-model").hidden = !model.persistSupported || snapshot.current.modelId === model.modelId;
    $("save-hint").textContent = "保存前需要使用通行密钥确认身份。";
    setBusy(busy);
  }

  function acceptSnapshot(value) {
    requireSchema(value, SETTINGS_SCHEMA);
    if (!Array.isArray(value.catalog) || !isObject(value.current) || !value.catalog.every((item) =>
      isObject(item) && ["deepseek-chat", "glm-5.3-flash"].includes(item.modelId) && typeof item.displayName === "string" &&
      typeof item.endpointHost === "string" && typeof item.keyPresent === "boolean" && typeof item.persistSupported === "boolean")) {
      throw new AdminUiError("设置响应无效", { reasonCode: "ADMIN_RESPONSE_INVALID" });
    }
    snapshot = { ...value, catalog: value.catalog.map((item) => {
      const credential = credentialsSnapshot?.providers.find((entry) => entry.modelId === item.modelId);
      if (!credential) throw new AdminUiError("凭证状态缺失", { reasonCode: "ADMIN_RESPONSE_INVALID" });
      return { ...item, keyPresent: credential.keyConfigured, credentialRevision: credential.revision,
        keyUpdatedAt: credential.keyUpdatedAt, lastOperationId: credential.lastOperationId,
        connection: { status: credential.validation.status === "verified" ? "passed" : credential.validation.status,
          verifiedAt: credential.validation.checkedAt, reasonCode: credential.validation.reasonCode } };
    }) };
    renderCards();
  }

  async function loadSettings() {
    const [settings, credentialResult] = await Promise.allSettled([requestJson(endpoints.settings), requestJson(endpoints.credentials)]);
    // A session failure wins over secondary errors so credentials are cleared.
    for (const result of [settings, credentialResult]) if (result.status === "rejected" && result.reason instanceof AdminUiError && result.reason.status === 401) throw result.reason;
    for (const result of [settings, credentialResult]) if (result.status === "rejected") throw result.reason;
    const credentials = requireSchema(credentialResult.value, "admin-model-credentials-v1");
    if (!Array.isArray(credentials.providers) || !credentials.providers.every((item) => isObject(item) &&
      ["deepseek-chat", "glm-5.3-flash"].includes(item.modelId) && typeof item.keyConfigured === "boolean" &&
      (typeof item.revision === "string" || item.revision === null) && isObject(item.validation) &&
      ["unverified", "verified", "failed"].includes(item.validation.status))) {
      throw new AdminUiError("凭证状态无效", { reasonCode: "ADMIN_RESPONSE_INVALID" });
    }
    credentialsSnapshot = credentials;
    acceptSnapshot(settings.value);
    showApp();
    $("settings-error").textContent = "";
    $("retry-settings").hidden = true;
  }

  function openDetails(modelId, keyboard = false) {
    if (busy || !snapshot?.catalog.some((item) => item.modelId === modelId)) return;
    selectedId = modelId;
    generation++;
    clearInput();
    editing = !current().keyPresent;
    $("discard-notice").hidden = true;
    message("");
    renderDetails();
    dialog.classList.toggle("keyboard-open", keyboard);
    dialog.showModal();
  }

  function closeDetails() {
    generation++;
    clearInput();
    editing = false;
    busy = false;
    $("discard-notice").hidden = true;
    message("");
    if (dialog.open) dialog.close();
  }

  function requestClose() {
    if (busy) { message("正在处理本次请求，请稍候再关闭。"); return; }
    if ($("new-key").value) {
      $("discard-notice").hidden = false;
      $("keep-editing").focus();
    } else closeDetails();
  }

  async function prepareMutation(path, body) {
    const unsigned = { ...body, idempotencyKey: randomId("model"), clientRequestId: randomId("model-client") };
    return { ...unsigned, requestHash: await sha256Hex(canonicalJsonUi({ method: "POST", canonicalPath: path, body: unsigned })) };
  }

  async function mutate(path, mutation, freshRequired, isCurrent) {
    const assertCurrent = () => { if (!isCurrent()) throw new AdminUiError("操作已取消", { reasonCode: "ADMIN_OPERATION_CANCELLED" }); };
    assertCurrent();
    let freshReceipt;
    if (freshRequired) {
      const options = requireSchema(await requestJson(endpoints.freshOptions, {
        method: "POST", body: { schemaVersion: "admin-auth-fresh-options-v1", mutation }
      }), "admin-auth-fresh-options-v1");
      assertCurrent();
      const response = await getPasskey(options.publicKey);
      assertCurrent();
      const verified = requireSchema(await requestJson(endpoints.freshVerify, {
        method: "POST", body: { schemaVersion: "admin-auth-fresh-verify-v1", mutation, response }
      }), "admin-auth-fresh-verify-v1");
      if (typeof verified.freshReceipt !== "string") throw new AdminUiError("身份确认收据缺失", { reasonCode: "ADMIN_REAUTH_REQUIRED" });
      freshReceipt = verified.freshReceipt;
    }
    assertCurrent();
    // Fresh rotates the session. Obtain CSRF using the resulting cookie.
    const csrf = await requestJson(endpoints.csrf, { method: "POST", body: { schemaVersion: CSRF_SCHEMA, mutation } });
    if (typeof csrf.csrfToken !== "string") throw new AdminUiError("请求校验收据缺失", { reasonCode: "ADMIN_CSRF_REJECTED" });
    assertCurrent();
    return await requestJson(path, {
      method: "POST", body: mutation,
      headers: { "X-CSRF-Token": csrf.csrfToken, "Idempotency-Key": mutation.idempotencyKey, ...(freshReceipt ? { "x-f1-fresh-reauth": freshReceipt } : {}) }
    });
  }

  function validateCredentialResult(result, action, modelId, operationId, target) {
    requireSchema(result, "admin-model-credentials-v1");
    const credential = result.credential;
    const validation = result.validation;
    if (result.status !== "succeeded" || result.action !== action || result.modelId !== modelId ||
      result.operationId !== operationId || result.validationTarget !== target || !isObject(credential) ||
      credential.modelId !== modelId || typeof credential.keyConfigured !== "boolean" ||
      !(credential.revision === null || typeof credential.revision === "string" && /^[0-9a-f]{64}$/.test(credential.revision)) ||
      !isObject(validation) || validation.status !== "verified" || typeof validation.checkedAt !== "string" ||
      !Number.isFinite(Date.parse(validation.checkedAt)) || validation.reasonCode !== null ||
      (action === "replaceKey" && (!credential.keyConfigured || credential.revision === null ||
        credential.lastOperationId !== operationId || credential.validation?.status !== "verified" ||
        credential.validation?.checkedAt !== validation.checkedAt))) {
      throw new AdminUiError("连接验证响应无法校验", { reasonCode: "ADMIN_RESPONSE_INVALID" });
    }
    return result;
  }

  async function operate(action) {
    if (busy || !current()) return;
    const model = current();
    const newKey = $("new-key").value.trim();
    const replacing = action === "replaceKey";
    const selecting = action === "select";
    if (selecting && (!model.persistSupported || !model.keyPresent)) { message("此模型尚不具备生产提炼条件。", "error"); return; }
    if (!selecting && (replacing || editing) && !newKey) { message("请先输入新的 API Key。", "error"); $("new-key").focus(); return; }
    const token = ++generation;
    let committed = false;
    let attemptedOperationId = null;
    $("discard-notice").hidden = true;
    setBusy(true);
    message(selecting ? "正在保存当前模型…" : replacing ? "请确认身份，随后验证并保存新 Key。" : "正在验证模型连接…");
    try {
      const path = selecting ? PATH : endpoints.credentials;
      const body = selecting ? { schemaVersion: SETTINGS_SCHEMA, modelId: model.modelId } : {
        schemaVersion: "admin-model-credential-mutation-v1", action, modelId: model.modelId, expectedRevision: model.credentialRevision,
        ...((replacing || editing) ? { apiKey: newKey } : {})
      };
      const mutation = await prepareMutation(path, body);
      attemptedOperationId = `credential_${(await sha256Hex(mutation.idempotencyKey)).slice(0, 32)}`;
      const result = await mutate(path, mutation, !selecting, () => token === generation && dialog.open);
      if (token !== generation) return;
      if (!selecting && result.status !== "succeeded") {
        throw new AdminUiError("模型连接未通过", { reasonCode: typeof result.reasonCode === "string" ? result.reasonCode : "MODEL_CONNECTION_FAILED" });
      }
      if (!selecting) validateCredentialResult(result, action, model.modelId, attemptedOperationId, !replacing && editing ? "input" : "saved");
      if (!selecting && result.validationTarget === "saved") {
        const updated = result.credential;
        credentialsSnapshot = { ...credentialsSnapshot, providers: credentialsSnapshot.providers.map((item) => item.modelId === updated.modelId ? updated : item) };
        acceptSnapshot(snapshot);
        renderDetails();
      }
      if (selecting) {
        acceptSnapshot(result);
        renderDetails();
        message("当前提炼模型已保存，后续任务读取此配置。", "success");
      } else if (replacing) {
        committed = true;
        clearInput();
        editing = false;
        // A successful mutation remains successful if the follow-up read fails.
        message("新 Key 已保存，正在刷新连接状态。", "success");
        await loadSettings();
        if (token !== generation) return;
        renderDetails();
        message("新 Key 验证通过并已保存，本次输入已清空。", "success");
        toast("模型连接已更新");
      } else if (editing) {
        message("本次输入验证通过。新 Key 尚未保存。", "success");
      } else {
        await loadSettings();
        if (token !== generation) return;
        renderDetails();
        message("当前 Key 连接验证通过。", "success");
      }
    } catch (error) {
      if (token !== generation) return;
      if (error instanceof AdminUiError && error.status === 401) { showAuth(error); return; }
      const unknown = error instanceof AdminUiError && ["ADMIN_REQUEST_TIMEOUT", "ADMIN_NETWORK_FAILURE", "ADMIN_RESPONSE_INVALID", "CREDENTIAL_COMMIT_UNKNOWN", "CREDENTIAL_REVISION_CONFLICT", "MODEL_CREDENTIAL_CONFLICT"].includes(error.reasonCode);
      const storedTestFailed = action === "test" && !editing && error instanceof AdminUiError && error.reasonCode.startsWith("CREDENTIAL_PROVIDER_");
      if (unknown || storedTestFailed) {
        try { await loadSettings(); } catch (refreshError) {
          if (refreshError instanceof AdminUiError && refreshError.status === 401) { showAuth(refreshError); return; }
          $("retry-settings").hidden = false;
        }
        if (token !== generation) return;
        if (replacing && current()?.lastOperationId === attemptedOperationId) {
          committed = true;
          clearInput();
          editing = false;
          renderDetails();
          message("已从当前配置确认本次 Key 保存成功，本次输入已清空。", "success");
          return;
        }
        renderDetails();
      }
      message(committed ? "新 Key 已保存，本次输入已清空；最新状态暂时读不到，请重新读取设置。" : errorCopy(error), committed ? "" : "error");
      if (committed) $("retry-settings").hidden = false;
    } finally { if (token === generation) setBusy(false); }
  }

  async function start() {
    setTheme(initialTheme());
    try { await loadSettings(); }
    catch (error) {
      if (error instanceof AdminUiError && error.status === 401) { showAuth(error); return; }
      showApp();
      $("settings-error").textContent = errorCopy(error);
      $("retry-settings").hidden = false;
    }
  }

  elements.themeToggle.addEventListener("click", () => setTheme(elements.root.dataset.theme === "dark" ? "light" : "dark"));
  elements.loginPasskey.addEventListener("click", async () => {
    elements.loginPasskey.disabled = true;
    try { await login(); await loadSettings(); } catch (error) { showAuth(error); }
    finally { elements.loginPasskey.disabled = false; }
  });
  for (const modelId of ["deepseek-chat", "glm-5.3-flash"]) $("model-" + modelId).addEventListener("click", (event) => openDetails(modelId, event.detail === 0));
  for (const id of ["dialog-close", "footer-close"]) $(id).addEventListener("click", requestClose);
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); requestClose(); });
  $("discard-changes").addEventListener("click", closeDetails);
  $("keep-editing").addEventListener("click", () => { $("discard-notice").hidden = true; $("new-key").focus(); });
  $("replace-key").addEventListener("click", () => { editing = true; message(""); renderDetails(); $("new-key").focus(); });
  $("cancel-replacement").addEventListener("click", () => { generation++; clearInput(); editing = false; message(""); renderDetails(); $("replace-key").focus(); });
  $("new-key").addEventListener("input", () => { message(""); setBusy(false); });
  $("toggle-key").addEventListener("click", () => {
    const show = $("new-key").type === "password";
    $("new-key").type = show ? "text" : "password";
    $("toggle-key").textContent = show ? "隐藏" : "显示";
    $("toggle-key").setAttribute("aria-label", show ? "隐藏本次输入的 Key" : "显示本次输入的 Key");
  });
  $("test-current").addEventListener("click", () => { void operate("test"); });
  $("save-key").addEventListener("click", () => { void operate("replaceKey"); });
  $("select-model").addEventListener("click", () => { void operate("select"); });
  $("retry-settings").addEventListener("click", () => { void start(); });
  function fitVisualViewport() {
    const height = window.visualViewport?.height;
    if (typeof height === "number" && Number.isFinite(height) && height > 0) {
      elements.root.style.setProperty("--model-viewport-height", `${height}px`);
    }
  }
  window.visualViewport?.addEventListener("resize", fitVisualViewport);
  fitVisualViewport();
  window.addEventListener("pagehide", closeDetails);
  window.addEventListener("pageshow", (event) => { if (event.persisted) void start(); });
  void start();
})();
