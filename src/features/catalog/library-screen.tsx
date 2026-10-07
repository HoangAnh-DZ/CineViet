"use client";
import Link from "next/link";
import { useApp } from "@/components/providers";
import { MovieGrid, ContinueWatchingCard } from "@/components/movies";
import { PageHeader, EmptyState } from "@/components/ui";
export function LibraryScreen({ history = false }: { history?: boolean }) {
  const { favoriteMovies: items, progress } = useApp();
  return (
    <>
      <PageHeader title={history ? "Lịch sử xem" : "Phim yêu thích"} />
      <div className="content">
        {history ? (
          progress.length ? (
            <div className="movie-grid">
              {progress.map((p) => (
                <ContinueWatchingCard key={`${p.movie_id}-${p.episode_id}`} progress={p} />
              ))}
            </div>
          ) : (
            <EmptyState
              title="Chưa có lịch sử xem"
              body="Bắt đầu một bộ phim để tiếp tục xem tại đây."
            />
          )
        ) : items.length ? (
          <MovieGrid items={items} />
        ) : (
          <EmptyState
            title="Chưa có phim yêu thích"
            body="Nhấn biểu tượng trái tim trên trang phim để lưu vào thư viện."
          >
            <Link className="button primary" href="/explore">
              Khám phá phim
            </Link>
          </EmptyState>
        )}
      </div>
    </>
  );
}
