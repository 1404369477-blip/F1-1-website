export const IS_PUBLIC_STATIC_SITE = process.env.NEXT_PUBLIC_F1_STATIC_SITE === "true";
export const PUBLIC_STATIC_BASE_PATH = "";

export function publicStoryHref(publicId: string): string {
  if (!isPublicStaticId(publicId)) throw new Error("PUBLIC_ID_INVALID");
  return IS_PUBLIC_STATIC_SITE
    ? `/stories/${publicId}/`
    : `/stories/${encodeURIComponent(publicId)}`;
}

/** Supports the permanent document and previously shared query links without accepting path traversal. */
export function publicStoryIdFromLocation(pathname: string, search: string): string | null {
  const ids = new URLSearchParams(search).getAll("publicId");
  const match = /^\/stories\/(public-[a-z0-9-]+)\/(?:index\.html)?$/u.exec(pathname);
  if (match && isPublicStaticId(match[1])) {
    return ids.length === 0 || (ids.length === 1 && ids[0] === match[1]) ? match[1] : null;
  }
  if (pathname !== "/stories/" && pathname !== "/stories" && pathname !== "/stories/index.html") return null;
  return ids.length === 1 && isPublicStaticId(ids[0]) ? ids[0] : null;
}
import { isPublicStaticId } from "./public-static-schema";
