"use client";
import { useEffect, useState } from "react";
import { SearchBar, GenreChip } from "@/components/search";
import {
  MovieGrid,
  MovieGridSkeleton,
  MovieRow,
  HeroMovie,
  ContinueWatchingCard,
} from "@/components/movies";
import { AppHeader } from "@/components/navigation";
import { useApp } from "@/components/providers";
import { EmptyState, PageHeader, SectionHeader } from "@/components/ui";
import { requestJson } from "@/services/client";
import type { Movie } from "@/domain/models";
type Result = { items: Movie[]; total: number; page: number; pageSize: number };
export function ExploreScreen({
  search = false,
  initial,
  options,
  filters,
  discovery,
}: {
  search?: boolean;
  initial: Result;
  options: { genres: string[]; countries: string[]; years: number[] };
  filters: Record<string, string | string[] | undefined>;
  discovery?: {
    featured: Movie[];
    trending: Movie[];
    newest: Movie[];
    series: Movie[];
    recommended: Movie[];
    shortSeries: Movie[];
  };
}) {
  const { progress } = useApp();
  const [query, setQuery] = useState(String(filters.q || "")),
    [genre, setGenre] = useState(String(filters.genre || "Tất cả")),
    [country, setCountry] = useState(String(filters.country || "")),
    [year, setYear] = useState(String(filters.year || "")),
    [sort, setSort] = useState(String(filters.sort || "")),
    [page, setPage] = useState(initial.page);
  const [data, setData] = useState(initial),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    setData(initial);
    setQuery(String(filters.q || ""));
    setGenre(String(filters.genre || "Tất cả"));
    setCountry(String(filters.country || ""));
    setYear(String(filters.year || ""));
    setSort(String(filters.sort || ""));
    setPage(initial.page);
  }, [initial, filters]);
  useEffect(() => {
    if (
      retry === 0 &&
      query === String(filters.q || "") &&
      genre === String(filters.genre || "Tất cả") &&
      country === String(filters.country || "") &&
      year === String(filters.year || "") &&
      sort === String(filters.sort || "") &&
      page === initial.page
    ) {
      setData(initial);
      setLoading(false);
      setError("");
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      setError("");
      const params = new URLSearchParams({
        q: query,
        genre,
        country,
        year,
        sort,
        page: String(page),
        type: String(filters.type || ""),
      });
      requestJson<Result>("/api/catalog?" + params, { signal: controller.signal })
        .then(setData)
        .catch((e) => {
          if (e.name !== "AbortError") setError(e.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, genre, country, year, sort, page, retry, filters, initial.page]);
  const browsing =
    !search &&
    !query &&
    genre === "Tất cả" &&
    !country &&
    !year &&
    !sort &&
    page === 1 &&
    !!discovery;
  const featuredIds = new Set(discovery?.featured.map((movie) => movie.id));
  const latest =
    discovery?.newest.filter((movie) => movie.type === "MOVIE" && !featuredIds.has(movie.id)) || [];
  const presented = new Set([...featuredIds, ...latest.map((movie) => movie.id)]);
  const features = discovery?.recommended.filter((movie) => !presented.has(movie.id)) || [];
  const shortFilms = initial.items
    .filter((movie) => movie.type === "MOVIE" && movie.duration < 40 && !presented.has(movie.id))
    .slice(0, 6);
  const continuing = progress.filter((item) => !item.completed && item.movie);
  return (
    <>
      {search ? <PageHeader title="Tìm kiếm" back="/explore" /> : <AppHeader />}
      <div
        className={`content search-page ${!search ? "discovery-content cinematic-discover" : "cinematic-search"}`}
      >
        {!search && !browsing ? (
          <div className="discovery-intro">
            <span className="eyebrow">Câu chuyện tiếp theo của bạn</span>
            <h1>Khám phá</h1>
          </div>
        ) : null}
        {browsing ? <h1 className="sr-only">Khám phá phim</h1> : null}
        <div className={`discovery-toolbar ${browsing ? "is-browsing" : ""}`}>
          <SearchBar
            value={query}
            onChange={(v) => {
              setQuery(v);
              setPage(1);
            }}
            autoFocus={search}
          />
          <div className="genres">
            {[
              "Tất cả",
              "Phim lẻ",
              "Phim bộ",
              "Mới",
              "HOT",
              ...options.genres.filter((g) => !["Tất cả", "Phim lẻ", "Phim bộ"].includes(g)),
            ].map((label) => (
              <GenreChip
                key={label}
                label={label}
                active={
                  label === "Mới"
                    ? sort === "newest"
                    : label === "HOT"
                      ? sort === "rating"
                      : genre === label && !sort
                }
                onClick={() => {
                  setGenre(label === "Mới" || label === "HOT" ? "Tất cả" : label);
                  setSort(label === "Mới" ? "newest" : label === "HOT" ? "rating" : "");
                  setPage(1);
                }}
              />
            ))}
          </div>
          <details className="discovery-filters">
            <summary>Bộ lọc phim</summary>
            <div className="filters">
              <select
                aria-label="Quốc gia"
                value={country}
                onChange={(e) => {
                  setCountry(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">Quốc gia</option>
                {options.countries.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
              <select
                aria-label="Năm phát hành"
                value={year}
                onChange={(e) => {
                  setYear(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">Năm</option>
                {options.years.map((y) => (
                  <option key={y}>{y}</option>
                ))}
              </select>
              <select
                aria-label="Sắp xếp"
                value={sort}
                onChange={(e) => {
                  setSort(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">Sắp xếp</option>
                <option value="newest">Mới nhất</option>
                <option value="rating">Đánh giá cao</option>
              </select>
            </div>
          </details>
        </div>
        {browsing ? <HeroMovie items={discovery.featured} /> : null}
        {query ? (
          <p className="results-count">
            {data.total} kết quả cho “{query}”
          </p>
        ) : null}
        {browsing ? (
          <>
            {continuing.length ? (
              <section className="movie-section">
                <SectionHeader title="Tiếp tục xem" href="/list" />
                <div className="continue-row">
                  {continuing.slice(0, 5).map((p) => (
                    <ContinueWatchingCard key={`${p.movie_id}-${p.episode_id}`} progress={p} />
                  ))}
                </div>
              </section>
            ) : null}
            <MovieRow title="Mới cập nhật" items={latest} query="?sort=newest" />
            <MovieRow title="Phim lẻ" items={features} query="?genre=Phim%20lẻ" />
            <MovieRow title="Phim bộ" items={discovery.series} query="?genre=Phim%20bộ" />
            <MovieRow title="Phim ngắn" items={shortFilms} query="?genre=Hoạt%20hình" />
            <MovieRow
              title="Series tập ngắn"
              items={discovery.shortSeries}
              query="?genre=Series%20tập%20ngắn"
            />
          </>
        ) : error ? (
          <div role="alert">
            <p className="form-error">{error}</p>
            <button className="button secondary" onClick={() => setRetry((v) => v + 1)}>
              Thử lại
            </button>
          </div>
        ) : loading ? (
          <MovieGridSkeleton />
        ) : data.items.length ? (
          <MovieGrid items={data.items} />
        ) : (
          <EmptyState title="Chưa tìm thấy phim" body="Thử tên phim khác hoặc thay đổi bộ lọc." />
        )}
        {!browsing && data.total > data.pageSize ? (
          <div className="episode-arrows">
            <button
              className="button secondary"
              disabled={page === 1 || loading}
              onClick={() => setPage((p) => p - 1)}
            >
              Trang trước
            </button>
            <span>
              {page} / {Math.ceil(data.total / data.pageSize)}
            </span>
            <button
              className="button secondary"
              disabled={page * data.pageSize >= data.total || loading}
              onClick={() => setPage((p) => p + 1)}
            >
              Trang sau
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
}
