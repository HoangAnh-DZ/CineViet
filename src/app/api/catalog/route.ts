import { searchCatalog } from "@/server/catalog";
import { failure, json } from "@/server/http";
export async function GET(request: Request) {
  try {
    return json(await searchCatalog(Object.fromEntries(new URL(request.url).searchParams)));
  } catch (e) {
    return failure(e);
  }
}
