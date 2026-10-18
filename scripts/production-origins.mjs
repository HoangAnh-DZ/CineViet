import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export function verifiedProductionOrigins(snapshot, projectId) {
  if (!projectId || !Array.isArray(snapshot?.domains) || snapshot.pagination?.next)
    throw new Error("A complete domain export for the linked project is required.");
  const origins = snapshot.domains
    .filter(
      (domain) =>
        domain.projectId === projectId &&
        domain.verified === true &&
        !domain.gitBranch &&
        !domain.customEnvironmentId &&
        !domain.redirect &&
        typeof domain.name === "string" &&
        /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(
          domain.name,
        ),
    )
    .map((domain) => `https://${domain.name.toLowerCase()}`);
  if (!origins.length) throw new Error("No verified Production domains found.");
  return [...new Set(origins)].sort();
}

// Feed an authenticated `vercel api /v9/projects/<linked-project-id>/domains`
// export into this command. The result config is server-only and needs redeploy.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const linked = JSON.parse(await readFile(".vercel/project.json", "utf8"));
  const snapshot = JSON.parse(await readFile(process.argv[2], "utf8"));
  process.stdout.write(JSON.stringify(verifiedProductionOrigins(snapshot, linked.projectId)));
}
