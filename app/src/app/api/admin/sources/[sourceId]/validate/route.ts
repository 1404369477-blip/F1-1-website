import { handleNextAdminRequest } from "@/server/source-management/http.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ sourceId: string }> };
export async function POST(request: Request, context: Context): Promise<Response> {
  const { sourceId } = await context.params;
  return handleNextAdminRequest(request, `/api/admin/sources/${sourceId}/validate`);
}
