import { handleNextAdminRequest } from "@/server/source-management/http.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ commandOperationId: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  const { commandOperationId } = await context.params;
  return handleNextAdminRequest(request, `/api/admin/operations/${commandOperationId}`);
}
