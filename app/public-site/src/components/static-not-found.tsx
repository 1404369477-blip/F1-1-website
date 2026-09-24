import Link from "next/link";

export function PublicStaticNotFound() {
  return (
    <main className="app timeline-detail-page" id="main-content" tabIndex={-1}>
      <div className="shell">
        <section className="timeline" aria-label="F1+1 公开内容详情">
          <Link className="detail-back-link" href="/">← 返回资讯流</Link>
          <div className="state-box" role="alert" aria-label="这条公开内容不存在或当前不可用">
            <span className="sb-code" aria-hidden="true">404</span>
            <span className="sb-title">这条公开内容不存在或当前不可用</span>
            <span className="sb-msg">链接可能已经失效，也可能尚未公开。</span>
          </div>
        </section>
      </div>
    </main>
  );
}
