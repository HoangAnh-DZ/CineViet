import type { Movie } from "@/domain/models";
import Link from "next/link";

export function MovieCredit({ movie }: { movie: Movie }) {
  if (!movie.license_name) return null;
  return (
    <Link className="movie-credit-link" href={`/movie/${encodeURIComponent(movie.slug)}/credits`}>
      Thông tin bản quyền
    </Link>
  );
}
