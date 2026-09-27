"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { StoryDetailExperience } from "../../../src/features/stories/story-detail-experience";
import { publicStoryIdFromLocation } from "../../../src/features/stories/public-site-config";
import { PublicStaticNotFound } from "./static-not-found";

function subscribeLocation(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
}

const readLocation = (): string => publicStoryIdFromLocation(window.location.pathname, window.location.search) ?? "";
const serverLocation = (): null => null;

export function StoryQuery() {
  // Subscribe to Next query navigation too; the static shell's serialized pathname is /stories/.
  useSearchParams();
  const publicId = useSyncExternalStore(subscribeLocation, readLocation, serverLocation);
  const onStateChange = useCallback((status: "loading" | "ready" | "error" | "not-found") => {
    const document = window.document.getElementById("public-story-document");
    const enhancement = window.document.getElementById("public-story-enhancement");
    const hasDocument = Boolean(document?.querySelector("article"));
    if (enhancement) enhancement.hidden = status === "loading" && hasDocument;
    // Keep readable server content on a temporary fetch error; a verified withdrawal must hide it.
    if (document) document.hidden = status === "ready" || status === "not-found";
  }, []);
  useEffect(() => {
    if (publicId !== null) onStateChange(publicId ? "loading" : "not-found");
  }, [publicId, onStateChange]);
  if (publicId === null) return null;
  if (publicId === "") return <PublicStaticNotFound />;
  return <StoryDetailExperience publicId={publicId} onStateChange={onStateChange} />;
}
