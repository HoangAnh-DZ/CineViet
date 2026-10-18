"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Bookmark,
  Clock3,
  Play,
  Trash2,
  Film,
  ArrowUpRight,
  Crown,
  LoaderCircle,
} from "lucide-react";
import { useApp } from "@/components/providers";
import { WatchProgressBar } from "@/components/movies";
import { requestJson } from "@/services/client";
import type { Movie, WatchProgress } from "@/domain/models";
import type { ShortVideo } from "@/domain/shorts";
export type LibraryData = { recent: WatchProgress[]; movies: Movie[]; shorts: ShortVideo[] };
const tabs = [
  { id: "recent", label: "Đã xem gần đây", Icon: Clock3 },
  { id: "saved", label: "Đã lưu", Icon: Bookmark },
] as const;
function LibraryIllustration({ saved }: { saved: boolean }) {
  return (
    <svg className="library-illustration" viewBox="0 0 144 104" fill="none" aria-hidden="true">
      <ellipse cx="72" cy="95" rx="54" ry="5" fill="#000" opacity=".24" />
      <rect
        x="32"
        y="12"
        width="88"
        height="68"
        rx="10"
        transform="rotate(9 32 12)"
        fill="#17232F"
        stroke="#334252"
      />
      <rect
        x="16"
        y="25"
        width="96"
        height="64"
        rx="10"
        transform="rotate(-6 16 25)"
        fill="#121922"
        stroke="#415166"
      />
      <path d="M24 40l80-8M28 77l80-8" stroke="#2A3949" strokeWidth="2" />
      <path
        d="M31 31l5-.5M47 29.5l5-.5M63 28l5-.5M79 26.5l5-.5M95 25l5-.5M36 82l5-.5M52 80.5l5-.5M68 79l5-.5M84 77.5l5-.5M100 76l5-.5"
        stroke="#526176"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <circle cx="66" cy="56" r="17" fill="#38202B" />
      {saved ? (
        <path d="M60 45h12v24l-6-4-6 4V45Z" fill="#EC6274" />
      ) : (
        <path d="m62 46 14 9-14 9V46Z" fill="#EC6274" />
      )}
      <circle cx="114" cy="79" r="14" fill="#202B38" stroke="#425367" />
      {saved ? (
        <path d="M109 79h10m-5-5v10" stroke="#A9BACA" strokeWidth="2" strokeLinecap="round" />
      ) : (
        <path d="M114 72v7l5 3" stroke="#A9BACA" strokeWidth="2" strokeLinecap="round" />
      )}
    </svg>
  );
}
export function ListScreen({ initial, signedIn }: { initial: LibraryData; signedIn: boolean }) {
  const [data, setData] = useState(initial),
    [tab, setTab] = useState<"recent" | "saved">("recent"),
    [filter, setFilter] = useState("ALL"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState("");
  const { user, toast, refreshAccount, hydrated } = useApp();
  const hasAccount = hydrated ? !!user : signedIn;
  const requestVersion = useRef(0);
  useEffect(() => {
    setData(initial);
  }, [initial]);
  useEffect(() => {
    if (!hydrated || !user) return;
    let current = true;
    const version = ++requestVersion.current;
    requestJson<LibraryData>("/api/library").then(
      (next) => {
        if (current && version === requestVersion.current) setData(next);
      },
      (e: Error) => {
        if (current && version === requestVersion.current) setError(e.message);
      },
    );
    return () => {
      current = false;
    };
  }, [hydrated, user?.id]);
  async function reload() {
    const version = ++requestVersion.current;
    const next = await requestJson<LibraryData>("/api/library");
    if (version === requestVersion.current) setData(next);
  }
  async function remove(key: string, run: () => Promise<unknown>) {
    setBusy(key);
    requestVersion.current++;
    setError("");
    try {
      await run();
      await Promise.all([reload(), refreshAccount()]);
      toast("Đã cập nhật Danh sách");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  const shownMovies = filter === "SHORTS" ? [] : data.movies;
  const shownShorts = filter === "MOVIES" ? [] : data.shorts;
  const empty = tab === "recent" ? !data.recent.length : !shownMovies.length && !shownShorts.length;
  return (
    <div className="list-page">
      <header>
        <h1>Danh sách của tôi</h1>
      </header>
      <div className="library-tabs" role="tablist" aria-label="Danh sách cá nhân">
        {tabs.map(({ id, label, Icon }) => {
          return (
            <button
              key={id}
              id={`library-tab-${id}`}
              role="tab"
              aria-controls="library-panel"
              aria-selected={tab === id}
              tabIndex={tab === id ? 0 : -1}
              onClick={() => setTab(id)}
              onKeyDown={(event) => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                event.preventDefault();
                const next =
                  event.key === "Home"
                    ? "recent"
                    : event.key === "End"
                      ? "saved"
                      : tab === "recent"
                        ? "saved"
                        : "recent";
                setTab(next);
                document.getElementById(`library-tab-${next}`)?.focus();
              }}
            >
              <Icon size={18} aria-hidden="true" />
              <span className="library-tab-label">{label}</span>
              <span className="library-count">
                {id === "recent" ? data.recent.length : data.movies.length + data.shorts.length}
              </span>
            </button>
          );
        })}
      </div>
      {tab === "saved" ? (
        <div className="library-filters" aria-label="Loại nội dung đã lưu">
          {[
            ["ALL", "Tất cả"],
            ["MOVIES", "Phim"],
            ["SHORTS", "Phim ngắn"],
          ].map(([id, label]) => (
            <button key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}>
              {label}
            </button>
          ))}
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="form-error">
          {error}
        </p>
      ) : null}
      <section id="library-panel" role="tabpanel" aria-labelledby={`library-tab-${tab}`}>
        {!hasAccount ? (
          <div className="library-empty">
            <LibraryIllustration saved />
            <div className="library-empty-copy">
              <h2>Một nơi cho những phim bạn yêu thích</h2>
              <p>Đăng nhập để đồng bộ phim đã xem và video đã lưu.</p>
              <Link className="button primary" href="/login">
                Đăng nhập
                <ArrowUpRight size={16} />
              </Link>
            </div>
          </div>
        ) : empty ? (
          <div className="library-empty">
            <LibraryIllustration saved={tab === "saved"} />
            <div className="library-empty-copy">
              <h2>{tab === "recent" ? "Chưa có phim đã xem" : "Chưa có phim đã lưu"}</h2>
              <p>
                {tab === "recent"
                  ? "Phim bạn xem sẽ xuất hiện tại đây."
                  : "Lưu phim yêu thích để xem sau."}
              </p>
              <Link className="button primary" href="/explore">
                Khám phá phim
                <ArrowUpRight size={16} />
              </Link>
            </div>
          </div>
        ) : (
          <div className={`library-grid ${tab === "recent" ? "recent-grid" : "saved-grid"}`}>
            {tab === "recent" ? (
              data.recent.map((p) =>
                p.movie ? (
                  <article className="library-card" key={p.movie_id + ":" + (p.episode_id || "")}>
                    <Link
                      className="library-poster landscape"
                      href={`/watch/${p.movie_id}${p.episode_id ? "/" + p.episode_id : ""}`}
                    >
                      <img
                        src={p.movie.backdrop || p.movie.poster}
                        alt={p.movie.title}
                        loading="lazy"
                      />
                      <span className="library-play">
                        <Play size={19} fill="currentColor" />
                      </span>
                      <WatchProgressBar
                        position={p.position_seconds}
                        duration={p.duration_seconds}
                      />
                      {p.movie.vip_required ? (
                        <span className="library-vip">
                          <Crown size={12} /> VIP
                        </span>
                      ) : null}
                    </Link>
                    <div className="library-card-copy">
                      <h2>
                        <Link
                          href={`/watch/${p.movie_id}${p.episode_id ? "/" + p.episode_id : ""}`}
                        >
                          {p.movie.title}
                        </Link>
                      </h2>
                      <p>
                        {p.episode_number ? `Tập ${p.episode_number} · ` : ""}
                        {Math.round(p.position_seconds / 60)}/{Math.ceil(p.duration_seconds / 60)}{" "}
                        phút
                      </p>
                      <Link
                        href={`/watch/${p.movie_id}${p.episode_id ? "/" + p.episode_id : ""}`}
                        className="library-resume"
                      >
                        <Play size={14} />
                        Tiếp tục xem
                      </Link>
                    </div>
                    <button
                      className="library-remove"
                      aria-label={`Xóa ${p.movie.title} khỏi lịch sử`}
                      disabled={!!busy}
                      aria-busy={busy === p.movie_id}
                      onClick={() =>
                        void remove(p.movie_id, () =>
                          requestJson("/api/library/history", {
                            method: "DELETE",
                            body: JSON.stringify({
                              movie_id: p.movie_id,
                              episode_id: p.episode_id || null,
                            }),
                          }),
                        )
                      }
                    >
                      {busy === p.movie_id ? (
                        <LoaderCircle size={18} className="library-spinner" />
                      ) : (
                        <Trash2 size={18} />
                      )}
                    </button>
                  </article>
                ) : null,
              )
            ) : (
              <>
                {shownMovies.map((m) => (
                  <article className="library-card" key={m.id}>
                    <Link className="library-poster" href={`/movie/${m.slug}`}>
                      <img src={m.poster} alt={m.title} loading="lazy" />
                      <span className="library-kind">
                        <Film size={12} />
                        {m.type === "SERIES" ? "Phim bộ" : "Phim lẻ"}
                      </span>
                      {m.vip_required ? (
                        <span className="library-vip">
                          <Crown size={12} /> VIP
                        </span>
                      ) : null}
                    </Link>
                    <div className="library-card-copy">
                      <h2>
                        <Link href={`/movie/${m.slug}`}>{m.title}</Link>
                      </h2>
                      <p>
                        {m.release_year} · {m.country}
                      </p>
                      <Link className="library-resume" href={`/watch/${m.id}`}>
                        <Play size={14} fill="currentColor" /> Xem phim
                      </Link>
                    </div>
                    <button
                      className="library-remove"
                      aria-label={`Bỏ lưu ${m.title}`}
                      disabled={!!busy}
                      aria-busy={busy === m.id}
                      onClick={() =>
                        void remove(m.id, () =>
                          requestJson("/api/favorites", {
                            method: "PUT",
                            body: JSON.stringify({ movie_id: m.id, active: false }),
                          }),
                        )
                      }
                    >
                      {busy === m.id ? (
                        <LoaderCircle size={18} className="library-spinner" />
                      ) : (
                        <Bookmark size={18} fill="currentColor" />
                      )}
                    </button>
                  </article>
                ))}
                {shownShorts.map((s) => (
                  <article className="library-card saved-short-card" key={s.id}>
                    <Link
                      className="library-poster short-poster"
                      href={`/shorts?id=${encodeURIComponent(s.id)}`}
                    >
                      {s.thumbnail_url ? (
                        <img src={s.thumbnail_url} alt={s.title} loading="lazy" />
                      ) : (
                        <span className="library-placeholder">
                          <Play size={32} />
                        </span>
                      )}
                      <span className="library-kind">
                        <Film size={12} /> Phim ngắn
                      </span>
                    </Link>
                    <div className="library-card-copy">
                      <h2>{s.title}</h2>
                      <p>{s.duration_seconds ? `${s.duration_seconds} giây` : "Video ngắn"}</p>
                      <Link
                        className="library-resume"
                        href={`/shorts?id=${encodeURIComponent(s.id)}`}
                      >
                        <Play size={14} fill="currentColor" /> Xem phim ngắn
                      </Link>
                    </div>
                    <button
                      className="library-remove"
                      aria-label={`Bỏ lưu ${s.title}`}
                      disabled={!!busy}
                      aria-busy={busy === s.id}
                      onClick={() =>
                        void remove(s.id, () =>
                          requestJson(`/api/library/shorts/${encodeURIComponent(s.id)}`, {
                            method: "PUT",
                            body: JSON.stringify({ saved: false }),
                          }),
                        )
                      }
                    >
                      {busy === s.id ? (
                        <LoaderCircle size={18} className="library-spinner" />
                      ) : (
                        <Bookmark size={18} fill="currentColor" />
                      )}
                    </button>
                  </article>
                ))}
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
