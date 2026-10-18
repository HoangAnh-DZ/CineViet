import "server-only";
import { z } from "zod";
import { ApiError } from "./http";
export async function banks() {
  try {
    const r = await fetch("https://api.vietqr.io/v2/banks", {
      next: { revalidate: 86400 },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) throw new Error();
    const data = z
      .object({
        code: z.literal("00"),
        data: z.array(
          z.object({
            bin: z.string().regex(/^\d{6}$/),
            shortName: z.string(),
            name: z.string(),
            transferSupported: z.number(),
          }),
        ),
      })
      .parse(await r.json());
    return data.data
      .filter((b) => b.transferSupported === 1)
      .map((b) => ({ code: b.bin, name: b.shortName, label: b.name }));
  } catch {
    throw new ApiError(503, "Chưa lấy được danh sách ngân hàng. Vui lòng thử lại.");
  }
}
