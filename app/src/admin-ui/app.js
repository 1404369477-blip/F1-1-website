(function () {
  "use strict";

  const ENDPOINTS = Object.freeze({
    reviews: "/api/admin/reviews",
    csrf: "/api/admin/csrf",
    operation: (operationId) => `/api/admin/operations/${encodeURIComponent(operationId)}`,
    delivery: (deliveryId) => `/api/admin/deliveries/${encodeURIComponent(deliveryId)}`,
    detail: (candidateId) => `/api/admin/reviews/${encodeURIComponent(candidateId)}`,
    revision: (candidateId) => `/api/admin/reviews/${encodeURIComponent(candidateId)}/revision`,
    approve: (candidateId) => `/api/admin/reviews/${encodeURIComponent(candidateId)}/approve`,
    reject: (candidateId) => `/api/admin/reviews/${encodeURIComponent(candidateId)}/reject`,
    publish: (publicId) => `/api/admin/publications/${encodeURIComponent(publicId)}/publish`,
    bootstrapOptions: "/api/admin/auth/bootstrap/options",
    bootstrapVerify: "/api/admin/auth/bootstrap/verify",
    loginOptions: "/api/admin/auth/login/options",
    loginVerify: "/api/admin/auth/login/verify",
    freshOptions: "/api/admin/auth/fresh/options",
    freshVerify: "/api/admin/auth/fresh/verify"
  });

  const REVIEW_SCHEMA = "admin-review-v0.2";
  const FIXTURE_KEY = "review-ui-v1";
  const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
  const searchParams = new URLSearchParams(window.location.search);
  const fixtureRequested = searchParams.get("fixture") === FIXTURE_KEY;
  const fixtureAllowed = window.location.protocol === "file:" || LOOPBACK_HOSTS.has(window.location.hostname);
  const fixtureMode = fixtureRequested && fixtureAllowed;

  const elements = Object.freeze({
    root: document.documentElement,
    authView: document.querySelector("#auth-view"),
    authStatus: document.querySelector("#auth-status"),
    authActions: document.querySelector("#auth-actions"),
    loginPasskey: document.querySelector("#login-passkey"),
    showBootstrap: document.querySelector("#show-bootstrap"),
    bootstrapForm: document.querySelector("#bootstrap-form"),
    bootstrapToken: document.querySelector("#bootstrap-token"),
    cancelBootstrap: document.querySelector("#cancel-bootstrap"),
    appView: document.querySelector("#app-view"),
    environmentBadge: document.querySelector("#environment-badge"),
    connectionState: document.querySelector("#connection-state"),
    themeToggle: document.querySelector("#theme-toggle"),
    queueSummary: document.querySelector("#queue-summary"),
    queueSearch: document.querySelector("#queue-search"),
    refreshQueue: document.querySelector("#refresh-queue"),
    queueNotice: document.querySelector("#queue-notice"),
    queueList: document.querySelector("#queue-list"),
    mobileBack: document.querySelector("#mobile-back"),
    systemPanel: document.querySelector("#system-panel"),
    systemSymbol: document.querySelector("#system-symbol"),
    systemTitle: document.querySelector("#system-title"),
    systemCopy: document.querySelector("#system-copy"),
    systemAction: document.querySelector("#system-action"),
    detailContent: document.querySelector("#detail-content"),
    detailKicker: document.querySelector("#detail-kicker"),
    detailTitle: document.querySelector("#detail-title"),
    detailMeta: document.querySelector("#detail-meta"),
    integrityCard: document.querySelector("#integrity-card"),
    integrityTitle: document.querySelector("#integrity-title"),
    integrityCopy: document.querySelector("#integrity-copy"),
    sourceLink: document.querySelector("#source-link"),
    sourceExcerpt: document.querySelector("#source-excerpt"),
    sourceImage: document.querySelector("#source-image"),
    evidenceSource: document.querySelector("#evidence-source"),
    evidenceAuthor: document.querySelector("#evidence-author"),
    evidenceTime: document.querySelector("#evidence-time"),
    evidenceSourceRevision: document.querySelector("#evidence-source-revision"),
    evidenceBundle: document.querySelector("#evidence-bundle"),
    evidenceDelivery: document.querySelector("#evidence-delivery"),
    editorForm: document.querySelector("#editor-form"),
    editorBinding: document.querySelector("#editor-binding"),
    titleInput: document.querySelector("#title-input"),
    summaryInput: document.querySelector("#summary-input"),
    notesInput: document.querySelector("#notes-input"),
    titleCount: document.querySelector("#title-count"),
    summaryCount: document.querySelector("#summary-count"),
    notesCount: document.querySelector("#notes-count"),
    saveRevision: document.querySelector("#save-revision"),
    actionTitle: document.querySelector("#action-title"),
    actionCopy: document.querySelector("#action-copy"),
    actionStack: document.querySelector("#action-stack"),
    operationStatus: document.querySelector("#operation-status"),
    dialog: document.querySelector("#confirm-dialog"),
    dialogForm: document.querySelector("#dialog-form"),
    dialogTitle: document.querySelector("#dialog-title"),
    dialogCopy: document.querySelector("#dialog-copy"),
    dialogSummary: document.querySelector("#dialog-summary"),
    dialogCancel: document.querySelector("#dialog-cancel"),
    dialogConfirm: document.querySelector("#dialog-confirm"),
    rejectField: document.querySelector("#reject-field"),
    rejectReason: document.querySelector("#reject-reason"),
    rejectError: document.querySelector("#reject-error"),
    toast: document.querySelector("#toast"),
    fixtureWarning: document.querySelector("#fixture-warning")
  });

  const state = {
    adapter: null,
    items: [],
    detail: null,
    selectedId: null,
    dirty: false,
    busy: false,
    dialogAction: null,
    pendingNavigation: null,
    lastOperationId: null,
    lastPublicPath: null,
    drafts: new Map(),
    deliveryReceipts: new Map(),
    listScrollY: 0
  };

  class AdminUiError extends Error {
    constructor(message, options) {
      super(message);
      this.name = "AdminUiError";
      this.status = options?.status ?? 0;
      this.reasonCode = options?.reasonCode ?? "ADMIN_UI_FAILURE";
      this.uncertain = options?.uncertain === true;
    }
  }

  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function requireObject(value, label) {
    if (!isObject(value)) throw new AdminUiError(`${label} 响应格式无效`, { reasonCode: "ADMIN_RESPONSE_INVALID" });
    return value;
  }

  function requireSchema(value, schemaVersion) {
    const object = requireObject(value, "Admin API");
    if (object.schemaVersion !== schemaVersion) {
      throw new AdminUiError("Admin API schemaVersion 不匹配", { reasonCode: "ADMIN_RESPONSE_INVALID" });
    }
    return object;
  }

  function requireDeliveryReceipt(value, deliveryId) {
    const receipt = requireSchema(value, "admin-public-projection-receipt-v1");
    const hashPattern = /^[0-9a-f]{64}$/;
    const deliveryPattern = /^op-snapshot-[0-9a-f]{64}$/;
    const validTimestamp = (timestamp) => typeof timestamp === "string" && Number.isFinite(Date.parse(timestamp));
    const validShape = deliveryPattern.test(deliveryId) &&
      receipt.deliveryId === deliveryId &&
      hashPattern.test(receipt.snapshotManifestHash) &&
      Number.isInteger(receipt.snapshotGeneration) && receipt.snapshotGeneration > 0 &&
      ["active", "superseded"].includes(receipt.status) &&
      Number.isInteger(receipt.activeSnapshotGeneration) && receipt.activeSnapshotGeneration >= 0 &&
      (receipt.activeSnapshotManifestHash === null || hashPattern.test(receipt.activeSnapshotManifestHash)) &&
      receipt.reasonCode === null && validTimestamp(receipt.receivedAt) && validTimestamp(receipt.activatedAt);
    const validBinding = receipt.status === "active"
      ? receipt.activeSnapshotGeneration === receipt.snapshotGeneration && receipt.activeSnapshotManifestHash === receipt.snapshotManifestHash
      : receipt.activeSnapshotGeneration >= receipt.snapshotGeneration && receipt.activeSnapshotManifestHash !== null && receipt.activeSnapshotManifestHash !== receipt.snapshotManifestHash;
    if (!validShape || !validBinding) {
      throw new AdminUiError("投递收据与当前 delivery 不匹配", { reasonCode: "ADMIN_DELIVERY_RECEIPT_INVALID" });
    }
    return receipt;
  }

  function safeString(value, fallback = "—") {
    return typeof value === "string" && value.length > 0 ? value : fallback;
  }

  function formatTime(value) {
    if (typeof value !== "string") return "无来源时间";
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "无来源时间";
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(date);
  }

  function codePointLength(value) {
    return [...value].length;
  }

  function normalizeText(value) {
    return String(value).replace(/\r\n?/g, "\n").trim();
  }

  function createButton(label, className, action, disabled = false) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.disabled = disabled;
    button.addEventListener("click", action);
    return button;
  }

  function toast(message) {
    elements.toast.textContent = message;
    elements.toast.classList.add("is-visible");
    window.clearTimeout(toast.timer);
    toast.timer = window.setTimeout(() => elements.toast.classList.remove("is-visible"), 2400);
  }

  function setTheme(theme) {
    const resolved = theme === "light" ? "light" : "dark";
    elements.root.dataset.theme = resolved;
    elements.themeToggle.textContent = resolved === "dark" ? "深" : "浅";
    elements.themeToggle.setAttribute("aria-label", `当前${resolved === "dark" ? "深色" : "浅色"}主题，切换主题`);
    try {
      window.localStorage.setItem("f1-admin-theme", resolved);
    } catch {
      // Theme persistence is optional; the visible state remains authoritative.
    }
  }

  function initialTheme() {
    const queryTheme = searchParams.get("theme");
    if (queryTheme === "dark" || queryTheme === "light") return queryTheme;
    try {
      const stored = window.localStorage.getItem("f1-admin-theme");
      if (stored === "dark" || stored === "light") return stored;
    } catch {
      // Fall through to the system preference.
    }
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
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
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: options.signal
      });
    } catch {
      throw new AdminUiError("Admin 服务连接中断，操作结果可能未知", {
        reasonCode: "ADMIN_NETWORK_FAILURE",
        uncertain: options.method === "POST"
      });
    }
    let payload = null;
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

  function creationOptionsFromJson(publicKey) {
    if (typeof window.PublicKeyCredential?.parseCreationOptionsFromJSON === "function") {
      return window.PublicKeyCredential.parseCreationOptionsFromJSON(publicKey);
    }
    return {
      ...publicKey,
      challenge: base64UrlToBuffer(publicKey.challenge),
      user: { ...publicKey.user, id: base64UrlToBuffer(publicKey.user.id) },
      excludeCredentials: Array.isArray(publicKey.excludeCredentials)
        ? publicKey.excludeCredentials.map((credential) => ({ ...credential, id: base64UrlToBuffer(credential.id) }))
        : undefined
    };
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
    if (typeof credential?.toJSON === "function") return credential.toJSON();
    const common = {
      id: credential.id,
      rawId: bufferToBase64Url(credential.rawId),
      type: credential.type,
      clientExtensionResults: credential.getClientExtensionResults()
    };
    if (typeof credential.authenticatorAttachment === "string") {
      common.authenticatorAttachment = credential.authenticatorAttachment;
    }
    const response = credential.response;
    if (response && "attestationObject" in response) {
      const registrationResponse = {
        clientDataJSON: bufferToBase64Url(response.clientDataJSON),
        attestationObject: bufferToBase64Url(response.attestationObject)
      };
      if (typeof response.getTransports === "function") registrationResponse.transports = response.getTransports();
      if (typeof response.getAuthenticatorData === "function") {
        const authenticatorData = response.getAuthenticatorData();
        if (authenticatorData) registrationResponse.authenticatorData = bufferToBase64Url(authenticatorData);
      }
      if (typeof response.getPublicKeyAlgorithm === "function") {
        const algorithm = response.getPublicKeyAlgorithm();
        if (Number.isInteger(algorithm)) registrationResponse.publicKeyAlgorithm = algorithm;
      }
      if (typeof response.getPublicKey === "function") {
        const publicKey = response.getPublicKey();
        if (publicKey) registrationResponse.publicKey = bufferToBase64Url(publicKey);
      }
      return { ...common, response: registrationResponse };
    }
    const authenticationResponse = {
      clientDataJSON: bufferToBase64Url(response.clientDataJSON),
      authenticatorData: bufferToBase64Url(response.authenticatorData),
      signature: bufferToBase64Url(response.signature)
    };
    if (response.userHandle) authenticationResponse.userHandle = bufferToBase64Url(response.userHandle);
    return { ...common, response: authenticationResponse };
  }

  async function createPasskey(publicKey) {
    if (!window.PublicKeyCredential || !navigator.credentials?.create) {
      throw new AdminUiError("当前浏览器不支持通行密钥注册", { reasonCode: "ADMIN_PASSKEY_UNAVAILABLE" });
    }
    const credential = await navigator.credentials.create({ publicKey: creationOptionsFromJson(publicKey) });
    if (!credential) throw new AdminUiError("通行密钥注册已取消", { reasonCode: "ADMIN_PASSKEY_CANCELLED" });
    return credentialToJson(credential);
  }

  async function getPasskey(publicKey) {
    if (!window.PublicKeyCredential || !navigator.credentials?.get) {
      throw new AdminUiError("当前浏览器不支持通行密钥登录", { reasonCode: "ADMIN_PASSKEY_UNAVAILABLE" });
    }
    const credential = await navigator.credentials.get({ publicKey: requestOptionsFromJson(publicKey) });
    if (!credential) throw new AdminUiError("通行密钥验证已取消", { reasonCode: "ADMIN_PASSKEY_CANCELLED" });
    return credentialToJson(credential);
  }

  class RealAdminAdapter {
    async list() {
      const payload = requireSchema(await requestJson(ENDPOINTS.reviews), REVIEW_SCHEMA);
      if (!Array.isArray(payload.items)) throw new AdminUiError("审核队列格式无效", { reasonCode: "ADMIN_RESPONSE_INVALID" });
      return payload;
    }

    async detail(candidateId) {
      return requireSchema(await requestJson(ENDPOINTS.detail(candidateId)), REVIEW_SCHEMA);
    }

    async operation(operationId) {
      return requireSchema(await requestJson(ENDPOINTS.operation(operationId)), REVIEW_SCHEMA);
    }

    async mutate(operationType, mutation, freshReceipt) {
      const csrfPayload = await requestJson(ENDPOINTS.csrf, {
        method: "POST",
        body: {
          schemaVersion: "admin-review-csrf-v1",
          operationType,
          mutation
        }
      });
      const csrf = requireSchema(csrfPayload, "admin-review-csrf-v1");
      if (typeof csrf.csrfToken !== "string" || csrf.operationId !== mutation.operationId) {
        throw new AdminUiError("CSRF 收据与当前操作不匹配", { reasonCode: "ADMIN_CSRF_REJECTED" });
      }
      let path;
      if (operationType === "revision") path = ENDPOINTS.revision(mutation.expected.candidateId);
      else if (operationType === "approve") path = ENDPOINTS.approve(mutation.expected.candidateId);
      else if (operationType === "reject") path = ENDPOINTS.reject(mutation.expected.candidateId);
      else path = ENDPOINTS.publish(mutation.expected.publicId);
      return requireSchema(await requestJson(path, {
        method: "POST",
        headers: {
          "x-csrf-token": csrf.csrfToken,
          ...(freshReceipt ? { "x-f1-fresh-reauth": freshReceipt } : {})
        },
        body: mutation
      }), REVIEW_SCHEMA);
    }

    async bootstrap(bootstrapToken) {
      const options = requireSchema(await requestJson(ENDPOINTS.bootstrapOptions, {
        method: "POST",
        body: { schemaVersion: "admin-auth-bootstrap-options-v1", bootstrapToken }
      }), "admin-auth-bootstrap-options-v1");
      const response = await createPasskey(requireObject(options.publicKey, "通行密钥注册选项"));
      return requireSchema(await requestJson(ENDPOINTS.bootstrapVerify, {
        method: "POST",
        body: { schemaVersion: "admin-auth-bootstrap-verify-v1", bootstrapToken, response }
      }), "admin-auth-bootstrap-verify-v1");
    }

    async login() {
      const options = requireSchema(await requestJson(ENDPOINTS.loginOptions, {
        method: "POST",
        body: { schemaVersion: "admin-auth-login-options-v1" }
      }), "admin-auth-login-options-v1");
      const response = await getPasskey(requireObject(options.publicKey, "通行密钥登录选项"));
      return requireSchema(await requestJson(ENDPOINTS.loginVerify, {
        method: "POST",
        body: { schemaVersion: "admin-auth-login-verify-v1", response }
      }), "admin-auth-login-verify-v1");
    }

    async freshReauth(mutation) {
      const options = requireSchema(await requestJson(ENDPOINTS.freshOptions, {
        method: "POST",
        body: { schemaVersion: "admin-auth-fresh-options-v1", mutation }
      }), "admin-auth-fresh-options-v1");
      const response = await getPasskey(requireObject(options.publicKey, "发布再认证选项"));
      const verified = requireSchema(await requestJson(ENDPOINTS.freshVerify, {
        method: "POST",
        body: { schemaVersion: "admin-auth-fresh-verify-v1", mutation, response }
      }), "admin-auth-fresh-verify-v1");
      if (typeof verified.freshReceipt !== "string") {
        throw new AdminUiError("发布再认证收据缺失", { reasonCode: "ADMIN_REAUTH_REQUIRED" });
      }
      return verified.freshReceipt;
    }

    async checkDelivery(candidateId, deliveryId) {
      const receipt = requireDeliveryReceipt(await requestJson(ENDPOINTS.delivery(deliveryId)), deliveryId);
      const detail = await this.detail(candidateId);
      if (detail.candidateId !== candidateId) {
        throw new AdminUiError("投递收据回读了错误候选", { reasonCode: "ADMIN_RESPONSE_INVALID" });
      }
      return { receipt, detail };
    }
  }

  function fixtureCandidate(fixtureState) {
    const base = {
      candidateId: "rss-candidate-fixture-01",
      sourceId: "motorsport-f1-news",
      sourceRevision: 3,
      editorBasedOnSourceRevision: 3,
      sourceTitle: "Hamilton finds a stronger Ferrari rhythm after the break",
      titleZh: "汉密尔顿谈法拉利新阶段：赛车节奏与信心正在回升",
      summaryZh: "汉密尔顿表示，车队在近期调整中找到了更稳定的赛车平衡；后续重点仍是把单圈速度转化为完整比赛周末的持续竞争力。",
      sourceAuthor: "Motorsport.com F1 desk",
      sourcePublishedAt: "2026-08-12T02:30:00Z",
      sourceDisplayName: "Motorsport.com",
      originalUrl: "https://www.motorsport.com/f1/news/fixture-hamilton-ferrari/",
      mediaState: "none",
      latestBundle: { id: "review-bundle-fixture-03", revision: 3, versionTag: "a81d5c97e142" },
      decision: null,
      publication: null,
      delivery: null,
      updatedAt: "2026-08-12T02:36:00Z",
      allowedActions: ["revision", "approve", "reject"]
    };
    if (fixtureState !== "approved") return { ...base, reviewState: "pending_review" };
    return {
      ...base,
      reviewState: "approved_waiting_publish",
      decision: {
        id: "review-decision-fixture-01",
        bundleId: base.latestBundle.id,
        decision: "approved",
        rejectionReason: null,
        decidedAt: "2026-08-12T02:38:00Z"
      },
      publication: {
        id: "publication-fixture-01",
        publicId: `public-rss-${"4".repeat(64)}`,
        bundleId: base.latestBundle.id,
        publishGeneration: 1,
        status: "queued",
        publishedAt: null,
        updatedAt: "2026-08-12T02:38:00Z"
      },
      allowedActions: ["publish"]
    };
  }

  class FixtureAdminAdapter {
    constructor() {
      const first = fixtureCandidate(searchParams.get("fixtureState"));
      this.items = [
        first,
        {
          ...fixtureCandidate("pending"),
          candidateId: "rss-candidate-fixture-02",
          sourceRevision: 1,
          editorBasedOnSourceRevision: null,
          sourceTitle: "Why F1 teams protect their summer shutdown",
          titleZh: null,
          summaryZh: null,
          sourceAuthor: null,
          sourcePublishedAt: "2026-08-12T01:10:00Z",
          originalUrl: "https://www.motorsport.com/f1/news/fixture-summer-shutdown/",
          latestBundle: null,
          updatedAt: "2026-08-12T01:12:00Z",
          allowedActions: ["revision"]
        },
        {
          ...fixtureCandidate("pending"),
          candidateId: "rss-candidate-fixture-03",
          sourceRevision: 2,
          editorBasedOnSourceRevision: 1,
          sourceTitle: "A source update arrived during editorial review",
          titleZh: "来源更新：旧审核版本需要重新核对",
          summaryZh: "来源正文发生变化，当前决定入口已关闭；运营者需要加载最新来源并生成新的审核版本。",
          sourcePublishedAt: "2026-08-11T23:50:00Z",
          originalUrl: "https://www.motorsport.com/f1/news/fixture-source-updated/",
          reviewState: "source_updated",
          updatedAt: "2026-08-12T02:40:00Z",
          allowedActions: ["revision"]
        }
      ];
      this.operations = new Map();
      this.notes = new Map([[first.candidateId, "优先核对车手原话与上下文，不扩写成绩判断。"]]);
    }

    async pause() {
      await new Promise((resolve) => window.setTimeout(resolve, 70));
    }

    async list() {
      await this.pause();
      return { schemaVersion: REVIEW_SCHEMA, items: structuredClone(this.items), nextCursor: null };
    }

    async detail(candidateId) {
      await this.pause();
      const item = this.items.find((candidate) => candidate.candidateId === candidateId);
      if (!item) throw new AdminUiError("REVIEW_CANDIDATE_NOT_FOUND", { status: 404, reasonCode: "REVIEW_CANDIDATE_NOT_FOUND" });
      return {
        schemaVersion: REVIEW_SCHEMA,
        ...structuredClone(item),
        sourceExcerpt: "该候选来自固定 RSS 验收样本，用于核对长标题、摘要编辑、批准与手动发布的视觉和交互层级。",
        editorNotes: this.notes.get(candidateId) ?? null,
        integrity: {
          status: item.reviewState === "source_updated" ? "blocked" : "ok",
          reasonCode: item.reviewState === "source_updated" ? "REVIEW_SOURCE_STALE" : null,
          versionTag: item.reviewState === "source_updated" ? "5d8210f3b117" : "6ad3028f9c41"
        }
      };
    }

    operationReceipt(operationId, operationType, item, extras = {}) {
      const receipt = {
        schemaVersion: REVIEW_SCHEMA,
        operationId,
        operationType,
        status: "completed",
        httpStatus: 200,
        reasonCode: null,
        requestVersionTag: item.latestBundle?.versionTag ?? "6ad3028f9c41",
        responseVersionTag: item.latestBundle?.versionTag ?? "6ad3028f9c41",
        candidateId: item.candidateId,
        bundleId: item.latestBundle?.id ?? null,
        publicId: item.publication?.publicId ?? null,
        deliveryId: item.delivery?.id ?? null,
        createdAt: "2026-08-12T02:42:00Z",
        ...extras
      };
      this.operations.set(operationId, receipt);
      return receipt;
    }

    async operation(operationId) {
      await this.pause();
      const receipt = this.operations.get(operationId);
      if (!receipt) throw new AdminUiError("ADMIN_OPERATION_NOT_FOUND", { status: 404, reasonCode: "ADMIN_OPERATION_NOT_FOUND" });
      return structuredClone(receipt);
    }

    async mutate(operationType, mutation) {
      await this.pause();
      const candidateId = mutation.expected.candidateId ?? this.items.find((item) => item.publication?.publicId === mutation.expected.publicId)?.candidateId;
      const index = this.items.findIndex((item) => item.candidateId === candidateId);
      if (index < 0) throw new AdminUiError("REVIEW_CANDIDATE_NOT_FOUND", { status: 404, reasonCode: "REVIEW_CANDIDATE_NOT_FOUND" });
      let item = this.items[index];
      if (operationType === "revision") {
        const revision = (item.latestBundle?.revision ?? 0) + 1;
        const bundle = { id: `review-bundle-fixture-${revision + 3}`, revision, versionTag: `b42d91c7e${String(revision).padStart(3, "0")}`.slice(0, 12) };
        item = {
          ...item,
          editorBasedOnSourceRevision: item.sourceRevision,
          titleZh: mutation.editable.titleZh,
          summaryZh: mutation.editable.summaryZh,
          latestBundle: bundle,
          reviewState: "pending_review",
          decision: null,
          publication: null,
          delivery: null,
          allowedActions: ["revision", "approve", "reject"]
        };
        this.notes.set(item.candidateId, mutation.editable.notes);
        this.items[index] = item;
        return { schemaVersion: REVIEW_SCHEMA, operation: this.operationReceipt(mutation.operationId, "revision", item), candidate: structuredClone(item), bundle };
      }
      if (operationType === "approve") {
        const decision = { id: "review-decision-fixture-approved", bundleId: item.latestBundle.id, decision: "approved", rejectionReason: null, decidedAt: "2026-08-12T02:43:00Z" };
        const publication = { id: "publication-fixture-approved", publicId: `public-rss-${"4".repeat(64)}`, bundleId: item.latestBundle.id, publishGeneration: 1, status: "queued", publishedAt: null, updatedAt: "2026-08-12T02:43:00Z" };
        item = { ...item, reviewState: "approved_waiting_publish", decision, publication, allowedActions: ["publish"] };
        this.items[index] = item;
        return { schemaVersion: REVIEW_SCHEMA, operation: this.operationReceipt(mutation.operationId, "approve", item), candidate: structuredClone(item), decision, publication };
      }
      if (operationType === "reject") {
        const decision = { id: "review-decision-fixture-rejected", bundleId: item.latestBundle.id, decision: "rejected", rejectionReason: mutation.reason, decidedAt: "2026-08-12T02:43:00Z" };
        item = { ...item, reviewState: "rejected", decision, publication: null, allowedActions: ["return_to_queue"] };
        this.items[index] = item;
        return { schemaVersion: REVIEW_SCHEMA, operation: this.operationReceipt(mutation.operationId, "reject", item), candidate: structuredClone(item), decision };
      }
      const delivery = { id: `op-snapshot-${"8".repeat(64)}`, status: "pending", snapshotGeneration: 1, attemptCount: 0, reasonCode: "NONE", updatedAt: "2026-08-12T02:44:00Z" };
      const publication = { ...item.publication, status: "published", publishedAt: "2026-08-12T02:44:00Z", updatedAt: "2026-08-12T02:44:00Z" };
      item = { ...item, reviewState: "published_delivery_pending", publication, delivery, allowedActions: ["check_delivery"] };
      this.items[index] = item;
      return {
        schemaVersion: REVIEW_SCHEMA,
        operation: this.operationReceipt(mutation.operationId, "publish", item, { publicId: publication.publicId, deliveryId: delivery.id }),
        candidate: structuredClone(item),
        publication,
        delivery,
        status: "delivery_pending",
        publicPath: null
      };
    }

    async freshReauth() {
      await this.pause();
      return "fixture-fresh-receipt";
    }

    async checkDelivery(candidateId, deliveryId) {
      await this.pause();
      const index = this.items.findIndex((item) => item.candidateId === candidateId);
      if (index < 0 || this.items[index].delivery?.id !== deliveryId) {
        throw new AdminUiError("PROJECTION_RECEIPT_UNKNOWN", { status: 404, reasonCode: "PROJECTION_RECEIPT_UNKNOWN" });
      }
      if (this.items[index].delivery) {
        this.items[index] = {
          ...this.items[index],
          reviewState: "published",
          delivery: { ...this.items[index].delivery, status: "succeeded", updatedAt: "2026-08-12T02:45:00Z" },
          allowedActions: ["open_public_story"]
        };
      }
      return {
        receipt: {
          schemaVersion: "admin-public-projection-receipt-v1",
          deliveryId,
          snapshotManifestHash: "8".repeat(64),
          snapshotGeneration: 1,
          status: "active",
          activeSnapshotGeneration: 1,
          activeSnapshotManifestHash: "8".repeat(64),
          reasonCode: null,
          receivedAt: "2026-08-12T02:44:00Z",
          activatedAt: "2026-08-12T02:45:00Z"
        },
        detail: await this.detail(candidateId)
      };
    }
  }

  const reviewStatePresentation = Object.freeze({
    pending_review: ["待审核", "核对来源与中文整理后选择批准或拒绝。批准不会自动发布。"],
    source_updated: ["来源已更新", "当前审核版本已过期。请基于最新来源保存新版本后重新决定。"],
    approved_waiting_publish: ["已批准，等待手动发布", "批准决定已绑定当前版本。发布仍需要第二次显式确认和新鲜通行密钥。"],
    rejected: ["已拒绝", "拒绝决定与原因已保留，没有创建 Publication。"],
    published_delivery_pending: ["业务发布已提交", "公开投递尚未确认 active。只检查同一 delivery，不创建第二发布。"],
    published: ["公开投递已确认", "当前发布与投递收据已经确认。"],
    reconcile_wait: ["结果等待对账", "只查询同一 operation 或 delivery；禁止盲重试。"],
    terminal_failed: ["操作进入终态失败", "保留失败原因并返回队列；禁止创建第二发布身份。"],
    emergency_stopped: ["发布已急停", "当前对象没有写操作；保留原状态供人工处置。"],
    blocked: ["完整性阻断", "必要链路不可证明，所有写操作保持关闭。"]
  });

  function stateLabel(reviewState) {
    return reviewStatePresentation[reviewState]?.[0] ?? "未知状态";
  }

  function stateClass(reviewState) {
    if (["approved_waiting_publish", "published"].includes(reviewState)) return "is-approved";
    if (["rejected"].includes(reviewState)) return "is-rejected";
    if (["blocked", "terminal_failed", "emergency_stopped"].includes(reviewState)) return "is-blocked";
    if (["source_updated", "published_delivery_pending", "reconcile_wait"].includes(reviewState)) return "is-source-updated";
    return "is-pending";
  }

  function showAuth(options = {}) {
    elements.appView.hidden = true;
    elements.authView.hidden = false;
    elements.connectionState.textContent = options.connection ?? "需要通行密钥";
    elements.authStatus.classList.toggle("is-error", options.error === true);
    elements.authStatus.replaceChildren();
    if (options.loading) {
      const spinner = document.createElement("span");
      spinner.className = "spinner";
      spinner.setAttribute("aria-hidden", "true");
      elements.authStatus.append(spinner);
    }
    const copy = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = options.title ?? "需要验证身份";
    const span = document.createElement("span");
    span.textContent = options.copy ?? "使用已经注册的通行密钥继续。";
    copy.append(strong, span);
    elements.authStatus.append(copy);
    elements.authActions.hidden = options.loading === true;
    elements.bootstrapForm.hidden = true;
  }

  function showApp() {
    elements.authView.hidden = true;
    elements.appView.hidden = false;
    elements.connectionState.textContent = fixtureMode ? "本地验收 Fixture" : "私有会话已验证";
  }

  function showSystem(symbol, title, copy, actionLabel, action) {
    elements.detailContent.hidden = true;
    elements.systemPanel.hidden = false;
    elements.systemSymbol.textContent = symbol;
    elements.systemTitle.textContent = title;
    elements.systemCopy.textContent = copy;
    elements.systemAction.hidden = !actionLabel;
    elements.systemAction.textContent = actionLabel ?? "";
    elements.systemAction.onclick = action ?? null;
  }

  function hideSystem() {
    elements.systemPanel.hidden = true;
    elements.detailContent.hidden = false;
  }

  function renderQueue() {
    const query = elements.queueSearch.value.trim().toLocaleLowerCase("zh-CN");
    const visible = state.items.filter((item) => {
      const haystack = `${safeString(item.titleZh, "")} ${safeString(item.sourceTitle, "")} ${safeString(item.sourceDisplayName, "")}`.toLocaleLowerCase("zh-CN");
      return query.length === 0 || haystack.includes(query);
    });
    elements.queueSummary.textContent = `${state.items.length} 条真实候选 · 人工审核后才可公开`;
    elements.queueList.replaceChildren();
    for (const item of visible) {
      const listItem = document.createElement("li");
      listItem.className = "queue-item";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "queue-button";
      button.dataset.candidateId = item.candidateId;
      button.setAttribute("aria-current", String(item.candidateId === state.selectedId));
      const meta = document.createElement("span");
      meta.className = "queue-meta";
      const time = document.createElement("span");
      time.textContent = `RSS · ${formatTime(item.sourcePublishedAt)}`;
      const status = document.createElement("span");
      status.className = `status-dot ${stateClass(item.reviewState)}`;
      status.textContent = stateLabel(item.reviewState);
      meta.append(time, status);
      const title = document.createElement("span");
      title.className = "queue-title";
      title.textContent = safeString(item.titleZh, safeString(item.sourceTitle, "无标题"));
      const foot = document.createElement("span");
      foot.className = "queue-foot";
      const source = document.createElement("span");
      source.textContent = `${safeString(item.sourceDisplayName)} · 无媒体`;
      const updated = document.createElement("span");
      updated.textContent = formatTime(item.updatedAt);
      foot.append(source, updated);
      button.append(meta, title, foot);
      button.addEventListener("click", () => requestNavigation(() => selectCandidate(item.candidateId, true)));
      listItem.append(button);
      elements.queueList.append(listItem);
    }
    if (visible.length === 0 && state.items.length > 0) {
      const row = document.createElement("li");
      row.className = "queue-item";
      const copy = document.createElement("div");
      copy.className = "queue-button";
      copy.textContent = "没有匹配当前搜索的候选。";
      row.append(copy);
      elements.queueList.append(row);
    }
  }

  function updateCounts() {
    elements.titleCount.textContent = String(codePointLength(elements.titleInput.value));
    elements.summaryCount.textContent = String(codePointLength(elements.summaryInput.value));
    elements.notesCount.textContent = String(codePointLength(elements.notesInput.value));
  }

  function editableSnapshot() {
    return {
      titleZh: normalizeText(elements.titleInput.value),
      summaryZh: normalizeText(elements.summaryInput.value),
      notes: normalizeText(elements.notesInput.value)
    };
  }

  function editorChanged() {
    if (!state.detail) return false;
    const initial = {
      titleZh: normalizeText(state.detail.titleZh ?? state.detail.sourceTitle ?? ""),
      summaryZh: normalizeText(state.detail.summaryZh ?? state.detail.sourceExcerpt ?? ""),
      notes: normalizeText(state.detail.editorNotes ?? "")
    };
    return JSON.stringify(editableSnapshot()) !== JSON.stringify(initial);
  }

  function currentDraftBinding(detail = state.detail) {
    if (!detail) return null;
    return {
      candidateId: detail.candidateId,
      sourceRevision: detail.sourceRevision,
      sourceVersionTag: detail.integrity?.versionTag ?? null,
      latestBundleVersionTag: detail.latestBundle?.versionTag ?? null
    };
  }

  function rememberDraft() {
    if (!state.detail) return;
    if (!state.dirty) {
      state.drafts.delete(state.detail.candidateId);
      return;
    }
    state.drafts.set(state.detail.candidateId, {
      ...currentDraftBinding(),
      editable: editableSnapshot()
    });
  }

  function draftBindingMatches(draft, detail) {
    const current = currentDraftBinding(detail);
    return Boolean(current && draft.sourceRevision === current.sourceRevision &&
      draft.sourceVersionTag === current.sourceVersionTag &&
      draft.latestBundleVersionTag === current.latestBundleVersionTag);
  }

  function restoreDraft(candidateId) {
    const draft = state.drafts.get(candidateId);
    if (!draft || state.detail?.candidateId !== candidateId || !allowed("revision") || state.busy) return;
    elements.titleInput.value = draft.editable.titleZh;
    elements.summaryInput.value = draft.editable.summaryZh;
    elements.notesInput.value = draft.editable.notes;
    state.dirty = true;
    rememberDraft();
    updateCounts();
    renderActions();
    elements.titleInput.focus();
    toast("草稿文本已重新套用；请核对后手动保存新版本");
  }

  function discardDraft(candidateId) {
    if (state.busy) return;
    state.drafts.delete(candidateId);
    state.dirty = false;
    renderActions();
    toast("内存草稿已明确丢弃");
  }

  function setDirty() {
    state.dirty = editorChanged();
    rememberDraft();
    renderActions();
    updateCounts();
  }

  function allowed(action) {
    return Array.isArray(state.detail?.allowedActions) && state.detail.allowedActions.includes(action);
  }

  function safeOriginalUrl(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.hostname !== "www.motorsport.com" || url.username || url.password || url.hash) return null;
      return url.href;
    } catch {
      return null;
    }
  }

  function renderDetail() {
    const detail = state.detail;
    if (!detail) return;
    hideSystem();
    elements.detailKicker.textContent = `真实 RSS 候选 · Source revision ${detail.sourceRevision}`;
    elements.detailTitle.textContent = safeString(detail.titleZh, safeString(detail.sourceTitle, "无标题"));
    elements.detailMeta.textContent = `${safeString(detail.sourceDisplayName)} · ${formatTime(detail.sourcePublishedAt)} · ${stateLabel(detail.reviewState)}`;
    const blocked = detail.integrity?.status !== "ok";
    elements.integrityCard.classList.toggle("is-blocked", blocked);
    elements.integrityTitle.textContent = blocked ? "完整性检查阻断" : "完整性检查可读";
    elements.integrityCopy.textContent = blocked
      ? safeString(detail.integrity?.reasonCode, "ADMIN_INTEGRITY_BLOCKED")
      : `来源版本 ${safeString(detail.integrity?.versionTag)} · 不显示完整 hash`;
    const original = safeOriginalUrl(detail.originalUrl);
    elements.sourceLink.href = original ?? "#";
    elements.sourceLink.setAttribute("aria-disabled", String(original === null));
    elements.sourceExcerpt.textContent = safeString(detail.sourceExcerpt, "来源没有提供摘要。" );
    if (detail.sourceMedia?.kind === "source_image") {
      elements.sourceImage.src = detail.sourceMedia.url;
      elements.sourceImage.alt = safeString(detail.machineDraft?.titleZh, safeString(detail.sourceTitle, "RSS 来源图片"));
      elements.sourceImage.hidden = false;
      document.querySelector(".media-placeholder").hidden = true;
    } else {
      elements.sourceImage.removeAttribute("src");
      elements.sourceImage.alt = "";
      elements.sourceImage.hidden = true;
      document.querySelector(".media-placeholder").hidden = false;
    }
    elements.evidenceSource.textContent = safeString(detail.sourceDisplayName);
    elements.evidenceAuthor.textContent = safeString(detail.sourceAuthor, "未提供作者");
    elements.evidenceTime.textContent = formatTime(detail.sourcePublishedAt);
    elements.evidenceSourceRevision.textContent = `revision ${detail.sourceRevision} · tag ${safeString(detail.integrity?.versionTag)}`;
    elements.evidenceBundle.textContent = detail.latestBundle
      ? `Bundle r${detail.latestBundle.revision} · ${detail.latestBundle.versionTag}`
      : "尚未生成审核 Bundle";
    elements.evidenceDelivery.textContent = detail.delivery
      ? `${detail.delivery.status} · attempt ${detail.delivery.attemptCount} · ${detail.delivery.reasonCode}`
      : detail.publication
        ? `Publication ${detail.publication.status}`
        : "尚未创建 Publication";
    elements.titleInput.value = safeString(detail.titleZh, safeString(detail.machineDraft?.titleZh, safeString(detail.sourceTitle, "")));
    elements.summaryInput.value = safeString(detail.summaryZh, safeString(detail.machineDraft?.summaryZh, safeString(detail.sourceExcerpt, "")));
    elements.notesInput.value = safeString(detail.editorNotes, "");
    const editorEnabled = allowed("revision") && !state.busy;
    elements.titleInput.disabled = !editorEnabled;
    elements.summaryInput.disabled = !editorEnabled;
    elements.notesInput.disabled = !editorEnabled;
    elements.saveRevision.disabled = !editorEnabled;
    elements.editorBinding.textContent = detail.latestBundle
      ? `当前 Bundle ${detail.latestBundle.versionTag}`
      : detail.machineDraft
        ? `DeepSeek 草稿 · source r${detail.machineDraft.sourceRevision} · 保存后生效`
        : `当前来源 ${safeString(detail.integrity?.versionTag)}`;
    state.dirty = false;
    updateCounts();
    renderActions();
  }

  function showOperationStatus(title, copy, kind = "ok") {
    elements.operationStatus.hidden = false;
    elements.operationStatus.className = `operation-status${kind === "warning" ? " is-warning" : kind === "error" ? " is-error" : ""}`;
    elements.operationStatus.replaceChildren();
    const strong = document.createElement("strong");
    strong.textContent = title;
    const span = document.createElement("span");
    span.textContent = copy;
    elements.operationStatus.append(strong, span);
  }

  function renderActions() {
    if (!state.detail) return;
    const [title, copy] = reviewStatePresentation[state.detail.reviewState] ?? ["未知状态", "当前状态不在已冻结合同中，所有写操作关闭。"];
    elements.actionTitle.textContent = title;
    elements.actionCopy.textContent = copy;
    elements.actionStack.replaceChildren();
    elements.operationStatus.hidden = true;
    const writesBlocked = state.busy || state.dirty;
    if (allowed("approve")) {
      elements.actionStack.append(createButton("批准当前版本", "primary-button", () => openDialog("approve"), writesBlocked));
    }
    if (allowed("reject")) {
      elements.actionStack.append(createButton("拒绝并填写原因", "danger-button", () => openDialog("reject"), writesBlocked));
    }
    if (allowed("publish")) {
      elements.actionStack.append(createButton("手动发布当前批准版本", "primary-button", () => openDialog("publish"), state.busy));
      elements.actionStack.append(createButton("返回队列", "quiet-button", returnToQueue));
    }
    if (allowed("check_delivery")) {
      elements.actionStack.append(createButton("检查同一投递结果", "secondary-button", checkDelivery, state.busy));
      elements.actionStack.append(createButton("返回队列", "quiet-button", returnToQueue));
    }
    if (allowed("open_public_story")) {
      elements.actionStack.append(createButton("刷新已确认投递状态", "secondary-button", checkDelivery, state.busy));
      elements.actionStack.append(createButton("返回队列", "quiet-button", returnToQueue));
    }
    if (allowed("return_to_queue") || elements.actionStack.children.length === 0) {
      elements.actionStack.append(createButton("返回待审核队列", "quiet-button", returnToQueue));
    }
    const storedReceipt = state.deliveryReceipts.get(state.detail.candidateId);
    const receipt = storedReceipt?.deliveryId === state.detail.delivery?.id ? storedReceipt : null;
    if (state.dirty) {
      showOperationStatus("存在未保存修改", "先保存生成新 Bundle，或明确丢弃这些输入；当前 Bundle 的批准与拒绝已经锁定。", "warning");
    } else if (receipt) {
      const title = receipt.status === "active" ? "同一投递收据已确认 active" : "同一投递已被后继快照替代";
      const copy = `${receipt.deliveryId} · receiver generation ${receipt.activeSnapshotGeneration} · 私有详情 ${state.detail.delivery?.status ?? "无状态"}`;
      showOperationStatus(title, copy, receipt.status === "active" ? "ok" : "warning");
    } else if (state.detail.delivery) {
      showOperationStatus(
        state.detail.delivery.status === "succeeded" ? "公开投递已确认" : "业务发布已提交，投递仍待确认",
        `delivery ${state.detail.delivery.id} · ${state.detail.delivery.status} · ${state.detail.delivery.reasonCode}`,
        state.detail.delivery.status === "succeeded" ? "ok" : "warning"
      );
    } else if (state.detail.publication?.status === "queued") {
      showOperationStatus("手动发布守卫可检查", "Decision=approved · Publication=queued · 仍未公开");
    } else if (state.detail.decision?.decision === "rejected") {
      showOperationStatus("拒绝原因已保留", safeString(state.detail.decision.rejectionReason));
    }
    const draft = state.drafts.get(state.detail.candidateId);
    if (draft && !state.dirty) {
      const matches = draftBindingMatches(draft, state.detail);
      elements.actionStack.replaceChildren(
        createButton("重新套用草稿", "secondary-button", () => restoreDraft(state.detail.candidateId), state.busy || !allowed("revision")),
        createButton("明确丢弃草稿", "quiet-button", () => discardDraft(state.detail.candidateId), state.busy)
      );
      showOperationStatus(
        "发现仅存于本页内存的未保存草稿",
        matches
          ? "草稿绑定仍与当前来源和 Bundle 一致；重新套用后仍需手动保存 revision。"
          : "来源或 Bundle 已变化；只复制草稿文本供人工合并，绝不自动重放 mutation。",
        "warning"
      );
    }
  }

  function operationId(kind) {
    if (!window.crypto?.randomUUID) throw new AdminUiError("当前浏览器无法生成操作标识", { reasonCode: "ADMIN_OPERATION_ID_UNAVAILABLE" });
    return `admin-ui-${kind}-${window.crypto.randomUUID()}`;
  }

  function revisionMutation() {
    const detail = state.detail;
    if (!detail || typeof detail.integrity?.versionTag !== "string" || !/^[0-9a-f]{12}$/.test(detail.integrity.versionTag)) {
      throw new AdminUiError("来源版本标签不可用，保存保持关闭", { reasonCode: "ADMIN_REVISION_CAS_UNAVAILABLE" });
    }
    return {
      schemaVersion: REVIEW_SCHEMA,
      operationId: operationId("revision"),
      expected: {
        candidateId: detail.candidateId,
        sourceRevision: detail.sourceRevision,
        sourceVersionTag: detail.integrity.versionTag,
        latestBundleId: detail.latestBundle?.id ?? null,
        latestBundleVersionTag: detail.latestBundle?.versionTag ?? null
      },
      editable: editableSnapshot()
    };
  }

  function decisionMutation(kind) {
    const detail = state.detail;
    if (!detail?.latestBundle) throw new AdminUiError("当前审核版本不可用", { reasonCode: "REVIEW_BUNDLE_STALE" });
    const base = {
      schemaVersion: REVIEW_SCHEMA,
      operationId: operationId(kind),
      expected: {
        candidateId: detail.candidateId,
        sourceRevision: detail.sourceRevision,
        bundleId: detail.latestBundle.id,
        bundleVersionTag: detail.latestBundle.versionTag
      }
    };
    if (kind === "reject") return { ...base, reason: normalizeText(elements.rejectReason.value) };
    return base;
  }

  function publishMutation() {
    const detail = state.detail;
    if (!detail?.latestBundle || detail.publication?.status !== "queued") {
      throw new AdminUiError("当前 Publication 不可手动发布", { reasonCode: "PUBLICATION_NOT_FOUND" });
    }
    return {
      schemaVersion: REVIEW_SCHEMA,
      operationId: operationId("publish"),
      expected: {
        publicId: detail.publication.publicId,
        publishGeneration: 1,
        publicationStatus: "queued",
        approvedBundleVersionTag: detail.latestBundle.versionTag
      }
    };
  }

  function setBusy(busy) {
    state.busy = busy;
    const editorEnabled = !busy && allowed("revision");
    elements.refreshQueue.disabled = busy;
    elements.titleInput.disabled = !editorEnabled;
    elements.summaryInput.disabled = !editorEnabled;
    elements.notesInput.disabled = !editorEnabled;
    elements.saveRevision.disabled = !editorEnabled;
    elements.dialogConfirm.disabled = busy;
    elements.dialogCancel.disabled = busy;
    renderActions();
  }

  async function reconcileOperation(id) {
    try {
      const receipt = await state.adapter.operation(id);
      if (receipt.status === "completed") {
        showOperationStatus("操作收据已确认", `${receipt.operationType} · ${receipt.operationId}`);
        await refreshCurrent();
        return;
      }
      showOperationStatus("操作已确认失败", safeString(receipt.reasonCode, "ADMIN_OPERATION_FAILED"), "error");
    } catch (error) {
      handleError(error, { operationId: id, scope: "operation" });
    }
  }

  function handleError(error, context = {}) {
    const adminError = error instanceof AdminUiError
      ? error
      : new AdminUiError("未知 Admin UI 错误", { reasonCode: "ADMIN_UI_FAILURE" });
    if (adminError.status === 401 || adminError.reasonCode === "ADMIN_SESSION_REQUIRED") {
      showAuth({ title: "会话已失效", copy: "请重新使用通行密钥登录。", error: true });
      return;
    }
    if (context.operationId && adminError.uncertain) {
      state.lastOperationId = context.operationId;
      elements.actionStack.replaceChildren(
        createButton("查询同一操作结果", "secondary-button", () => reconcileOperation(context.operationId)),
        createButton("返回队列", "quiet-button", returnToQueue)
      );
      showOperationStatus("操作结果未知", `${adminError.reasonCode} · 不会自动重试或创建第二操作。`, "warning");
      return;
    }
    if (adminError.status === 409) {
      showOperationStatus("当前版本或决定已变化", `${adminError.reasonCode} · 加载最新状态后重新确认。`, "warning");
      elements.actionStack.prepend(createButton("加载最新状态", "secondary-button", refreshCurrent));
      return;
    }
    if (adminError.status === 503) {
      showOperationStatus("Admin 服务暂不可写", `${adminError.reasonCode} · 保留当前输入，稍后重试同一读取。`, "error");
      return;
    }
    showOperationStatus("操作未完成", adminError.reasonCode, "error");
  }

  async function executeMutation(kind, mutation, successMessage) {
    if (state.busy) return;
    setBusy(true);
    state.lastOperationId = mutation.operationId;
    let failure = null;
    try {
      let freshReceipt = null;
      if (kind === "publish") freshReceipt = await state.adapter.freshReauth(mutation);
      const result = await state.adapter.mutate(kind, mutation, freshReceipt);
      if (typeof result.publicPath === "string") state.lastPublicPath = result.publicPath;
      if (kind === "revision" && typeof mutation.expected?.candidateId === "string") {
        state.drafts.delete(mutation.expected.candidateId);
      }
      toast(successMessage);
      await loadList({ selectId: state.selectedId, switchMobile: false });
      elements.actionTitle.focus();
    } catch (error) {
      failure = error;
    } finally {
      setBusy(false);
    }
    if (failure) handleError(failure, { operationId: mutation.operationId, scope: kind });
  }

  async function saveRevision(event) {
    event.preventDefault();
    if (state.busy) return;
    const editable = editableSnapshot();
    if (codePointLength(editable.titleZh) < 1 || codePointLength(editable.summaryZh) < 1) {
      showOperationStatus("标题和摘要不能为空", "请补全中文标题与摘要后再保存。", "error");
      return;
    }
    if (codePointLength(editable.titleZh) > 400 || codePointLength(editable.summaryZh) > 1200 || codePointLength(editable.notes) > 2000) {
      showOperationStatus("输入超过字段上限", "请根据计数收敛标题、摘要或私有备注。", "error");
      return;
    }
    try {
      await executeMutation("revision", revisionMutation(), "已生成新的待审核版本");
    } catch (error) {
      handleError(error);
    }
  }

  async function confirmAction() {
    if (state.busy) return;
    const action = state.dialogAction;
    if (action === "discard") {
      state.dirty = false;
      if (state.selectedId) state.drafts.delete(state.selectedId);
      const next = state.pendingNavigation;
      state.pendingNavigation = null;
      elements.dialog.close();
      if (next) next();
      return;
    }
    if (action === "reject" && codePointLength(normalizeText(elements.rejectReason.value)) < 1) {
      elements.rejectError.textContent = "请填写拒绝原因。";
      elements.rejectReason.focus();
      return;
    }
    elements.dialogConfirm.disabled = true;
    elements.dialogCancel.disabled = true;
    elements.dialog.close();
    try {
      if (action === "approve") await executeMutation("approve", decisionMutation("approve"), "当前版本已批准，仍未公开");
      else if (action === "reject") await executeMutation("reject", decisionMutation("reject"), "拒绝决定已记录");
      else if (action === "publish") await executeMutation("publish", publishMutation(), "业务发布已提交，正在等待公开投递确认");
    } catch (error) {
      handleError(error);
    }
  }

  function openDialog(action) {
    if (!state.detail) return;
    elements.dialogConfirm.disabled = false;
    elements.dialogCancel.disabled = false;
    state.dialogAction = action;
    elements.rejectField.hidden = action !== "reject";
    elements.rejectReason.value = "";
    elements.rejectError.textContent = "";
    const detail = state.detail;
    const data = {
      approve: [
        "确认批准当前版本",
        "批准会记录当前 Bundle 的不可变审核决定，并预留唯一 Publication。批准后仍需手动发布。",
        `候选：${detail.candidateId}\nBundle：${detail.latestBundle?.versionTag ?? "不可用"}\n标题：${safeString(detail.titleZh, detail.sourceTitle)}`,
        "确认批准"
      ],
      reject: [
        "确认拒绝当前版本",
        "拒绝会记录不可变决定与原因，不创建 Publication，也不会删除来源证据。",
        `候选：${detail.candidateId}\nBundle：${detail.latestBundle?.versionTag ?? "不可用"}\n来源：${detail.sourceDisplayName}`,
        "确认拒绝"
      ],
      publish: [
        "确认手动发布",
        "发布是批准后的第二次显式动作。继续后需要使用通行密钥完成新鲜再认证。",
        `Public ID：${detail.publication?.publicId ?? "不可用"}\nBundle：${detail.latestBundle?.versionTag ?? "不可用"}\n当前状态：Publication=queued`,
        "验证并手动发布"
      ],
      discard: [
        "丢弃未保存输入？",
        "当前输入尚未生成新的审核 Bundle。继续会丢弃这些修改。",
        `候选：${detail.candidateId}\n当前 Bundle：${detail.latestBundle?.versionTag ?? "尚未生成"}`,
        "丢弃并继续"
      ]
    }[action];
    elements.dialogTitle.textContent = data[0];
    elements.dialogCopy.textContent = data[1];
    elements.dialogSummary.textContent = data[2];
    elements.dialogConfirm.textContent = data[3];
    elements.dialogConfirm.className = action === "reject" || action === "discard" ? "danger-button" : "primary-button";
    elements.dialog.showModal();
    elements.dialogCancel.focus();
  }

  function requestNavigation(next) {
    if (!state.dirty) {
      next();
      return;
    }
    state.pendingNavigation = next;
    openDialog("discard");
  }

  function returnToQueue() {
    requestNavigation(() => {
      elements.root.dataset.mobileView = "list";
      window.requestAnimationFrame(() => {
        window.scrollTo(0, state.listScrollY);
        const selected = elements.queueList.querySelector("[aria-current='true']");
        selected?.focus({ preventScroll: true });
      });
    });
  }

  async function selectCandidate(candidateId, switchMobile) {
    state.selectedId = candidateId;
    state.listScrollY = window.scrollY;
    renderQueue();
    showSystem("…", "正在读取详情", "保持队列位置；详情读取完成前不开放任何写操作。", null, null);
    try {
      state.detail = await state.adapter.detail(candidateId);
      if (state.detail.schemaVersion !== REVIEW_SCHEMA || state.detail.candidateId !== candidateId) {
        throw new AdminUiError("审核详情与请求候选不匹配", { reasonCode: "ADMIN_RESPONSE_INVALID" });
      }
      renderDetail();
      if (switchMobile) elements.root.dataset.mobileView = "detail";
    } catch (error) {
      handleDetailLoadError(error);
    }
  }

  function handleDetailLoadError(error) {
    const adminError = error instanceof AdminUiError ? error : new AdminUiError("详情读取失败", { reasonCode: "ADMIN_UI_FAILURE" });
    if (adminError.status === 401) {
      showAuth({ title: "会话已失效", copy: "请重新使用通行密钥登录。", error: true });
      return;
    }
    showSystem("!", "审核详情读取失败", adminError.reasonCode, "重试同一读取", () => selectCandidate(state.selectedId, false));
  }

  async function loadList(options = {}) {
    showApp();
    elements.queueSearch.disabled = true;
    elements.refreshQueue.disabled = true;
    elements.queueSummary.textContent = "正在读取真实候选";
    elements.queueList.replaceChildren();
    showSystem("…", "正在读取审核队列", "等待真实 Admin API 返回候选；不会回退到 fixture。", null, null);
    try {
      const result = await state.adapter.list();
      state.items = result.items;
      elements.queueSearch.disabled = false;
      elements.refreshQueue.disabled = false;
      renderQueue();
      if (state.items.length === 0) {
        state.selectedId = null;
        state.detail = null;
        showSystem("0", "暂无待审核内容", "当前没有满足完整性和审核条件的真实候选。", "刷新队列", () => loadList());
        return;
      }
      const requestedId = options.selectId ?? state.selectedId;
      const selected = state.items.find((item) => item.candidateId === requestedId) ?? state.items[0];
      await selectCandidate(selected.candidateId, options.switchMobile === true);
    } catch (error) {
      const adminError = error instanceof AdminUiError ? error : new AdminUiError("队列读取失败", { reasonCode: "ADMIN_UI_FAILURE" });
      if (adminError.status === 401 || adminError.reasonCode === "ADMIN_SESSION_REQUIRED") {
        showAuth({ title: "需要通行密钥", copy: "当前没有有效的私有 Admin 会话。", error: false });
        return;
      }
      showApp();
      const title = adminError.status === 503 ? "Admin 服务暂不可用" : "审核队列读取失败";
      showSystem("!", title, adminError.reasonCode, "重试同一读取", () => loadList());
      elements.queueSummary.textContent = "真实队列暂不可读";
    }
  }

  async function refreshCurrent() {
    if (!state.selectedId) {
      await loadList();
      return;
    }
    await loadList({ selectId: state.selectedId, switchMobile: false });
  }

  function handleDeliveryError(error, deliveryId) {
    const adminError = error instanceof AdminUiError
      ? error
      : new AdminUiError("投递收据读取失败", { reasonCode: "ADMIN_UI_FAILURE" });
    if (adminError.status === 401 || adminError.reasonCode === "ADMIN_SESSION_REQUIRED") {
      showAuth({ title: "会话已失效", copy: "重新登录后仍只查询同一 delivery。", error: true });
      return;
    }
    const title = adminError.status === 404
      ? "同一投递收据尚不可用"
      : adminError.status === 409
        ? "同一投递状态正在变化"
        : adminError.status === 503
          ? "投递收据服务暂不可用"
          : "同一投递收据读取失败";
    showOperationStatus(title, `${deliveryId} · ${adminError.reasonCode} · 不会创建新的 publish。`, adminError.status === 404 || adminError.status === 409 ? "warning" : "error");
  }

  async function checkDelivery() {
    if (!state.selectedId || state.busy) return;
    const deliveryId = state.detail?.delivery?.id;
    if (typeof deliveryId !== "string" || !/^op-snapshot-[0-9a-f]{64}$/.test(deliveryId)) {
      handleDeliveryError(new AdminUiError("当前 delivery 标识不可用", { reasonCode: "PROJECTION_RECEIPT_UNKNOWN" }), safeString(deliveryId));
      return;
    }
    setBusy(true);
    let failure = null;
    try {
      const result = await state.adapter.checkDelivery(state.selectedId, deliveryId);
      state.deliveryReceipts.set(state.selectedId, result.receipt);
      state.detail = result.detail;
      renderDetail();
      toast("已检查同一投递状态");
    } catch (error) {
      failure = error;
    } finally {
      setBusy(false);
    }
    if (failure) handleDeliveryError(failure, deliveryId);
  }

  async function login() {
    showAuth({ title: "等待通行密钥", copy: "请在系统验证面板完成身份确认。", loading: true });
    try {
      await state.adapter.login();
      await loadList();
    } catch (error) {
      const reason = error instanceof AdminUiError ? error.reasonCode : "ADMIN_PASSKEY_FAILURE";
      showAuth({ title: "通行密钥登录未完成", copy: reason, error: true });
    }
  }

  async function bootstrap(event) {
    event.preventDefault();
    const token = elements.bootstrapToken.value;
    if (token.length < 1) return;
    showAuth({ title: "正在注册通行密钥", copy: "完成系统验证后仍需使用通行密钥登录。", loading: true });
    try {
      const result = await state.adapter.bootstrap(token);
      elements.bootstrapToken.value = "";
      showAuth({ title: "通行密钥已注册", copy: `凭据数量 ${String(result.credentialCount ?? "已更新")}；现在可以登录。` });
    } catch (error) {
      const reason = error instanceof AdminUiError ? error.reasonCode : "ADMIN_PASSKEY_FAILURE";
      showAuth({ title: "通行密钥注册未完成", copy: reason, error: true });
    }
  }

  elements.themeToggle.addEventListener("click", () => {
    setTheme(elements.root.dataset.theme === "dark" ? "light" : "dark");
  });
  elements.loginPasskey.addEventListener("click", login);
  elements.showBootstrap.addEventListener("click", () => {
    elements.bootstrapForm.hidden = false;
    elements.bootstrapToken.focus();
  });
  elements.cancelBootstrap.addEventListener("click", () => {
    elements.bootstrapToken.value = "";
    elements.bootstrapForm.hidden = true;
    elements.showBootstrap.focus();
  });
  elements.bootstrapForm.addEventListener("submit", bootstrap);
  elements.queueSearch.addEventListener("input", renderQueue);
  elements.refreshQueue.addEventListener("click", () => requestNavigation(() => loadList({ selectId: state.selectedId })));
  elements.mobileBack.addEventListener("click", returnToQueue);
  elements.editorForm.addEventListener("submit", saveRevision);
  elements.titleInput.addEventListener("input", setDirty);
  elements.summaryInput.addEventListener("input", setDirty);
  elements.notesInput.addEventListener("input", setDirty);
  elements.dialogCancel.addEventListener("click", () => {
    state.pendingNavigation = null;
    elements.dialog.close();
  });
  elements.dialogForm.addEventListener("submit", (event) => {
    event.preventDefault();
    confirmAction();
  });
  elements.dialog.addEventListener("cancel", () => {
    state.pendingNavigation = null;
  });
  window.addEventListener("beforeunload", (event) => {
    if (!state.dirty) return;
    event.preventDefault();
    event.returnValue = "";
  });

  async function start() {
    setTheme(initialTheme());
    if (fixtureRequested && !fixtureAllowed) {
      showAuth({ title: "Fixture 已拒绝", copy: "验收 fixture 只允许 file 或 loopback 来源。", error: true });
      return;
    }
    if (fixtureMode) {
      state.adapter = new FixtureAdminAdapter();
      elements.environmentBadge.hidden = false;
      elements.fixtureWarning.hidden = false;
      showApp();
      await loadList({ switchMobile: false });
      if (searchParams.get("view") === "detail") elements.root.dataset.mobileView = "detail";
      return;
    }
    state.adapter = new RealAdminAdapter();
    showAuth({ title: "正在检查会话", copy: "等待同源 Admin 服务响应。", loading: true });
    await loadList();
  }

  start().catch((error) => {
    const reason = error instanceof AdminUiError ? error.reasonCode : "ADMIN_UI_FAILURE";
    showAuth({ title: "Admin UI 启动失败", copy: reason, error: true });
  });
}());
