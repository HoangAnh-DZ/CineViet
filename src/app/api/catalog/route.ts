import { searchCatalog } from "@/server/catalog";
import { failure, json } from "@/server/http";
import { throttlePublic } from "@/server/request-limit";
export async function GET(request: Request) {
  try {
    await throttlePublic(request, "catalog");
    return json(await searchCatalog(Object.fromEntries(new URL(request.url).searchParams)));
  } catch (e) {
    return failure(e);
  }
}
