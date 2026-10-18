import "server-only";
import { checkBotId } from "botid/server";
import { ApiError } from "./http";

export async function checkRegistrationBrowser() {
  // Pin Basic on both sides so project-level changes cannot enable paid analysis here.
  const verification = await checkBotId({ advancedOptions: { checkLevel: "basic" } });
  if (
    verification.isBot !== false ||
    verification.isHuman !== true ||
    verification.isVerifiedBot ||
    (process.env.NODE_ENV === "production" && verification.bypassed)
  )
    throw new ApiError(403, "Không thể xác minh trình duyệt. Vui lòng tải lại trang để thử lại.");
}
