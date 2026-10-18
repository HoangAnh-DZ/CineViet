import { requireAdmin } from "@/server/admin";
import { withdrawalTransactions } from "@/server/dashboard";
import { json, failure } from "@/server/http";
export async function GET(request: Request) {
  try {
    const user = await requireAdmin();
    return json(
      await withdrawalTransactions(user.id, Object.fromEntries(new URL(request.url).searchParams)),
    );
  } catch (error) {
    return failure(error);
  }
}
