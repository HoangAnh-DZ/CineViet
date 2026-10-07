// Build-time fixture conversion only. Production screens never import these fixtures.
import { writeFile } from "node:fs/promises";
import { movies } from "../src/data/catalog";
import { vipPlans } from "../src/data/account";
const samples = [
  ...movies,
  {
    ...movies[0],
    id: "city-of-lanterns",
    slug: "city-of-lanterns",
    title: "Thành Phố Đèn Lồng",
    original_title: "City of Lanterns",
    country: "Việt Nam",
    release_year: 2025,
    genres: ["Tình cảm", "Chính kịch"],
  },
  {
    ...movies[5],
    id: "cloud-island",
    slug: "cloud-island",
    title: "Đảo Trên Mây",
    original_title: "Cloud Island",
    release_year: 2025,
    genres: ["Hoạt hình", "Phiêu lưu"],
  },
  {
    ...movies[7],
    id: "silent-orbit",
    slug: "silent-orbit",
    title: "Quỹ Đạo Yên Lặng",
    original_title: "Silent Orbit",
    release_year: 2026,
    vip_required: false,
  },
];
const quote = (value: unknown): string =>
  value === null
    ? "NULL"
    : typeof value === "number"
      ? String(value)
      : typeof value === "boolean"
        ? value
          ? "true"
          : "false"
        : "'" + String(value).replaceAll("'", "''") + "'";
const insert = (table: string, columns: string[], values: unknown[]) =>
  "INSERT INTO cinevjet." +
  table +
  "(" +
  columns.join(",") +
  ") VALUES(" +
  values.map(quote).join(",") +
  ") ON CONFLICT DO NOTHING;";
const statements = [
  "-- Idempotent, fictional catalog. Never inserts users, wallets, deposits or withdrawals.",
];
const genres = [...new Set(samples.flatMap((m) => m.genres))];
const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .toLowerCase()
    .replace(/\s+/g, "-");
for (const name of genres)
  statements.push(insert("genres", ["id", "name", "slug"], [slug(name), name, slug(name)]));
for (const m of samples) {
  statements.push(
    insert(
      "movies",
      [
        "id",
        "title",
        "original_title",
        "slug",
        "description",
        "poster_url",
        "backdrop_url",
        "release_year",
        "country",
        "duration_minutes",
        "rating",
        "type",
        "vip_required",
        "status",
      ],
      [
        m.id,
        m.title,
        m.original_title,
        m.slug,
        m.description,
        m.poster,
        m.backdrop,
        m.release_year,
        m.country,
        m.duration,
        m.rating,
        m.type,
        m.vip_required,
        "PUBLISHED",
      ],
    ),
  );
  for (const genre of m.genres)
    statements.push(insert("movie_genres", ["movie_id", "genre_id"], [m.id, slug(genre)]));
  const source = (episodeId: string | null) => {
    const id = "sample-" + (episodeId || m.id);
    statements.push(
      insert(
        "video_sources",
        [
          "id",
          "movie_id",
          "episode_id",
          "provider",
          "playback_url",
          "quality",
          "format",
          "is_active",
        ],
        [id, m.id, episodeId, "BLENDER_CC_BY_3", "/video/bunny-trailer.mp4", "AUTO", "MP4", true],
      ),
    );
    statements.push(
      insert(
        "subtitles",
        ["id", "movie_id", "episode_id", "language", "label", "url", "is_default"],
        [
          "sub-" + id,
          m.id,
          episodeId,
          "vi",
          "Tiếng Việt (minh họa)",
          "/subtitles/demo-vi.vtt",
          false,
        ],
      ),
    );
  };
  source(null);
  if (m.type === "SERIES") {
    statements.push(
      insert(
        "seasons",
        ["id", "movie_id", "season_number", "title"],
        [m.id + "-season-1", m.id, 1, "Mùa 1"],
      ),
    );
    for (let n = 1; n <= 10; n++) {
      const id = m.id + "-ep-" + n;
      statements.push(
        insert(
          "episodes",
          [
            "id",
            "movie_id",
            "season_number",
            "episode_number",
            "title",
            "description",
            "duration_seconds",
            "thumbnail_url",
            "release_date",
            "status",
          ],
          [id, m.id, 1, n, "Tập " + n, m.description, 3380, m.backdrop, "2024-10-01", "PUBLISHED"],
        ),
      );
      source(id);
    }
  }
}
for (const p of vipPlans)
  statements.push(
    insert(
      "vip_plans",
      ["id", "name", "price", "duration_days", "benefits_json", "active", "discount"],
      [p.id, p.name, p.price, p.duration_days, JSON.stringify(p.benefits), p.active, p.discount],
    ),
  );
await writeFile("database/seed.sql", statements.join("\n") + "\n");
console.log("Generated production-safe seed.");
