import { tenantPool } from "@/lib/db";
import { noStore } from "@/lib/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Used by the hosting platform's health check. Reports only up/down.
export async function GET() {
  try {
    await tenantPool().query("SELECT 1");
    return Response.json({ status: "ok" }, { headers: noStore });
  } catch {
    return Response.json(
      { status: "unavailable" },
      { status: 503, headers: noStore },
    );
  }
}
