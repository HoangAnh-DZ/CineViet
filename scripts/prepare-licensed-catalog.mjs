// Reads public, owner-published PeerTube metadata. Downloads only cover artwork, never movies.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import sharp from "sharp";
const evidence = JSON.parse(await readFile("database/licensed-source-evidence.json", "utf8"));
const films = [
  [
    "big-buck-bunny",
    "Big Buck Bunny",
    2008,
    "Không lời",
    ["Hoạt hình", "Hài hước"],
    "Một chú thỏ hiền lành tìm cách đối phó với ba con vật tinh nghịch trong khu rừng. Phim hoạt hình ngắn hoàn chỉnh của Blender Foundation, đạo diễn Sacha Goedegebure.",
    "3.0",
    "https://peach.blender.org/about/",
    "© 2008 Blender Foundation | www.bigbuckbunny.org",
  ],
  [
    "elephants-dream",
    "Elephants Dream",
    2006,
    "Tiếng Anh",
    ["Hoạt hình", "Viễn tưởng"],
    "Proog và Emo đi qua một thế giới máy móc kỳ lạ, nơi cách nhìn khác biệt của họ dần đẩy cuộc hành trình đến xung đột. Phim ngắn hoàn chỉnh, đạo diễn Bassam Kurdali.",
    "2.5",
    "https://orange.blender.org/blog/creative-commons-license-2/",
    "© 2006 Blender Foundation / Netherlands Media Art Institute | www.elephantsdream.org",
  ],
  [
    "tears-of-steel",
    "Tears of Steel",
    2012,
    "Tiếng Anh",
    ["Viễn tưởng", "Hành động"],
    "Tại Amsterdam trong tương lai, một nhóm người tìm cách tái hiện ký ức để ngăn cuộc tấn công của máy móc. Phim ngắn kết hợp người đóng và kỹ xảo, đạo diễn Ian Hubert.",
    "3.0",
    "https://mango.blender.org/sharing/",
    "© Blender Foundation | www.tearsofsteel.org",
  ],
  [
    "sintel",
    "Sintel",
    2010,
    "Tiếng Anh",
    ["Hoạt hình", "Phiêu lưu"],
    "Một cô gái trẻ lên đường tìm lại chú rồng nhỏ từng được mình cứu giúp. Phim ngắn hoàn chỉnh của Blender Foundation, đạo diễn Colin Levy; giữ nguyên toàn bộ phần ghi công cuối phim.",
    "3.0",
    "https://durian.blender.org/sharing",
    "© 2010 Blender Foundation | www.sintel.org",
  ],
  [
    "spring",
    "Spring",
    2019,
    "Không lời",
    ["Hoạt hình", "Phiêu lưu"],
    "Một cô bé chăn cừu và chú chó đối mặt với những linh hồn cổ xưa để đưa mùa xuân trở lại. Phim ngắn hoàn chỉnh của Blender Animation Studio, đạo diễn Andy Goralczyk.",
    "4.0",
    "https://studio.blender.org/projects/spring/pages/about/",
    "© Blender Foundation | cloud.blender.org/spring",
  ],
  [
    "coffee-run",
    "Coffee Run",
    2020,
    "Không lời",
    ["Hoạt hình", "Tình cảm"],
    "Trong nhịp chạy đầy năng lượng, một cô gái đi qua những ký ức ngọt ngào và đắng cay của mối quan hệ đã qua. Phim hoạt hình ngắn hoàn chỉnh của Blender Animation Studio, đạo diễn Hjalti Hjalmarsson.",
    "4.0",
    "https://studio.blender.org/projects/coffee-run/pages/licensing/",
    "(CC) Blender Foundation | studio.blender.org",
  ],
  [
    "caminandes-3-llamigos",
    "Caminandes 3: Llamigos",
    2016,
    "Không lời",
    ["Hoạt hình", "Hài hước"],
    "Giữa mùa đông Patagonia, lạc đà Koro và chim cánh cụt Oti tranh giành quả mọng cuối cùng. Đây là phim ngắn độc lập hoàn chỉnh trong tuyển tập Caminandes, đạo diễn Pablo Vazquez.",
    "4.0",
    "https://video.blender.org/w/23f3ef79-15dc-44c5-aa45-cf92e78a4509",
    "© Blender Foundation | caminandes.com",
  ],
  [
    "glass-half",
    "Glass Half",
    2015,
    "Ngôn ngữ hư cấu",
    ["Hoạt hình", "Hài hước"],
    "Hai người yêu nghệ thuật tranh luận về các tác phẩm trong phòng trưng bày và bất ngờ tìm ra một điểm chung. Phim hoạt hình ngắn hoàn chỉnh của Blender Institute, đạo diễn Beorn Leonard.",
    "4.0",
    "https://video.blender.org/w/64222c8a-c4c7-4b3b-9850-7fb2078edcf6",
    "© Blender Foundation / Blender Institute | studio.blender.org",
  ],
];
await mkdir("public/images/films", { recursive: true });
const catalog = [];
for (let i = 0; i < films.length; i++) {
  const [id, title, year, language, genres, description, version, rights, attribution] = films[i];
  const source = evidence[i];
  if (
    source.headers.status !== 206 ||
    source.headers.type !== "video/mp4" ||
    source.headers.cors !== "*" ||
    !source.downloadEnabled ||
    !source.embed
  )
    throw new Error("Public streaming verification failed: " + id);
  let artwork;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(source.poster, { signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error("Artwork unavailable: " + id);
      artwork = Buffer.from(await response.arrayBuffer());
      break;
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
  await sharp(artwork)
    .resize({ width: 1280, withoutEnlargement: true })
    .webp({ quality: 88 })
    .toFile(`public/images/films/${id}.webp`);
  catalog.push({
    id,
    slug: id,
    title,
    original_title: title,
    release_year: year,
    country: "Hà Lan",
    language,
    genres,
    description,
    duration_seconds: source.duration,
    duration_minutes: Math.ceil(source.duration / 60),
    poster_url: `/images/films/${id}.webp`,
    backdrop_url: `/images/films/${id}.webp`,
    type: "MOVIE",
    status: "PUBLISHED",
    vip_required: false,
    rating: null,
    playback_url: source.file.fileUrl,
    quality: "720p",
    format: "MP4",
    license_name: `CC BY ${version}`,
    license_url: `https://creativecommons.org/licenses/by/${version}/`,
    license_source_url: rights.startsWith("https://video.blender.org/")
      ? source.source_url
      : rights,
    source_page_url: source.source_url,
    attribution,
    poster_attribution: `Ảnh bìa: ${attribution}. Cắt khung khi hiển thị.`,
    verified_at: "2026-10-15",
    source_api_url: `https://video.blender.org/api/v1/videos/${source.id}`,
    stream_permission: {
      download_enabled: true,
      official_embed_url: source.embed,
      cors: "*",
      byte_ranges: true,
    },
  });
}
await writeFile("database/licensed-catalog.json", JSON.stringify(catalog, null, 2) + "\n");
console.log(
  `Prepared ${catalog.length} licensed full short films and cover images. No video files downloaded.`,
);
