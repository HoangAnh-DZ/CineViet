// Render the existing AdminShell for visual QA without a session or database writes.
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { writeFile, readFile } from "node:fs/promises";
import { AdminShell } from "../src/features/admin/admin-shell";
import {
  PathnameContext,
  SearchParamsContext,
} from "next/dist/shared/lib/hooks-client-context.shared-runtime.js";
Object.assign(globalThis, { React });
const page = await (await fetch("http://localhost:3016/login")).text();
const styles = Array.from(page.matchAll(/<link[^>]+rel="stylesheet"[^>]*>/g))
  .map((m) => m[0])
  .join("");
const css = await readFile("src/features/admin/dashboard.css", "utf8");
const shell = renderToStaticMarkup(
  React.createElement(
    PathnameContext.Provider,
    { value: "/admin" },
    React.createElement(
      SearchParamsContext.Provider,
      { value: new URLSearchParams() },
      React.createElement(AdminShell, {
        name: "Brand preview",
        children: React.createElement("h1", {}, "Quản trị"),
      }),
    ),
  ),
);
for (const tone of ["light", "dark"]) {
  const html = shell
    .replaceAll("admin-theme-light", `admin-theme-${tone}`)
    .replaceAll("cinevjet-logo-light.svg", `cinevjet-logo-${tone}.svg`);
  await writeFile(
    `.vercel/brand-admin-${tone}.html`,
    `<!doctype html><html lang="vi"><head><base href="http://localhost:3016/"><meta name="viewport" content="width=device-width,initial-scale=1">${styles}<style>${css}</style></head><body>${html}</body></html>`,
  );
}
console.log(
  "AdminShell visual previews rendered from the actual component, without authentication/database access.",
);
