"use client";
import { AppHeader } from "@/components/navigation";
import { ContinueWatchingCard, HeroMovie, MovieRow } from "@/components/movies";
import { EmptyState, SectionHeader } from "@/components/ui";
import { useApp } from "@/components/providers";
import type { Movie } from "@/domain/models";
export function HomeScreen({
  data,
}: {
  data: {
    featured: Movie[];
    trending: Movie[];
    newest: Movie[];
    series: Movie[];
    recommended: Movie[];
  };
}) {
  const { progress } = useApp();
  return (
    <>
      <AppHeader />
      <HeroMovie items={data.featured} />
      <div className="content">
        <section>
          <SectionHeader title="Tiếp tục xem" href="/history" />
          <div className="continue-row">
            {progress
              .filter((p) => !p.completed)
              .slice(0, 5)
              .map((item) => (
                <ContinueWatchingCard key={`${item.movie_id}-${item.episode_id}`} progress={item} />
              ))}
          </div>
          {!progress.some((p) => !p.completed) ? (
            <EmptyState
              title="Chưa có phim đang xem"
              body="Tiến độ xem sẽ xuất hiện tại đây khi bạn đăng nhập và xem phim."
            />
          ) : null}
        </section>
        <MovieRow title="Phim tuyển chọn" items={data.trending} query="?sort=newest" />
        <MovieRow title="Mới phát hành" items={data.newest} query="?sort=newest" />
        <MovieRow title="Phim bộ đặc sắc" items={data.series} query="?genre=Phim%20bộ" />
        <MovieRow title="Dành cho bạn" items={data.recommended} />
      </div>
    </>
  );
}
