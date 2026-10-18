import { receivePayosWebhook } from "@/server/payos-payments";
import { readBody, json, failure } from "@/server/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    return json(await receivePayosWebhook(await readBody(request)));
  } catch (e) {
    return failure(e);
  }
}
