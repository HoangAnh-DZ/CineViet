import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { createRequire } from "node:module";
import { renderToStaticMarkup } from "react-dom/server";
import { parseSocialVideo } from "../src/domain/social-shorts";
import type { ShortVideo } from "../src/domain/shorts";
createRequire(import.meta.url).extensions[".css"] = () => {};
Object.assign(globalThis, { React });
const { AppProvider } = await import("../src/components/providers");
const { EmbeddedShortItem } = await import("../src/features/shorts/embedded-short-item");
function item(i: number): ShortVideo {
  const video = parseSocialVideo(
    `https://www.tiktok.com/@qa_fixture/video/${7000000000000000000n + BigInt(i)}`,
  );
  return {
    id: String(i),
    movie_id: null,
    movie_slug: null,
    title: "Isolated UI fixture",
    description: "",
    video_url: video.originalUrl,
    thumbnail_url: null,
    duration_seconds: null,
    source: "TikTok",
    creator_name: "QA fixture",
    hashtags: [],
    source_type: "EMBED",
    original_url: video.originalUrl,
    embed_url: video.embedUrl,
    provider: "TIKTOK",
  };
}
function render(activeIndex: number, visible = true) {
  return renderToStaticMarkup(
    React.createElement(
      AppProvider,
      {},
      Array.from({ length: 30 }, (_, index) =>
        React.createElement(EmbeddedShortItem, {
          key: index,
          item: item(index),
          index,
          activeIndex,
          visible,
        }),
      ),
    ),
  );
}
test("30 feed entries mount only the active official iframe and preserve original fallback", () => {
  for (const index of [0, 15, 29]) {
    const html = render(index);
    assert.equal((html.match(/<iframe/g) || []).length, 1);
    assert.ok(html.includes(item(index).embed_url!.replaceAll("&", "&amp;")));
    assert.equal((html.match(/Mở video gốc/g) || []).length, 30);
    assert.ok(!html.includes("autoplay=1"));
  }
  assert.equal((render(0, false).match(/<iframe/g) || []).length, 0);
});
test("untrusted embed URL is not mounted and title content is escaped", () => {
  const video = {
    ...item(0),
    embed_url: "https://127.0.0.1/private",
    title: "<script>attack()</script>",
  };
  const html = renderToStaticMarkup(
    React.createElement(
      AppProvider,
      {},
      React.createElement(EmbeddedShortItem, {
        item: video,
        index: 0,
        activeIndex: 0,
        visible: true,
      }),
    ),
  );
  assert.ok(!html.includes("<iframe"));
  assert.ok(!html.includes("<script>attack"));
  assert.ok(html.includes("&lt;script&gt;"));
});
