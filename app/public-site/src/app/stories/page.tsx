import { Suspense } from "react";

import { StoryQuery } from "../../components/story-query";

export default function PublicStaticStoryPage() {
  return <Suspense fallback={null}><StoryQuery /></Suspense>;
}
