import { asPublicReadError } from "@/server/public/error.ts";
import { handlePublicFeed, publicProblem } from "@/server/public/http.ts";
import { withPublicStoryRepository } from "@/server/public/runtime.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request): Response {
  try {
    return withPublicStoryRepository((repository) => handlePublicFeed(request, repository));
  } catch (error) {
    return publicProblem(asPublicReadError(error).reasonCode, "/api/public/feed");
  }
}
