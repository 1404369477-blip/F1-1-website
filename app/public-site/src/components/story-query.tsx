"use client";

import { useSearchParams } from "next/navigation";
import { StoryDetailExperience } from "../../../src/features/stories/story-detail-experience";
import { isPublicStaticId } from "../../../src/features/stories/public-static-schema";
import { PublicStaticNotFound } from "./static-not-found";

export function StoryQuery() {
  const params = useSearchParams();
  const ids = params.getAll("publicId");
  if (ids.length !== 1 || !isPublicStaticId(ids[0])) return <PublicStaticNotFound />;
  return <StoryDetailExperience publicId={ids[0]} />;
}
