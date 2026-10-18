import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { findMovie, movieSourceCredits } from "@/server/catalog";
import { PageHeader } from "@/components/ui";
import type { VideoSource } from "@/domain/models";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Thông tin bản quyền" };
function Credit({ credit }: { credit: NonNullable<VideoSource["credit"]> }) {
  return (
    <>
      <p>{credit.attribution}</p>
      <p className="copyright-links">
        {[
          [credit.license_url, credit.license_name],
          [credit.license_source_url, "Quyền sử dụng"],
          [credit.source_page_url, "Trang nguồn"],
        ].map(([href, label], i) =>
          href ? (
            <a key={i} href={href} target="_blank" rel="noopener noreferrer">
              {label}
            </a>
          ) : null,
        )}
      </p>
      {credit.poster_attribution ? <p>{credit.poster_attribution}</p> : null}
    </>
  );
}
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const movie = await findMovie((await params).slug);
  if (!movie) notFound();
  const sources = await movieSourceCredits(movie.id);
  const distinct = sources.filter(
    (s, i) =>
      sources.findIndex((x) => JSON.stringify(x.credit) === JSON.stringify(s.credit)) === i &&
      JSON.stringify(s.credit) !==
        JSON.stringify({
          license_name: movie.license_name,
          license_url: movie.license_url,
          license_source_url: movie.license_source_url,
          source_page_url: movie.source_page_url,
          attribution: movie.attribution,
          poster_attribution: movie.poster_attribution,
        }),
  );
  return (
    <>
      <PageHeader title="Thông tin bản quyền" back={`/movie/${encodeURIComponent(movie.slug)}`} />
      <article className="content copyright-page">
        <h2>{movie.title}</h2>
        {movie.license_name ? <Credit credit={movie} /> : null}
        {distinct.map((source) => (
          <section key={source.id}>
            <h3>{source.title}</h3>
            <Credit credit={source.credit} />
          </section>
        ))}
      </article>
    </>
  );
}
