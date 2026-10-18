import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { ShortVideo } from "@/domain/shorts";
export function ShortMetadata({
  item,
  active,
  onCredits,
}: {
  item: ShortVideo;
  active: boolean;
  onCredits: () => void;
}) {
  return (
    <div className="short-copy">
      <span className="short-creator">
        {item.creator_name || "CineVjet"}{" "}
        {item.duration_seconds ? <span>· {item.duration_seconds}s</span> : null}
      </span>
      <h2>{item.title}</h2>
      <p>{item.description}</p>
      <span className="short-hashtags">{item.hashtags.join(" ")}</span>
      <button
        className="short-source"
        onClick={onCredits}
        tabIndex={active ? 0 : -1}
        aria-label="Nguồn và bản quyền video"
      >
        {item.source}
      </button>
      {item.movie_id && item.movie_slug ? (
        <Link
          href={`/movie/${item.movie_slug}`}
          className="short-movie-cta"
          tabIndex={active ? 0 : -1}
        >
          Xem phim đầy đủ
          <ChevronRight size={16} />
        </Link>
      ) : null}
    </div>
  );
}
