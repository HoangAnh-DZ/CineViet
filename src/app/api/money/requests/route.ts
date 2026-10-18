import { requireUser } from "@/server/auth";
import { json, failure } from "@/server/http";
import { userMoneyRequests } from "@/server/manual-money";
export async function GET() {
  try {
    return json(await userMoneyRequests((await requireUser()).id, "VND"));
  } catch (e) {
    return failure(e);
  }
}
