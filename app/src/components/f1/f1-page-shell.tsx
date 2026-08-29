"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode
} from "react";

import { readHashParam, setHashParams } from "../../features/stories/hash-params";
import {
  getTimelineSearchQuery,
  setTimelineSearchQuery,
  subscribeTimelineSearch
} from "../../features/stories/timeline-search";
import {
  F1_DEFAULT_THEME,
  F1_THEME_COOKIE_KEY,
  isF1Theme,
  readThemePreference,
  writeThemePreference,
  type F1Theme,
  type ThemePreferenceStorage
} from "./theme-preference";

function getClientThemeStorage(): ThemePreferenceStorage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function readClientThemePreference(fallback: F1Theme): F1Theme {
  if (typeof window === "undefined") return fallback;
  const urlTheme = readHashParam("theme");
  if (isF1Theme(urlTheme)) return urlTheme;
  return readThemePreference(getClientThemeStorage(), fallback);
}

const themePreferenceListeners = new Set<() => void>();

function subscribeThemePreference(onStoreChange: () => void): () => void {
  const handleExternalChange = (): void => onStoreChange();
  themePreferenceListeners.add(onStoreChange);
  window.addEventListener("storage", handleExternalChange);
  window.addEventListener("hashchange", handleExternalChange);
  return () => {
    themePreferenceListeners.delete(onStoreChange);
    window.removeEventListener("storage", handleExternalChange);
    window.removeEventListener("hashchange", handleExternalChange);
  };
}

function publishThemePreferenceChange(): void {
  themePreferenceListeners.forEach((listener) => listener());
}

