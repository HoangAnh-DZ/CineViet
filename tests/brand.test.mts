import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import sharp from "sharp";
import { BrandLogo } from "../src/components/brand-logo";
Object.assign(globalThis, { React });

test("brand assets are local path-only vectors with transparent backgrounds", async () => {
  for (const asset of ["logo-dark", "logo-light", "wordmark-dark", "wordmark-light", "icon"]) {
    const svg = await readFile(`public/brand/cinevjet-${asset}.svg`, "utf8");
    assert.ok(svg.includes("<path"));
    assert.ok(!/<(?:text|image|script|foreignObject)|data:|https?:\/\/(?!www.w3.org)/i.test(svg));
    assert.ok(svg.length < 30000);
    const { data, info } = await sharp(Buffer.from(svg))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    assert.equal(data[3], 0, "no opaque panel/background");
    assert.ok(data.some((value, i) => i % info.channels === 3 && value > 240));
  }
});

test("full, compact and icon variants reserve correct dimensions and one accessible brand", () => {
  for (const variant of ["full", "compact", "icon"] as const) {
    for (const tone of ["light", "dark"] as const) {
      const html = renderToStaticMarkup(React.createElement(BrandLogo, { variant, tone }));
      assert.equal((html.match(/<img /g) || []).length, 1);
      assert.ok(html.includes('alt="CineVjet"'));
      assert.ok(
        html.includes(
          variant === "icon" ? "/brand/cinevjet-icon.svg" : `/brand/cinevjet-logo-${tone}.svg`,
        ),
      );
      assert.ok(
        html.includes(variant === "icon" ? 'width="224" height="224"' : 'width="740" height="215"'),
      );
      assert.ok(!html.includes("CINE<span"));
    }
  }
});

test("favicon uses the same mark, with usable PNG sizes and Apple icon", async () => {
  assert.equal(
    await readFile("src/app/icon.svg", "utf8"),
    await readFile("public/brand/cinevjet-icon.svg", "utf8"),
  );
  for (const size of [16, 32, 48, 128]) {
    const info = await sharp(`public/brand/favicon-${size}.png`).metadata();
    assert.equal(info.width, size);
    assert.equal(info.height, size);
  }
  assert.equal((await sharp("src/app/apple-icon.png").metadata()).width, 180);
  const ico = await readFile("src/app/favicon.ico");
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 3);
});
