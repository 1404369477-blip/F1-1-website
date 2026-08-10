import { getHealthDto } from "../../../server/health";

export const dynamic = "force-dynamic";

export function GET(): Response {
  const health = getHealthDto();
  return Response.json(health, {
    status: health.status === "ready" ? 200 : 503,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "x-f1-scope": "local-only"
    }
  });
}