function writeThemePreferenceCookie(theme: F1Theme): void {
  try {
    document.cookie = `${F1_THEME_COOKIE_KEY}=${theme}; Path=/; Max-Age=31536000; SameSite=Strict`;
  } catch {
    // 非敏感显示偏好的 cookie 不可写时，仍保留既有 localStorage 会话能力。
  }
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function F1PageShell({
  children,
  initialTheme = F1_DEFAULT_THEME
}: {
  children: ReactNode;
  initialTheme?: F1Theme;
}) {
  const pathname = usePathname();
  // getServerSnapshot 保证 SSR 与 hydration 使用同一确定值；React 在 hydration
  // 提交时对齐浏览器偏好，避免客户端首 render 分叉和显式延迟帧。
  const theme = useSyncExternalStore(
    subscribeThemePreference,
    () => readClientThemePreference(initialTheme),
    () => initialTheme
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const utilityRef = useRef<HTMLDivElement | null>(null);
  const scrollRestoreCleanupRef = useRef<(() => void) | null>(null);
  const searchValue = useSyncExternalStore(subscribeTimelineSearch, getTimelineSearchQuery, () => "");
  const [mobileViewMode, setMobileViewMode] = useState<"timeline" | "cards">(() => {
    if (typeof window === "undefined") return "timeline";
    const fromHash = readHashParam("mode");
    if (fromHash === "cards") return "cards";
    if (fromHash === "timeline") return "timeline";
    try {
      return window.localStorage?.getItem("f1_view_mode") === "cards" ? "cards" : "timeline";
    } catch {
      return "timeline";
    }
  });

  useEffect(() => {
    const handleModeChange = () => {
      const fromHash = readHashParam("mode");
      if (fromHash === "cards") {
        setMobileViewMode("cards");
        return;
      }
      if (fromHash === "timeline") {
        setMobileViewMode("timeline");
        return;
      }
      try {
        const stored = window.localStorage?.getItem("f1_view_mode");
        setMobileViewMode(stored === "cards" ? "cards" : "timeline");
      } catch {}
    };
    window.addEventListener("hashchange", handleModeChange);
    window.addEventListener("storage", handleModeChange);
    return () => {
      window.removeEventListener("hashchange", handleModeChange);
      window.removeEventListener("storage", handleModeChange);
    };
  }, []);

  const handleViewModeChange = (mode: "timeline" | "cards") => {
    setMobileViewMode(mode);
    setHashParams({ mode: mode === "cards" ? "cards" : undefined });
    try {
      window.localStorage?.setItem("f1_view_mode", mode);
    } catch {}
    window.dispatchEvent(new Event("storage"));
  };

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.body.dataset.theme = theme;
  }, [theme]);

  useEffect(() => () => scrollRestoreCleanupRef.current?.(), []);

  useEffect(() => {
    if (!settingsOpen) return;
    const closeOutside = (event: PointerEvent): void => {
      const target = event.target;
      if (target instanceof Node && utilityRef.current?.contains(target)) return;
      setSettingsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setSettingsOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [settingsOpen]);

  const selectTheme = (next: F1Theme): void => {
    document.documentElement.dataset.theme = next;
    document.body.dataset.theme = next;
    writeThemePreference(getClientThemeStorage(), next);
    writeThemePreferenceCookie(next);
    setHashParams({ theme: next });
    publishThemePreferenceChange();
  };

  const toggleTheme = (): void => {
    selectTheme(theme === "dark" ? "light" : "dark");
  };

  const handleSearchInput = (event: ChangeEvent<HTMLInputElement>): void => {
    const value = event.currentTarget.value;
    setTimelineSearchQuery(value);
    setHashParams({ search: value || undefined });
  };

  const scrollToTop = (): void => {
    scrollRestoreCleanupRef.current?.();
    const readingStart = document.getElementById("main-content");
    const focusReadingStart = (): void => {
      readingStart?.focus({ preventScroll: true });
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    };
    const reducedMotion = prefersReducedMotion();
    window.scrollTo({ top: 0, left: 0, behavior: reducedMotion ? "auto" : "smooth" });
    if (reducedMotion || window.scrollY === 0) {
      queueMicrotask(focusReadingStart);
      scrollRestoreCleanupRef.current = null;
      return;
    }

    let restored = false;
    const finish = (): void => {
      if (restored) return;
      restored = true;
      window.removeEventListener("scrollend", finish);
      window.clearTimeout(fallbackTimer);
      focusReadingStart();
      scrollRestoreCleanupRef.current = null;
    };
    const fallbackTimer = window.setTimeout(finish, 1200);
    window.addEventListener("scrollend", finish, { once: true });
    scrollRestoreCleanupRef.current = () => {
      restored = true;
      window.removeEventListener("scrollend", finish);
      window.clearTimeout(fallbackTimer);
    };
  };

  const handleScrollToTopKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    scrollToTop();
  };

  const showSearch = pathname === "/";
  const themeLabel = theme === "dark" ? "深" : "浅";
  const nextThemeLabel = theme === "dark" ? "浅色" : "深色";

  return (
    <div className="f1-shell">
      <header className="topbar">
        <div className="app topbar-inner">
          <Link className="brand-min trace" href="/" aria-label="F1+1 公开资讯首页">
            <span className="brand-glyph" aria-hidden="true" />
            F1+1
          </Link>
          <div className="top-actions">
            {showSearch ? (
              <div className="search trace">
                <input
                  type="search"
                  id="search-input"
                  placeholder="搜索时间线"
                  aria-label="搜索当前已加载的时间线"
                  autoComplete="off"
                  spellCheck={false}
                  value={searchValue}
                  onInput={handleSearchInput}
                />
              </div>
            ) : null}
          </div>
        </div>
      </header>

      {children}

      <div
        className={`utility-anchor${settingsOpen ? " is-open" : ""}`}
        ref={utilityRef}
        data-testid="utility-anchor"
      >
        <div className="utility-inner">
          <aside
            className={`settings-panel${settingsOpen ? " is-open" : ""}`}
            id="site-settings-panel"
            aria-label="页面设置"
            aria-hidden={!settingsOpen}
          >
            <div className="settings-head">
              <strong>设置</strong>
              <span>本地显示</span>
            </div>
            <div className="settings-list" aria-label="页面显示设置项">
              <div className="settings-item">
                <span>手机视图</span>
                <span className="settings-mode-seg" role="group" aria-label="移动端视图模式">
                  <button
                    type="button"
                    className={`settings-mode-btn${mobileViewMode === "timeline" ? " is-active" : ""}`}
                    onClick={() => handleViewModeChange("timeline")}
                  >时间线</button>
                  <button
                    type="button"
                    className={`settings-mode-btn${mobileViewMode === "cards" ? " is-active" : ""}`}
                    onClick={() => handleViewModeChange("cards")}
                  >沉浸卡片</button>
                </span>
              </div>
              <div className="settings-item"><span>语言</span><span>简体中文 <em>已就绪</em></span></div>
              <div className="settings-item"><span>来源偏好</span><span>全部来源 <em>占位</em></span></div>
              <div className="settings-item"><span>通知</span><span>关闭 <em>占位</em></span></div>
            </div>
            <p className="settings-note">手机端可在「时间线」与「沉浸卡片」间切换。这些选项暂不保存，也不会调用 API。主题可通过下方独立按钮切换。</p>
          </aside>

          <div className="utility-row" role="group" aria-label="页面工具">
            <button
              className="utility-button trace"
              type="button"
              onClick={scrollToTop}
              onKeyDown={handleScrollToTopKeyDown}
            >↑ 回到顶部</button>
            <button
              className="utility-button trace"
              type="button"
              aria-expanded={settingsOpen}
              aria-controls="site-settings-panel"
              onClick={() => setSettingsOpen((open) => !open)}
            >
              {settingsOpen ? "收起" : "设置"}
            </button>
            <button
              className="utility-button trace"
              type="button"
              aria-pressed={theme === "dark"}
              aria-label={`当前${theme === "dark" ? "深色" : "浅色"}主题，切换为${nextThemeLabel}主题`}
              onClick={toggleTheme}
            >
              {themeLabel}
            </button>
          </div>
        </div>
      </div>

      <div className="visually-hidden" aria-live="polite" aria-atomic="true">
        公开资讯页面，通过同源公开 API 读取已发布内容。
      </div>
    </div>
  );
}
