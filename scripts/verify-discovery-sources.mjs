import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const catalog = JSON.parse(await readFile("database/discovery-expansion.json", "utf8"));
const variants = JSON.parse(await readFile("database/streaming-variants.json", "utf8"));
const media = catalog.flatMap((m) =>
  m.episodes?.length
    ? m.episodes.map((e) => ({ duration: e.duration_seconds, sources: e.sources }))
    : [{ duration: m.duration_seconds, sources: m.sources }],
);
for (const m of variants) {
  const old = JSON.parse(await readFile("database/licensed-catalog.json", "utf8")).find(
    (v) => v.id === m.id,
  );
  media.push({ duration: old.duration_seconds, sources: m.sources });
}
const unique = new Map(
  media.flatMap((m) => m.sources.map((source) => [source.url, { source, duration: m.duration }])),
);
let previous;
try {
  previous = JSON.parse(await readFile(".vercel/discovery-source-verification.json", "utf8"));
} catch {}
const results = previous?.results?.filter((r) => r.ok) || [];
const queue = [...unique.entries()].filter(([url]) => !results.some((r) => r.url === url));
async function probe(url, thumbnail = false) {
  const r = await fetch(url, {
    method: thumbnail ? "HEAD" : "GET",
    headers: {
      "User-Agent": "CineVjet-MediaVerifier/1.0 (+https://cinevjet-hoanganh-dz.vercel.app)",
      ...(!thumbnail
        ? { Range: "bytes=0-65535", Origin: "https://cinevjet-hoanganh-dz.vercel.app" }
        : {}),
    },
    signal: AbortSignal.timeout(20000),
  });
  const range = r.headers.get("content-range"),
    type = r.headers.get("content-type") || "",
    cors = r.headers.get("access-control-allow-origin");
  if (thumbnail) {
    await r.body?.cancel();
    return { url, status: r.status, ok: r.ok && type.startsWith("image/") };
  }
  if (r.status !== 206) {
    await r.body?.cancel();
    if (r.status === 429) throw new Error("RATE_LIMIT_STOP");
    return { url, status: r.status, ok: false };
  }
  const bytes = new Uint8Array(await r.arrayBuffer());
  const total = Number(range?.split("/")[1]);
  const ok =
    type.startsWith("video/") &&
    bytes.length > 0 &&
    bytes.length <= 65536 &&
    total > bytes.length &&
    (cors === "*" || cors === "https://cinevjet-hoanganh-dz.vercel.app");
  return {
    url,
    status: r.status,
    ok,
    type,
    cors,
    range,
    total,
    fast_start: type.includes("mp4") ? Buffer.from(bytes).includes(Buffer.from("moov")) : undefined,
  };
}
async function worker() {
  while (queue.length) {
    const [url, { source, duration }] = queue.shift();
    try {
      const result = await probe(url);
      results.push(result);
      if (result.ok) source.bitrate_bps = Math.ceil((result.total * 8) / duration);
      else console.log("SOURCE FAIL", result.status, url);
    } catch (e) {
      results.push({ url, ok: false, error: e.message });
      console.log("SOURCE FAIL", e.message, url);
      if (e.message === "RATE_LIMIT_STOP") {
        for (const [pending] of queue)
          results.push({ url: pending, ok: false, error: "Deferred after rate limit" });
        queue.length = 0;
      }
    }
    await new Promise((r) => setTimeout(r, 1600));
  }
}
await worker();
const posters = [
  ...new Set(
    catalog.flatMap((m) => [
      m.poster_url,
      m.backdrop_url,
      ...(m.episodes || []).map((e) => e.thumbnail_url),
    ]),
  ),
];
for (const url of posters) {
  if (results.some((r) => r.url === url && r.ok)) continue;
  try {
    results.push(await probe(url, true));
  } catch (e) {
    results.push({ url, ok: false, error: e.name });
  }
  await new Promise((r) => setTimeout(r, 100));
}
// Transfer measured byte sizes to every reference to the same verified URL.
for (const m of media)
  for (const s of m.sources) {
    const result = results.find((r) => r.url === s.url);
    if (result?.ok && result.total) s.bitrate_bps = Math.ceil((result.total * 8) / m.duration);
  }
await writeFile("database/discovery-expansion.json", JSON.stringify(catalog, null, 2) + "\n");
await writeFile("database/streaming-variants.json", JSON.stringify(variants, null, 2) + "\n");
const proof = {
  verified_at: new Date().toISOString(),
  manifestSha256: createHash("sha256")
    .update(await readFile("database/discovery-expansion.json"))
    .digest("hex"),
  variantsSha256: createHash("sha256")
    .update(await readFile("database/streaming-variants.json"))
    .digest("hex"),
  failures: results.filter((r) => !r.ok).length,
  results,
};
await writeFile(".vercel/discovery-source-verification.json", JSON.stringify(proof));
console.log(
  JSON.stringify({
    videos: unique.size,
    posters: posters.length,
    failures: proof.failures,
    mp4_without_early_moov: results.filter((r) => r.fast_start === false).length,
  }),
);
if (proof.failures) process.exitCode = 1;
