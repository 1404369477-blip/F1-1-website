(() => {
  "use strict";

  const REGISTRY_SCHEMA = "admin-source-registry-v1";
  const OVERVIEW_SCHEMA = "admin-operations-overview-v1";
  const X_SCHEMA = "admin-x-manual-v1";
  const SHANGHAI = "Asia/Shanghai";
  const endpoints = Object.freeze({
    sources: "/api/admin/sources",
    overview: "/api/admin/operations/overview",
    xSources: "/api/admin/x-sources",
    loginOptions: "/api/admin/auth/login/options",
    loginVerify: "/api/admin/auth/login/verify"
  });

  const elements = Object.freeze({
    root: document.documentElement,
    connectionState: document.querySelector("#connection-state"),
    themeToggle: document.querySelector("#theme-toggle"),
    authView: document.querySelector("#auth-view"),
    authStatus: document.querySelector("#auth-status"),
    authActions: document.querySelector("#auth-actions"),
    loginPasskey: document.querySelector("#login-passkey"),
    appView: document.querySelector("#app-view"),
    title: document.querySelector("#src-title"),
    asOf: document.querySelector("#src-as-of"),
    flag: document.querySelector("#src-flag"),
    flagText: document.querySelector("#src-flag-text"),
    heroTitle: document.querySelector("#src-hero-title"),
    heroCopy: document.querySelector("#src-hero-copy"),
    metricValue: document.querySelector("#src-metric-value"),
    metricHint: document.querySelector("#src-metric-hint"),
    rssSummary: document.querySelector("#src-rss-summary"),
    rssList: document.querySelector("#src-rss-list"),
    rssEmpty: document.querySelector("#src-rss-empty"),
    xSummary: document.querySelector("#src-x-summary"),
    xList: document.querySelector("#src-x-list"),
    xEmpty: document.querySelector("#src-x-empty"),
    toast: document.querySelector("#toast")
  });

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
      ADMIN_PASSKEY_CANCELLED: "通行密钥验证已取消。"
    };
    return known[code] ?? `读取失败（${code}）`;
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
          ...(options.body === undefined ? {} : { "Content-Type": "application/json" })
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body)
      });
    } catch {
      throw new AdminUiError("Admin 服务连接中断", { reasonCode: "ADMIN_NETWORK_FAILURE" });
    }
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new AdminUiError("Admin 服务返回了不可解析响应", {
        status: response.status,
        reasonCode: "ADMIN_RESPONSE_INVALID"
      });
    }
    if (!response.ok) {
      const reasonCode = isObject(payload) && typeof payload.reasonCode === "string"
        ? payload.reasonCode
        : `HTTP_${response.status}`;
      throw new AdminUiError(reasonCode, { status: response.status, reasonCode });
    }
    return payload;
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

  function shanghaiParts(iso) {
    const date = new Date(iso);
    if (!Number.isFinite(date.getTime())) return null;
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: SHANGHAI,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).formatToParts(date);
    const pick = (type) => Number(parts.find((part) => part.type === type)?.value);
    const hour = parts.find((part) => part.type === "hour")?.value;
    const minute = parts.find((part) => part.type === "minute")?.value;
    const year = pick("year");
    const month = pick("month");
    const day = pick("day");
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
    return { year, month, day, hour, minute };
  }

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function formatAsOf(iso) {
    const parts = shanghaiParts(iso);
    if (!parts) return "—";
    return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)} ${parts.hour}:${parts.minute}`;
  }

  function hostLabel(value) {
    if (typeof value !== "string" || value.trim().length === 0) return "";
    try {
      return new URL(value).hostname.replace(/^www\./u, "");
    } catch {
      return "";
    }
  }

  function itemsOf(payload) {
    return Array.isArray(payload.items) ? payload.items.filter((item) => isObject(item)) : [];
  }

  function displayName(item) {
    if (typeof item.displayName === "string" && item.displayName.trim()) return item.displayName.trim();
    if (typeof item.handle === "string" && item.handle.trim()) return `@${item.handle.replace(/^@/u, "")}`;
    return String(item.sourceId ?? "未命名");
  }

  function appendRow(list, item, href, copy) {
    const row = href ? document.createElement("a") : document.createElement("div");
    row.className = "ops-source-row";
    if (href) row.href = href;
    const title = document.createElement("strong");
    title.textContent = displayName(item);
    const meta = document.createElement("span");
    meta.textContent = copy;
    row.append(title, meta);
    list.append(row);
  }

  function rssCopy(item, collectionLive) {
    if (item.enabled === true) {
      return collectionLive ? "已接入，可以进流水线" : "已接入，现在没在抓";
    }
    return "已停用";
  }

  function showUnreadRoster() {
    elements.flag.className = "ops-flag";
    elements.flagText.textContent = "读不到";
    elements.title.textContent = "这页暂时读不到信源";
    elements.heroTitle.textContent = "先不要把下面当成现在的状态";
    elements.heroCopy.textContent = "不是网站挂了。请稍后刷新。";
    elements.metricValue.textContent = "—";
    elements.rssList.replaceChildren();
    elements.xList.replaceChildren();
    elements.rssEmpty.hidden = true;
    elements.xEmpty.hidden = true;
    elements.rssSummary.hidden = false;
    elements.xSummary.hidden = false;
    elements.rssSummary.textContent = "还没读到新闻源。";
    elements.xSummary.textContent = "还没读到车手账号。";
  }

  function renderRoster(registry, overview, xDirectory) {
    const generatedAt = isObject(overview) && typeof overview.generatedAt === "string" ? overview.generatedAt : null;
    const collectionLive = isObject(overview) && isObject(overview.pipeline) && overview.pipeline.collectionLive === true;
    const registryItems = itemsOf(registry);
    const rss = registryItems.filter((item) => item.sourceKind === "rss");
    const registryX = registryItems.filter((item) => item.sourceKind === "x_manual");
    const directory = xDirectory === null ? null : itemsOf(xDirectory);
    const xItems = directory !== null ? directory : registryX;
    const rssEnabled = rss.filter((item) => item.enabled === true).length;

    elements.asOf.textContent = generatedAt ? formatAsOf(generatedAt) : "—";
    elements.title.textContent = "新闻源和车手账号分开看";
    elements.flag.className = "ops-flag is-ok";
    elements.flagText.textContent = "只读名册";
    elements.heroTitle.textContent = "新闻源可以进流水线，车手 X 只是通讯录";
    elements.heroCopy.textContent = collectionLive
      ? "新闻网站可以进流水线。车手账号只是通讯录，不会自动抓。"
      : "新闻网站已经接入，但总闸现在没开所以没在抓。车手账号只是通讯录，本来就不会自动抓。";
    elements.metricValue.textContent = String(rssEnabled);
    elements.metricHint.textContent = "已接入的新闻网站";

    elements.rssList.replaceChildren();
    elements.xList.replaceChildren();
    elements.rssSummary.hidden = rss.length > 0;
    elements.rssEmpty.hidden = rss.length > 0;
    elements.xSummary.hidden = true;
    elements.xEmpty.hidden = xItems.length > 0;

    if (rss.length === 0) {
      elements.rssEmpty.hidden = false;
      elements.rssSummary.hidden = true;
    } else {
      elements.rssSummary.hidden = true;
      for (const item of rss) {
        const host = hostLabel(item.siteUrl);
        appendRow(elements.rssList, item, null, host ? `${rssCopy(item, collectionLive)} · ${host}` : rssCopy(item, collectionLive));
      }
    }

    if (directory === null && registryX.length === 0) {
      elements.xEmpty.hidden = false;
      elements.xSummary.hidden = false;
      elements.xSummary.textContent = "正式名单里还没有车手账号。";
    } else if (xItems.length === 0) {
      elements.xEmpty.hidden = false;
    } else {
      elements.xSummary.hidden = false;
      elements.xSummary.textContent = `${xItems.length} 个账号 · 未采集`;
      for (const item of xItems) {
        const sourceId = typeof item.sourceId === "string" ? item.sourceId : "";
        const href = sourceId ? `/admin/x-accounts/${encodeURIComponent(sourceId)}` : null;
        appendRow(elements.xList, item, href, "通讯录 · 未采集");
      }
    }
  }

  async function optionalGet(path, schemaVersion) {
    try {
      return requireSchema(await requestJson(path), schemaVersion);
    } catch (error) {
      if (error instanceof AdminUiError && error.status === 401) throw error;
      return null;
    }
  }

  async function loadRoster() {
    const sourcesPayload = await requestJson(endpoints.sources);
    let registry;
    let xFromList = null;
    if (isObject(sourcesPayload) && sourcesPayload.schemaVersion === REGISTRY_SCHEMA) {
      registry = sourcesPayload;
    } else if (isObject(sourcesPayload) && sourcesPayload.schemaVersion === X_SCHEMA) {
      registry = { schemaVersion: REGISTRY_SCHEMA, items: [] };
      xFromList = sourcesPayload;
    } else {
      throw new AdminUiError("Admin API 响应格式无效", { reasonCode: "ADMIN_RESPONSE_INVALID" });
    }
    const overview = await optionalGet(endpoints.overview, OVERVIEW_SCHEMA);
    const xDirectory = xFromList ?? await optionalGet(endpoints.xSources, X_SCHEMA);
    showApp();
    renderRoster(registry, overview, xDirectory);
  }

  async function start() {
    setTheme(initialTheme());
    try {
      await loadRoster();
    } catch (error) {
      if (error instanceof AdminUiError && error.status === 401) {
        showAuth(error);
        return;
      }
      showApp();
      showUnreadRoster();
      toast(errorCopy(error));
    }
  }

  elements.themeToggle.addEventListener("click", () => setTheme(elements.root.dataset.theme === "dark" ? "light" : "dark"));
  elements.loginPasskey.addEventListener("click", async () => {
    elements.loginPasskey.disabled = true;
    try {
      await login();
      await loadRoster();
    } catch (error) {
      showAuth(error);
    } finally {
      elements.loginPasskey.disabled = false;
    }
  });

  void start();
})();
