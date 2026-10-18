type OriginConfig = {
  vercel?: string;
  deployment?: string;
  productionOrigins?: string;
  appUrl?: string;
};

function exactOrigin(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.origin !== value || url.username || url.password) return null;
    if (
      url.protocol === "https:" &&
      !url.port &&
      /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(
        url.hostname,
      )
    )
      return url.origin;
    if (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
      return url.origin;
  } catch {}
  return null;
}

// Server-only configuration generated from the linked project's verified
// Production domains. No wildcard, Host reflection or alias fallback.
export function trustedOrigins(config: OriginConfig): string[] {
  if (config.vercel === "1") {
    let entries: unknown;
    try {
      entries = JSON.parse(config.productionOrigins || "[]");
    } catch {
      entries = [];
    }
    const origins = Array.isArray(entries)
      ? entries.filter(
          (value): value is string => !!exactOrigin(value) && value.startsWith("https:"),
        )
      : [];
    const deployment = exactOrigin(`https://${config.deployment || ""}`);
    if (deployment) origins.push(deployment);
    return [...new Set(origins)];
  }
  const app = exactOrigin(config.appUrl);
  return app ? [app] : [];
}

export function resolveRequestOrigin(
  request: { headers: Pick<Headers, "get">; url?: string },
  config: OriginConfig,
) {
  const host = request.headers.get("host");
  let incoming: URL | undefined;
  try {
    if (request.url) incoming = new URL(request.url);
  } catch {
    return null;
  }
  // Next may use localhost in request.url behind the Vercel reverse proxy.
  // Only an exact, already trusted host can supply a public HTTPS origin.
  if (host && !/^[a-z0-9.:[\]-]+$/i.test(host)) return null;
  const authority = host?.toLowerCase() || incoming?.host;
  if (!authority) return null;
  const candidate = trustedOrigins(config).find((origin) => new URL(origin).host === authority);
  if (candidate) return candidate;
  if (config.vercel !== "1") {
    const local = exactOrigin(`http://${authority}`);
    if (local && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(local).hostname))
      return local;
  }
  return null;
}

export function currentOriginConfig(): OriginConfig {
  return {
    vercel: process.env.VERCEL,
    deployment: process.env.VERCEL_URL,
    productionOrigins: process.env.CINEVJET_PRODUCTION_ORIGINS,
    appUrl: process.env.NEXT_PUBLIC_APP_URL,
  };
}
