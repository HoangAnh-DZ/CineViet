import type { Movie } from "@/domain/models";

export function MovieCredit({ movie }: { movie: Movie }) {
  if (!movie.license_name) return null;
  return (
    <details className="movie-credit" aria-label="Credits và bản quyền">
      <summary>Credits & bản quyền · {movie.license_name}</summary>
      <p>{movie.attribution}</p>
      <p>
        <a href={movie.license_url} target="_blank" rel="noopener noreferrer">
          {movie.license_name}
        </a>
        {" · "}
        <a href={movie.license_source_url} target="_blank" rel="noopener noreferrer">
          Quyền sử dụng
        </a>
        {" · "}
        <a href={movie.source_page_url} target="_blank" rel="noopener noreferrer">
          Trang nguồn
        </a>
      </p>
      {movie.poster_attribution ? <small>{movie.poster_attribution}</small> : null}
    </details>
  );
}
