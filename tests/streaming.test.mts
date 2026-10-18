import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mainTabs, activeMainTab } from "../src/domain/navigation.ts";
import { SHORT_BATCH_SIZE, preloadShort, shortHref } from "../src/domain/shorts.ts";
import { shareShort } from "../src/services/shorts.ts";
test("five main tabs use the requested order and routes", () => {
  assert.deepEqual(
    mainTabs.map((t) => [t.label, t.href]),
    [
      ["Khám phá", "/explore"],
      ["Phim ngắn", "/shorts"],
      ["Phần thưởng", "/rewards"],
      ["Danh sách", "/list"],
      ["Của tôi", "/profile"],
    ],
  );
});
for (const [route, expected] of [
  ["/", "/explore"],
  ["/explore", "/explore"],
  ["/search", "/explore"],
  ["/shorts", "/shorts"],
  ["/rewards", "/rewards"],
  ["/wallet/history", "/profile"],
  ["/list", "/list"],
  ["/favorites", "/list"],
  ["/history", "/list"],
  ["/profile", "/profile"],
  ["/vip", "/profile"],
  ["/wallet-other", "/explore"],
])
  test("active tab: " + route, () => assert.equal(activeMainTab(route), expected));
test("five retained legal clips use real H.264/AAC and image thumbnails", async () => {
  for (let n = 1; n <= 5; n++) {
    const video = await readFile(`public/video/shorts/bunny-${n}.mp4`);
    assert.equal(video.subarray(4, 8).toString(), "ftyp");
    assert.ok(video.includes(Buffer.from("avc1")));
    assert.ok(video.includes(Buffer.from("mp4a")));
    assert.ok((await readFile(`public/video/shorts/bunny-${n}.jpg`)).length > 0);
  }
});
test("preloading is bounded to the active video and next item", () => {
  for (let active = 0; active < 10; active++) {
    const values = Array.from({ length: 10 }, (_, i) => preloadShort(i, active));
    assert.equal(values.filter((v) => v === "auto").length, 1);
    assert.ok(values.filter((v) => v !== "none").length <= 2);
  }
});
test("public feed batches contain five records", () => assert.equal(SHORT_BATCH_SIZE, 5));
test("short URL safely encodes the selected ID", () => {
  const id = "clip & /?#";
  assert.equal(new URL(shortHref(id), "https://cinevjet.example").searchParams.get("id"), id);
});
test("share without Web Share copies the current short URL", async () => {
  let copied = "";
  assert.equal(
    await shareShort(
      { id: "demo-4", title: "Clip" },
      {
        origin: "https://cinevjet.example",
        copy: async (url) => {
          copied = url;
        },
      },
    ),
    "copied",
  );
  assert.equal(copied, "https://cinevjet.example/shorts?id=demo-4");
});
test("Web Share success sends the short URL without copying", async () => {
  let shared = "";
  assert.equal(
    await shareShort(
      { id: "demo-2", title: "Clip" },
      {
        origin: "https://cinevjet.example",
        share: async (data) => {
          shared = data.url;
        },
        copy: async () => {
          assert.fail("Unexpected copy");
        },
      },
    ),
    "shared",
  );
  assert.equal(shared, "https://cinevjet.example/shorts?id=demo-2");
});
test("cancelled sharing stays cancelled, unsupported sharing falls back", async () => {
  let copies = 0;
  const copy = async () => {
    copies++;
  };
  const item = { id: "demo-2", title: "Clip" };
  const abort = new Error("cancel");
  abort.name = "AbortError";
  assert.equal(
    await shareShort(item, {
      origin: "https://cinevjet.example",
      share: async () => {
        throw abort;
      },
      copy,
    }),
    "cancelled",
  );
  assert.equal(copies, 0);
  assert.equal(
    await shareShort(item, {
      origin: "https://cinevjet.example",
      share: async () => {
        throw new Error("unsupported");
      },
      copy,
    }),
    "copied",
  );
  assert.equal(copies, 1);
});
