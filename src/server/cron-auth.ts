import "server-only";
import { timingSafeEqual } from "node:crypto";
export function authorizedCron(request: Request) {
  const secret = process.env.CRON_SECRET,
    header = request.headers.get("authorization");
  return (
    !!secret &&
    !!header &&
    Buffer.byteLength(header) === Buffer.byteLength(`Bearer ${secret}`) &&
    timingSafeEqual(Buffer.from(header), Buffer.from(`Bearer ${secret}`))
  );
}
