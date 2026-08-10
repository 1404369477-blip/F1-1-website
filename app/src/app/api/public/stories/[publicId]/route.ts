import { asPublicReadError } from "@/server/public/error.ts";
import { handlePublicStory, publicProblem } from "@/server/public/http.ts";
import { withPublicStoryRepository } from "@/server/public/runtime.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ publicId: string }> };

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { publicId } = await context.params;
    return withPublicStoryRepository((repository) => handlePublicStory(publicId, repository, request));
  } catch (error) {
    return publicProblem(asPublicReadError(error).reasonCode, "/api/public/stories");
  }
}
