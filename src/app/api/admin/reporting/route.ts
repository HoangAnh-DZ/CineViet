import { requireAdmin } from "@/server/admin";
import { throttleAuth } from "@/server/auth-core";
import { checkOrigin, failure, json, readBody } from "@/server/http";
import { classifyReportingTransaction, reportingCandidates } from "@/server/financial-reporting";
export async function GET() {
  try {
    const u = await requireAdmin();
    await throttleAuth(`admin-reporting-read:${u.id}`, 30);
    return json(await reportingCandidates(u.id));
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const u = await requireAdmin();
    await throttleAuth(`admin-reporting-write:${u.id}`, 10);
    return json(await classifyReportingTransaction(u.id, await readBody(request)));
  } catch (e) {
    return failure(e);
  }
}
