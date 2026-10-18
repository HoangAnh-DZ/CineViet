import { shortsFeed } from "@/server/shorts";
import { throttlePublic } from "@/server/request-limit";
import { ApiError, failure } from "@/server/http";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    await throttlePublic(request, "shorts");
    return Response.json(await shortsFeed(new URL(request.url).searchParams.get("cursor") ?? "0"), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof ApiError) return failure(error);
    return Response.json(
      {
        error:
          error instanceof RangeError
            ? "Mốc tải video không hợp lệ."
            : "Chưa tải được video. Vui lòng thử lại.",
      },
      { status: error instanceof RangeError ? 400 : 503 },
    );
  }
}
