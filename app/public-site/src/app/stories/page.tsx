import { Suspense } from "react";

import { StoryQuery } from "../../components/story-query";

export default function PublicStaticStoryPage() {
  return <>
    <div id="public-story-document" suppressHydrationWarning dangerouslySetInnerHTML={{ __html: "<!--F1_PUBLIC_STORY_DOCUMENT-->" }} />
    <div id="public-story-enhancement" hidden>
      <Suspense fallback={null}><StoryQuery /></Suspense>
    </div>
  </>;
}
