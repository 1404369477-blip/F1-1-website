export const IS_PUBLIC_STATIC_SITE = process.env.NEXT_PUBLIC_F1_STATIC_SITE === "true";
export const PUBLIC_STATIC_BASE_PATH = "/f1plus1";

export function publicStoryHref(publicId: string): string {
  return IS_PUBLIC_STATIC_SITE
    ? `/stories/?${new URLSearchParams({ publicId }).toString()}`
    : `/stories/${encodeURIComponent(publicId)}`;
}
