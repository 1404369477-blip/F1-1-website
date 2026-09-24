(() => {
  "use strict";

  const OVERVIEW_SCHEMA = "admin-operations-overview-v1";
  const RECENT_THREE_SCHEMA = "admin-bilingual-v1";
  const SHANGHAI = "Asia/Shanghai";
  const endpoints = Object.freeze({
    overview: "/api/admin/operations/overview",
    recentThree: "/api/admin/bilingual/recent-three",
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
    title: document.querySelector("#ops-title"),
    asOf: document.querySelector("#ops-as-of"),
    flag: document.querySelector("#ops-flag"),
    flagText: document.querySelector("#ops-flag-text"),
    heroTitle: document.querySelector("#ops-hero-title"),
    heroCopy: document.querySelector("#ops-hero-copy"),
    metricValue: document.querySelector("#ops-metric-value"),
    metricHint: document.querySelector("#ops-metric-hint"),
    track: document.querySelector("#ops-track"),
    pin: document.querySelector("#ops-pin"),
    stationCopies: Object.freeze([
      document.querySelector("#ops-station-1-copy"),
      document.querySelector("#ops-station-2-copy"),
      document.querySelector("#ops-station-3-copy"),
      document.querySelector("#ops-station-4-copy"),
      document.querySelector("#ops-station-5-copy")
    ]),
    stations: Object.freeze([
      document.querySelector("#ops-station-1"),
      document.querySelector("#ops-station-2"),
      document.querySelector("#ops-station-3"),
      document.querySelector("#ops-station-4"),
      document.querySelector("#ops-station-5")
    ]),
    miniCard: document.querySelector("#ops-mini-card"),
    packetTitle: document.querySelector("#ops-packet-title"),
    packetCopy: document.querySelector("#ops-packet-copy"),
    days: document.querySelector("#ops-days"),
    trafficRing: document.querySelector("#ops-traffic-ring"),
    trafficRingText: document.querySelector("#ops-traffic-ring-text"),
    trafficTitle: document.querySelector("#ops-traffic-title"),
    trafficCopy: document.querySelector("#ops-traffic-copy"),
    backupRing: document.querySelector("#ops-backup-ring"),
    backupRingText: document.querySelector("#ops-backup-ring-text"),
    backupTitle: document.querySelector("#ops-backup-title"),
    backupCopy: document.querySelector("#ops-backup-copy"),
    safety: document.querySelector("#ops-safety"),
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
      ADMIN_REQUEST_TIMEOUT: "Admin 服务读取超时，页面会自动重试。",
      ADMIN_NETWORK_FAILURE: "Admin 服务连接中断，请检查私有网络后重试。",
      ADMIN_RESPONSE_INVALID: "Admin 服务响应无法校验，请刷新后重试。",
      ADMIN_PASSKEY_UNAVAILABLE: "当前浏览器不支持通行密钥。",
      ADMIN_PASSKEY_CANCELLED: "通行密钥验证已取消。"
    };
    return known[code] ?? `读取失败（${code}）`;
  }

  const REQUEST_TIMEOUT_MS = 10000;

  async function requestJson(path, options = {}) {
    const controller = new AbortController();
    let timeout;
    const deadline = new Promise((_, reject) => {
      timeout = window.setTimeout(() => {
        reject(new AdminUiError("Admin 服务读取超时", { reasonCode: "ADMIN_REQUEST_TIMEOUT" }));
        controller.abort();
      }, REQUEST_TIMEOUT_MS);
    });
    const read = async () => {
      let response;
      try {
        response = await window.fetch(path, {
          signal: controller.signal,
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
    };
    try {
      // Bound both response headers and body decoding; late responses cannot reach rendering.
      return await Promise.race([read(), deadline]);
    } finally {
      window.clearTimeout(timeout);
    }
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

  function showUnreadPipeline() {
    elements.flag.className = "ops-flag";
    elements.flagText.textContent = "读不到";
    elements.heroTitle.textContent = "先不要把下面当成现在的状态";
    elements.pin.hidden = true;
    elements.track.dataset.halt = "none";
    setStation(0, "idle", "还没读到");
    setStation(1, "idle", "还没读到");
    setStation(2, "idle", "还没读到");
    setStation(3, "idle", "还没读到");
    setStation(4, "idle", "还没读到");
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

  function formatMonthDay(iso) {
    const parts = shanghaiParts(iso);
    if (!parts) return null;
    return `${parts.month} 月 ${parts.day} 日`;
  }

  function calendarDaysBetween(fromIso, toIso) {
    const from = shanghaiParts(fromIso);
    const to = shanghaiParts(toIso);
    if (!from || !to) return null;
    const delta = Date.UTC(to.year, to.month - 1, to.day) - Date.UTC(from.year, from.month - 1, from.day);
    return Math.round(delta / 86400000);
  }

  function addCalendarDays(parts, delta) {
    const utc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + delta));
    return { year: utc.getUTCFullYear(), month: utc.getUTCMonth() + 1, day: utc.getUTCDate() };
  }

  function setStation(index, kind, copy) {
    const station = elements.stations[index];
    const line = elements.stationCopies[index];
    if (!station || !line) return;
    station.className = `ops-station is-${kind}`;
    line.textContent = copy;
  }

  function readPipeline(overview) {
    const pipeline = isObject(overview.pipeline) ? overview.pipeline : {};
    const lastPublishedAt = typeof pipeline.lastPublishedAt === "string" ? pipeline.lastPublishedAt : null;
    const pendingReviewCount = Number.isFinite(Number(pipeline.pendingReviewCount))
      ? Math.max(0, Math.trunc(Number(pipeline.pendingReviewCount)))
      : 0;
    const waitingPublishCount = Number.isFinite(Number(pipeline.waitingPublishCount))
      ? Math.max(0, Math.trunc(Number(pipeline.waitingPublishCount)))
      : 0;
    return {
      lastPublishedAt,
      pendingReviewCount,
      waitingPublishCount,
      publishBlocked: pipeline.publishBlocked === true,
      collectionLive: pipeline.collectionLive === true,
      automaticReview: 0,
      automaticPublish: 0
    };
  }

  function renderDays(generatedAt, lastPublishedAt) {
    elements.days.replaceChildren();
    const generated = shanghaiParts(generatedAt);
    if (!generated) return;
    const published = lastPublishedAt ? shanghaiParts(lastPublishedAt) : null;
    const publishedUtc = published ? Date.UTC(published.year, published.month - 1, published.day) : null;
    // 唯一时间戳只证明最近发布当天；更早日期没有逐日记录。
    for (let offset = -7; offset <= 0; offset += 1) {
      const day = addCalendarDays(generated, offset);
      const dayUtc = Date.UTC(day.year, day.month - 1, day.day);
      const filled = publishedUtc !== null && dayUtc === publishedUtc;
      const item = document.createElement("div");
      item.className = filled ? "ops-day is-filled" : "ops-day is-empty";
      item.setAttribute("aria-label", `${day.month}/${day.day}：${filled ? "有发布记录" : "逐日发布状态未确认"}`);
      item.title = filled ? "最近发布当天" : "逐日发布状态未确认";
      const bar = document.createElement("div");
      bar.className = "ops-bar";
      const label = document.createElement("span");
      label.textContent = `${day.month}/${day.day}`;
      item.append(bar, label);
      elements.days.append(item);
    }
  }

  function producerStatus(overview, key) {
    return isObject(overview.producers) && isObject(overview.producers[key])
      ? overview.producers[key]
      : { status: "unavailable" };
  }

  function renderTraffic(overview) {
    const traffic = producerStatus(overview, "trafficStats");
    const available = traffic.status === "available";
    const requestCount = Number.isFinite(Number(traffic.requestCount))
      ? Math.max(0, Math.trunc(Number(traffic.requestCount)))
      : null;
    if (!available || requestCount === null) {
      elements.trafficRing.className = "ops-ring is-unwired";
      elements.trafficRingText.textContent = "未接";
      elements.trafficTitle.textContent = "本页暂未接线";
      elements.trafficCopy.textContent = "公开站计数器还没接线。这里不会显示 0 次访问。";
      return;
    }
    elements.trafficRing.className = "ops-ring is-ok";
    elements.trafficRingText.textContent = "有数";
    elements.trafficTitle.textContent = `${requestCount} 次请求`;
    elements.trafficCopy.textContent = "这是公开站收到的请求次数，不是独立访客。";
  }

  function renderBackup(overview) {
    const status = isObject(overview.producers) && isObject(overview.producers.backups)
      ? overview.producers.backups.status
      : "unavailable";
    if (status === "unavailable") {
      elements.backupRing.className = "ops-ring is-unwired";
      elements.backupRingText.textContent = "未接";
      elements.backupTitle.textContent = "本页暂未接线";
      elements.backupCopy.textContent = "备份在机器上跑，这里还没接上数据。";
      return;
    }
    elements.backupRing.className = "ops-ring is-unwired";
    elements.backupRingText.textContent = "未明";
    elements.backupTitle.textContent = "本页暂未接线";
    elements.backupCopy.textContent = "备份在机器上跑，这里还没接上数据。";
  }

  function renderPacket(lastPublishedAt, recentThree) {
    const monthDay = lastPublishedAt ? formatMonthDay(lastPublishedAt) : null;
    const items = isObject(recentThree) && Array.isArray(recentThree.items) ? recentThree.items : [];
    const latest = items.length > 0 && isObject(items[0]) ? items[0] : null;
    const cardDate = monthDay
      ? `${shanghaiParts(lastPublishedAt).month}/${shanghaiParts(lastPublishedAt).day}`
      : "";
    elements.miniCard.dataset.date = cardDate;
    if (latest && typeof latest.source_title === "string" && latest.source_title.trim()) {
      elements.packetTitle.textContent = latest.source_title.trim();
      elements.packetCopy.textContent = monthDay
        ? `最新稿 ${monthDay}。新卡片必须先通过第 2 站，才会出现下一张。`
        : "还没有读到发布时间。新卡片必须先通过第 2 站，才会出现下一张。";
      return;
    }
    elements.packetTitle.textContent = "现在网站上的那张「新闻卡片」停在终点";
    elements.packetCopy.textContent = monthDay
      ? `它是 ${monthDay} 那一版。新卡片必须先通过第 2 站，才会出现下一张。`
      : "还没有读到发布时间。新卡片必须先通过第 2 站，才会出现下一张。";
  }

  function renderOverview(overview, recentThree) {
    const pipeline = readPipeline(overview);
    const generatedAt = typeof overview.generatedAt === "string" ? overview.generatedAt : null;
    const rssActive = Number(overview.sources?.rssActive) || 0;
    const live = pipeline.collectionLive;
    const pending = pipeline.pendingReviewCount;
    const waiting = pipeline.waitingPublishCount;
    const blocked = pipeline.publishBlocked;
    const monthDay = pipeline.lastPublishedAt ? formatMonthDay(pipeline.lastPublishedAt) : null;
    const elapsed = pipeline.lastPublishedAt && generatedAt
      ? calendarDaysBetween(pipeline.lastPublishedAt, generatedAt)
      : null;

    elements.asOf.textContent = generatedAt ? formatAsOf(generatedAt) : "—";
    elements.title.textContent = live ? "采集控制门已开" : blocked ? "新稿发不出去" : "采集控制门未开";
    elements.flag.className = live && !blocked ? "ops-flag is-ok" : "ops-flag is-stop";
    elements.flagText.textContent = live && !blocked ? "控制门已开" : blocked ? "公开投递卡住" : "流水线未在转动";

    if (live && !blocked) {
      elements.heroTitle.textContent = monthDay ? `最近发布记录 ${monthDay}` : "采集控制门已开";
      elements.heroCopy.textContent = "控制面允许采集；定时任务是否在运行、最近抓取是否成功，仍需调度心跳和执行收据确认。";
    } else if (blocked) {
      elements.heroTitle.textContent = monthDay
        ? `公开站还开着，最新稿 ${monthDay}，但新的发不出去`
        : "公开站还开着，但新的发不出去";
      elements.heroCopy.textContent = waiting > 0
        ? `有 ${waiting} 条已经通过、等上站。上一版公开稿的投递还没记完，所以「通过并发布」会失败。`
        : "上一版公开稿的投递还没记完，所以「通过并发布」会失败。不是网站挂了。";
    } else {
      elements.heroTitle.textContent = monthDay
        ? `公开站还开着，新闻停在 ${monthDay}`
        : "公开站还开着，还没有读到发布时间";
      elements.heroCopy.textContent = "像工厂停在第二道工序：后面的中文整理、审核、发布都没东西可做。不是网站挂了。";
    }

    elements.metricValue.textContent = elapsed === null ? "—" : `${Math.max(0, elapsed)} 天`;
    elements.metricHint.textContent = "距离上次新稿已经过了这么久";

    setStation(0, rssActive > 0 ? "ok" : "idle", rssActive > 0 ? "有已启用的新闻信源" : "暂时没有可用信源");
    if (live) {
      setStation(1, "wait", "控制门已开，采集运行待确认");
      elements.pin.hidden = true;
      elements.track.dataset.halt = blocked ? "5" : "none";
    } else {
      setStation(1, "stop", "采集控制门未开");
      elements.pin.hidden = false;
      elements.track.dataset.halt = "2";
    }
    if (!live || pending === 0) {
      setStation(2, "idle", "整理任务运行状态待确认");
    } else {
      setStation(2, "wait", "有待审稿，整理运行待确认");
    }
    if (pending > 0) {
      setStation(3, "wait", `有 ${pending} 条待审`);
    } else if (waiting > 0) {
      setStation(3, blocked ? "stop" : "wait", `有 ${waiting} 条已通过、等上站`);
    } else {
      setStation(3, "wait", "后台能进，但没有新稿");
    }
    if (blocked) {
      setStation(4, "stop", monthDay ? `公开站仍在播 ${monthDay} 那一版。新稿发不出去。` : "上一版公开稿还没投递完");
    } else {
      setStation(4, "ok", monthDay ? `仍在播上次那一版。最新稿 ${monthDay}` : "还没有读到发布时间");
    }

    renderPacket(pipeline.lastPublishedAt, recentThree);
    renderDays(generatedAt, pipeline.lastPublishedAt);
    renderTraffic(overview);
    renderBackup(overview);
    elements.safety.textContent = "自动审核和自动发布按设定关闭，不是故障。采集停着的时候开了也不会有新稿。";
  }

  const OVERVIEW_REFRESH_MS = 15000;
  let overviewTimer = null;
  let overviewLoading = false;

  function stopOverviewRefresh() {
    window.clearInterval(overviewTimer);
    overviewTimer = null;
  }

  function startOverviewRefresh() {
    stopOverviewRefresh();
    if (document.hidden || elements.appView.hidden) return;
    overviewTimer = window.setInterval(() => {
      if (!document.hidden && !elements.appView.hidden) void refreshOverview();
    }, OVERVIEW_REFRESH_MS);
  }

  async function loadOverview() {
    const overview = requireSchema(await requestJson(endpoints.overview), OVERVIEW_SCHEMA);
    let recentThree = null;
    try {
      recentThree = requireSchema(await requestJson(endpoints.recentThree), RECENT_THREE_SCHEMA);
    } catch (error) {
      if (error instanceof AdminUiError && error.status === 401) throw error;
      recentThree = { items: [] };
    }
    showApp();
    renderOverview(overview, recentThree);
  }

  async function refreshOverview() {
    if (overviewLoading) return;
    overviewLoading = true;
    try {
      await loadOverview();
    } catch (error) {
      if (error instanceof AdminUiError && error.status === 401) {
        showAuth(error);
        stopOverviewRefresh();
        return;
      }
      showApp();
      elements.connectionState.textContent = "运行数据暂不可用";
      elements.title.textContent = "这页暂时读不到运行数据";
      elements.heroCopy.textContent = "请检查私有网络；页面会自动重试读取。";
      elements.asOf.textContent = "—";
      elements.metricValue.textContent = "—";
      elements.metricHint.textContent = "最近发布状态待确认";
      elements.days.replaceChildren();
      elements.miniCard.dataset.date = "";
      elements.packetTitle.textContent = "公开内容状态待确认";
      elements.packetCopy.textContent = "暂时无法读取最新发布记录。";
      showUnreadPipeline();
      renderTraffic({});
      renderBackup({});
      toast(errorCopy(error));
    } finally {
      overviewLoading = false;
    }
  }

  async function start() {
    setTheme(initialTheme());
    await refreshOverview();
    startOverviewRefresh();
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopOverviewRefresh();
    else if (!elements.appView.hidden) startOverviewRefresh();
  });

  elements.themeToggle.addEventListener("click", () => setTheme(elements.root.dataset.theme === "dark" ? "light" : "dark"));
  elements.loginPasskey.addEventListener("click", async () => {
    elements.loginPasskey.disabled = true;
    try {
      await login();
      await loadOverview();
      startOverviewRefresh();
    } catch (error) {
      showAuth(error);
    } finally {
      elements.loginPasskey.disabled = false;
    }
  });

  void start();
})();
