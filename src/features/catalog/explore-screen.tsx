"use client";
import { useEffect, useState } from "react";
import { SearchBar, GenreChip } from "@/components/search";
import { MovieGrid } from "@/components/movies";
import { EmptyState, PageHeader, Skeleton } from "@/components/ui";
import { requestJson } from "@/services/client";
import type { Movie } from "@/domain/models";
type Result = { items: Movie[]; total: number; page: number; pageSize: number };
export function ExploreScreen({
  search = false,
  initial,
  options,
  filters,
}: {
  search?: boolean;
  initial: Result;
  options: { genres: string[]; countries: string[]; years: number[] };
  filters: Record<string, string | string[] | undefined>;
}) {
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
  }, [query, genre, country, year, sort, page, retry, filters.type]);
  return (
    <>
      {search ? <PageHeader title="Tìm kiếm" back="/explore" /> : null}
      <div className="content search-page">
        {!search ? <h1>Khám phá</h1> : null}
        <SearchBar
          value={query}
          onChange={(v) => {
            setQuery(v);
            setPage(1);
          }}
          autoFocus={search}
        />
        <div className="genres">
          {options.genres.map((label) => (
            <GenreChip
              key={label}
              label={label}
              active={genre === label}
              onClick={() => {
                setGenre(label);
                setPage(1);
              }}
            />
          ))}
        </div>
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
        {query ? (
          <p className="results-count">
            {data.total} kết quả cho “{query}”
          </p>
        ) : null}
        {error ? (
          <div role="alert">
            <p className="form-error">{error}</p>
            <button className="button secondary" onClick={() => setRetry((v) => v + 1)}>
              Thử lại
            </button>
          </div>
        ) : loading ? (
          <Skeleton className="skeleton-hero" />
        ) : data.items.length ? (
          <MovieGrid items={data.items} />
        ) : (
          <EmptyState title="Chưa tìm thấy phim" body="Thử tên phim khác hoặc thay đổi bộ lọc." />
        )}
        {data.total > data.pageSize ? (
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
