import { shortHref, type ShortsBatch } from "@/domain/shorts";
import { requestJson } from "./client";
export function loadShorts(cursor: string, signal: AbortSignal) {
  return requestJson<ShortsBatch>(`/api/shorts?cursor=${encodeURIComponent(cursor)}`, { signal });
}
export async function shareShort(
  item: { id: string; title: string },
  browser: {
    origin: string;
    share?: (data: { title: string; url: string }) => Promise<void>;
    copy: (text: string) => Promise<void>;
  },
): Promise<"shared" | "copied" | "cancelled"> {
  const url = new URL(shortHref(item.id), browser.origin).href;
  if (browser.share) {
    try {
      await browser.share({ title: item.title, url });
      return "shared";
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return "cancelled";
    }
  }
  await browser.copy(url);
  return "copied";
}
