import fs from "node:fs";

function files(root) {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory() ? files(`${root}/${entry.name}`) : [`${root}/${entry.name}`],
    );
}
export function securityInventory() {
  const routes = [],
    writes = [],
    serverActions = [],
    sqlFiles = [];
  for (const file of [...files("src"), ...files("scripts"), ...files("database")]) {
    if (!/\.(?:tsx?|mjs|js|sql)$/.test(file)) continue;
    const source = fs.readFileSync(file, "utf8");
    if (file.endsWith(".sql")) {
      if (/\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i.test(source)) sqlFiles.push(file);
      continue;
    }
    if (/["']use server["']/.test(source)) serverActions.push(file);
    const lineAt = (position) => source.slice(0, position).split("\n").length;
    if (file.startsWith("src/app/api/")) {
      for (const method of source.matchAll(
        /^export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/gm,
      )) {
        routes.push({
          file,
          line: lineAt(method.index),
          method: method[1],
          path: file.slice("src/app".length).replace(/\/route\.ts$/, ""),
          guards: [
            ...new Set(
              source.match(
                /\b(?:requireUser|requireAdmin|checkOrigin|authorizedCron|authorized|handleUpload|receivePayosWebhook)\b/g,
              ) || [],
            ),
          ],
        });
      }
    }
    // Text inventory deliberately includes operator SQL as well as runtime tags.
    // Dynamic table names remain visible for manual allowlist review; FOR UPDATE is excluded.
    for (const mutation of source.matchAll(
      /\b(INSERT\s+INTO|DELETE\s+FROM|UPDATE)\s+(cinevjet\.[a-z_]+|\$\{[^}]+\})/gi,
    )) {
      const declarations = [
        ...source
          .slice(0, mutation.index)
          .matchAll(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)|^export\s+const\s+(\w+)/gm),
      ];
      const declaration = declarations.at(-1);
      writes.push({
        file,
        line: lineAt(mutation.index),
        owner: declaration?.[1] || declaration?.[2] || "module",
        operations: [`${mutation[1].toUpperCase()} ${mutation[2]}`],
      });
    }
  }
  return { routes, writes, serverActions, sqlFiles };
}
if (process.argv[1]?.replaceAll("\\", "/").endsWith("/security-inventory.mjs")) {
  process.stdout.write(JSON.stringify(securityInventory(), null, 2) + "\n");
}
