import { moneyConfig } from "@/server/money-config";
import { failure, json } from "@/server/http";
export async function GET() {
  try {
    return json(await moneyConfig());
  } catch (error) {
    return failure(error);
  }
}
