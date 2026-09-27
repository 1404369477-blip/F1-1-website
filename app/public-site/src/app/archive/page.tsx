"use client";

import { useEffect, useState } from "react";

type ArchiveItem = { publicId: string; title: string; publishedAt: string };
type ArchiveMonth = { id: string; label: string; items: ArchiveItem[] };

export default function ArchivePage() {
  const [months, setMonths] = useState<ArchiveMonth[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch("/archive.json")
      .then((response) => {
        if (!response.ok) throw new Error("missing");
        return response.json() as Promise<{ months?: ArchiveMonth[] }>;
      })
      .then((body) => setMonths(body.months ?? []))
      .catch(() => setFailed(true));
  }, []);

  return (
    <main className="app" id="main-content">
      <div className="shell">
        <p className="timeline-kicker"><a href="/">返回时间线</a></p>
        <h1 className="tl-title">已归档</h1>
        {failed ? <p>归档列表暂时打不开，可以稍后重试。</p> : null}
        {months && months.length === 0 ? <p>还没有超过公开窗口的条目。</p> : null}
        {months?.map((month) => (
          <section key={month.id}>
            <h2 className="tl-d">{month.label}</h2>
            <ul>
              {month.items.map((item) => (
                <li key={item.publicId}>
                  <a href={`/stories/?${new URLSearchParams({ publicId: item.publicId }).toString()}`}>{item.title}</a>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
