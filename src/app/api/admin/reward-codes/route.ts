import { requireAdmin } from "@/server/admin";
import { checkOrigin, failure, json, readBody } from "@/server/http";
import { createRewardCode, listRewardCodes } from "@/server/reward-codes";
export async function GET() {
  try {
    return json({ items: await listRewardCodes((await requireAdmin()).id) });
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    return json(await createRewardCode((await requireAdmin()).id, await readBody(request)), 201);
  } catch (error) {
    return failure(error);
  }
}
