import type { Movie } from "@/domain/models";

export function MovieCredit({ movie }: { movie: Movie }) {
  if (!movie.license_name) return null;
  return (
    <section className="movie-credit" aria-label="Nguồn và giấy phép">
      <p>{movie.attribution}</p>
      <p>
        <a href={movie.license_url} target="_blank" rel="noreferrer">
          {movie.license_name}
        </a>
        {" · "}
        <a href={movie.license_source_url} target="_blank" rel="noreferrer">
          Quyền sử dụng
        </a>
        {" · "}
        <a href={movie.source_page_url} target="_blank" rel="noreferrer">
          Trang nguồn
        </a>
      </p>
      {movie.poster_attribution ? <small>{movie.poster_attribution}</small> : null}
    </section>
  );
}
