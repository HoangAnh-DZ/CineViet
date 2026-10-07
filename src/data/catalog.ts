import type { Episode, Movie, VideoSource, Subtitle } from "@/domain/models";
const description =
  "Một hành trình đầy thử thách, nơi lòng dũng cảm và những lựa chọn định mệnh mở ra câu chuyện không thể đoán trước. Theo chân các nhân vật qua những bí mật, tình bạn và cuộc chiến để bảo vệ điều họ tin tưởng.";
const specs = [
  [
    "midnight-rain",
    "Mật Mã Đêm Mưa",
    "Midnight Rain",
    0,
    "MOVIE",
    ["Hành động", "Kinh dị"],
    2024,
    132,
    8.2,
    false,
    "Mỹ",
  ],
  [
    "desert-heir",
    "Người Thừa Kế Sa Mạc",
    "The Desert Heir",
    1,
    "SERIES",
    ["Hành động", "Viễn tưởng", "Chính kịch"],
    2024,
    146,
    8.5,
    false,
    "Mỹ",
  ],
  [
    "golden-horizon",
    "Hải Trình Vàng",
    "Golden Horizon",
    2,
    "SERIES",
    ["Phiêu lưu", "Hành động"],
    2024,
    48,
    8.6,
    false,
    "Nhật Bản",
  ],
  [
    "last-forest",
    "Khu Rừng Cuối Cùng",
    "The Last Forest",
    3,
    "SERIES",
    ["Chính kịch", "Kinh dị"],
    2023,
    56,
    9.1,
    false,
    "Mỹ",
  ],
  [
    "sunset-run",
    "Đường Đua Hoàng Hôn",
    "Sunset Run",
    4,
    "MOVIE",
    ["Hành động", "Hài hước"],
    2024,
    126,
    7.8,
    false,
    "Mỹ",
  ],
  [
    "panda-warrior",
    "Tiểu Hùng Đại Hiệp",
    "Red Panda Warrior",
    5,
    "MOVIE",
    ["Hoạt hình", "Hài hước"],
    2024,
    94,
    8.0,
    false,
    "Trung Quốc",
  ],
  [
    "red-frontier",
    "Biên Giới Đỏ",
    "Red Frontier",
    6,
    "MOVIE",
    ["Hành động", "Viễn tưởng"],
    2022,
    152,
    8.4,
    true,
    "Mỹ",
  ],
  [
    "beyond-the-moon",
    "Bên Kia Mặt Trăng",
    "Beyond the Moon",
    7,
    "MOVIE",
    ["Viễn tưởng", "Chính kịch"],
    2023,
    169,
    8.9,
    true,
    "Mỹ",
  ],
  [
    "harbor-of-secrets",
    "Bến Cảng Bí Mật",
    "Harbor of Secrets",
    8,
    "SERIES",
    ["Tình cảm", "Chính kịch"],
    2024,
    45,
    8.1,
    false,
    "Hàn Quốc",
  ],
] as const;
export const movies: Movie[] = specs.map(
  ([
    id,
    title,
    original_title,
    tile,
    type,
    genres,
    release_year,
    duration,
    rating,
    vip_required,
    country,
  ]) => ({
    id,
    slug: id,
    title,
    original_title,
    poster: `/images/movie-${tile}.webp`,
    backdrop: `/images/movie-${tile}.webp`,
    description:
      id === "desert-heir"
        ? "Giữa những đụn cát bất tận, một người thừa kế trẻ phải đối mặt với số phận của mình. Khi các vương quốc tranh giành nguồn năng lượng cuối cùng, anh cùng những người bạn bắt đầu cuộc hành trình để thay đổi tương lai của sa mạc."
        : description,
    release_year,
    country,
    duration,
    rating,
    type,
    vip_required,
    status: "PUBLISHED",
    genres: [...genres],
    ...(type === "SERIES" ? { episode_count: 10 } : {}),
  }),
);
export function getMovie(idOrSlug: string) {
  return movies.find((m) => m.id === idOrSlug || m.slug === idOrSlug);
}
export function getEpisodes(movie: Movie): Episode[] {
  return movie.type === "SERIES"
    ? Array.from({ length: movie.episode_count ?? 10 }, (_, i) => ({
        id: `${movie.id}-ep-${i + 1}`,
        movie_id: movie.id,
        season: 1,
        episode_number: i + 1,
        title: `Tập ${i + 1}`,
        duration: 56 * 60 + 20,
        thumbnail: movie.backdrop,
        release_date: "2024-10-01",
      }))
    : [];
}
export const SAMPLE_VIDEO_URL = "/video/bunny-trailer.mp4";
export function getVideoSources(movieId: string, episodeId?: string): VideoSource[] {
  return [
    {
      id: `sample-${movieId}`,
      movie_id: movieId,
      episode_id: episodeId,
      protocol: "MP4",
      url: SAMPLE_VIDEO_URL,
      quality: "AUTO",
      mime_type: "video/mp4",
    },
  ];
}
export function getSubtitles(movieId: string): Subtitle[] {
  return [
    {
      id: "vi-demo",
      video_source_id: `sample-${movieId}`,
      language: "vi",
      label: "Tiếng Việt",
      url: "/subtitles/demo-vi.vtt",
      format: "VTT",
    },
  ];
}
export const genres = [
  "Tất cả",
  "Phim lẻ",
  "Phim bộ",
  "Hành động",
  "Tình cảm",
  "Kinh dị",
  "Hoạt hình",
  "Viễn tưởng",
];
