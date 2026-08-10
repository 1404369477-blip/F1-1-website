import { handleNextAdminRequest } from "@/server/source-management/http.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request): Promise<Response> {
  return handleNextAdminRequest(request, "/api/admin/sources");
}

export function POST(request: Request): Promise<Response> {
  return handleNextAdminRequest(request, "/api/admin/sources");
}
