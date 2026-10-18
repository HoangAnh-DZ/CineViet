"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Search,
  Plus,
  Clapperboard,
  ExternalLink,
  Pencil,
  Save,
  Trash2,
  LockKeyhole,
  Unlock,
  UserRound,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import type { MovieInput } from "@/server/dashboard";
import { DashboardHeading } from "./dashboard-screen";
import { Modal, Coin } from "@/components/ui";
import { requestJson } from "@/services/client";
import { formatMoney } from "@/lib/format";
import { RewardCodesScreen } from "./reward-codes-screen";
import type {
  PresentedMovie as AdminMovie,
  PresentedUser as AdminUser,
  MemberActivity,
} from "./presentation-data";
type MovieBatch = { items: AdminMovie[]; total: number; page: number };
const blank: MovieInput = {
  title: "",
  original_title: "",
  slug: "",
  description: "",
  poster_url: "",
  backdrop_url: "",
  release_year: new Date().getFullYear(),
  country: "Việt Nam",
  duration_minutes: 90,
  rating: 0,
  type: "MOVIE",
  status: "DRAFT",
  vip_required: false,
  playback_url: "",
  language: "",
  license_name: "",
  license_url: "",
  license_source_url: "",
  source_page_url: "",
  attribution: "",
  poster_attribution: "",
  genres: [],
  episodes: [],
};
function movieForm(m: AdminMovie): MovieInput {
  return {
    title: String(m.title),
    original_title: String(m.original_title),
    slug: String(m.slug),
    description: String(m.description),
    poster_url: String(m.poster_url),
    backdrop_url: String(m.backdrop_url),
    release_year: Number(m.release_year),
    country: String(m.country),
    duration_minutes: Number(m.duration_minutes),
    rating: m.rating == null ? null : Number(m.rating),
    duration_seconds: m.duration_seconds,
    language: m.language || "",
    license_name: m.license_name || "",
    license_url: m.license_url || "",
    license_source_url: m.license_source_url || "",
    source_page_url: m.source_page_url || "",
    attribution: m.attribution || "",
    poster_attribution: m.poster_attribution || "",
    type: m.type as MovieInput["type"],
    status: m.status as MovieInput["status"],
    vip_required: Boolean(m.vip_required),
    playback_url: "",
  };
}
export function VideosScreen({ initial }: { initial: MovieBatch }) {
  const [batch, setBatch] = useState(initial),
    [query, setQuery] = useState(""),
    [type, setType] = useState(""),
    [status, setStatus] = useState(""),
    [editor, setEditor] = useState<AdminMovie | "new" | null>(null),
    [deleting, setDeleting] = useState<AdminMovie | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function load(page = 1) {
    setBusy(true);
    setError("");
    try {
      setBatch(
        await requestJson<MovieBatch>(
          `/api/admin/movies?q=${encodeURIComponent(query)}&type=${type}&status=${status}&page=${page}`,
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function hide() {
    if (!deleting) return;
    setBusy(true);
    try {
      await requestJson(`/api/admin/movies/${encodeURIComponent(String(deleting.id))}`, {
        method: "DELETE",
      });
      setDeleting(null);
      await load(batch.page);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const names: Record<string, string> = {
    PUBLISHED: "Đang phát hành",
    DRAFT: "Bản nháp",
    HIDDEN: "Đang ẩn",
  };
  return (
    <>
      <DashboardHeading
        title="Quản lý video"
        description="Quản lý kho phim và nội dung ngắn trên CineVjet."
        action={
          <button className="button primary" onClick={() => setEditor("new")}>
            <Plus size={17} />
            Thêm video
          </button>
        }
      />
      <div className="admin-content-tabs">
        <Link aria-current="page" href="/admin/videos">
          <Clapperboard size={17} />
          Kho phim
        </Link>
        <Link href="/admin/shorts">
          Phim ngắn
          <ExternalLink size={14} />
        </Link>
      </div>
      <section className="dashboard-panel">
        <form
          className="admin-filters"
          onSubmit={(e) => {
            e.preventDefault();
            void load();
          }}
        >
          <div className="admin-search">
            <Search size={17} />
            <input
              aria-label="Tìm kiếm phim"
              placeholder="Tìm kiếm tên phim…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <select aria-label="Loại phim" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">Tất cả loại phim</option>
            <option value="MOVIE">Phim lẻ</option>
            <option value="SERIES">Phim bộ</option>
          </select>
          <select
            aria-label="Trạng thái phim"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">Tất cả trạng thái</option>
            <option value="PUBLISHED">Đang phát hành</option>
            <option value="DRAFT">Bản nháp</option>
            <option value="HIDDEN">Đang ẩn</option>
          </select>
          <button className="button secondary" disabled={busy}>
            Tìm kiếm
          </button>
        </form>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="dashboard-table-wrap">
          <table className="dashboard-table">
            <thead>
              <tr>
                <th>Video / Phim</th>
                <th>Loại</th>
                <th>Số tập</th>
                <th>Trạng thái</th>
                <th>Người đã xem</th>
                <th>Ngày đăng</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {batch.items.map((m) => (
                <tr key={String(m.id)}>
                  <td>
                    <div className="admin-movie-cell">
                      <img src={String(m.poster_url)} alt="" loading="lazy" />
                      <div>
                        <strong>{String(m.title)}</strong>
                        <small>
                          {String(m.release_year)} · {String(m.duration_minutes)} phút
                        </small>
                      </div>
                    </div>
                  </td>
                  <td>{m.type === "SERIES" ? "Phim bộ" : "Phim lẻ"}</td>
                  <td>{m.type === "SERIES" ? m.episodes : "—"}</td>
                  <td>
                    <span
                      className={`admin-badge ${m.status === "PUBLISHED" ? "good" : "neutral"}`}
                    >
                      {names[String(m.status)]}
                    </span>
                  </td>
                  <td>{String(m.viewers)}</td>
                  <td>{m.created_at.slice(0, 10)}</td>
                  <td>
                    <div className="admin-row-actions">
                      <button aria-label={`Sửa ${m.title}`} onClick={() => setEditor(m)}>
                        <Pencil size={15} />
                      </button>
                      <Link
                        aria-label={`Xem ${m.title}`}
                        href={
                          m.status === "PUBLISHED"
                            ? `/movie/${m.slug}`
                            : `/admin/videos?preview=${m.id}`
                        }
                        onClick={(e) => {
                          if (m.status !== "PUBLISHED") {
                            e.preventDefault();
                            setEditor(m);
                          }
                        }}
                      >
                        <ExternalLink size={15} />
                      </Link>
                      <button aria-label={`Xóa ${m.title}`} onClick={() => setDeleting(m)}>
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!batch.items.length ? (
            <div className="dashboard-empty">
              <Clapperboard size={28} />
              <p>Không tìm thấy phim</p>
              <span>Thử từ khóa hoặc bộ lọc khác.</span>
            </div>
          ) : null}
        </div>
        <div className="admin-pagination">
          <span>
            {batch.total} phim · Trang {batch.page}
          </span>
          <div>
            <button
              aria-label="Trang trước"
              disabled={busy || batch.page <= 1}
              onClick={() => void load(batch.page - 1)}
            >
              <ChevronLeft size={18} />
            </button>
            <button
              aria-label="Trang sau"
              disabled={busy || batch.page * 30 >= batch.total}
              onClick={() => void load(batch.page + 1)}
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </section>
      {editor ? (
        <MovieEditor
          item={editor === "new" ? undefined : editor}
          onClose={() => setEditor(null)}
          onSaved={async () => {
            setEditor(null);
            await load();
          }}
        />
      ) : null}
      {deleting ? (
        <Modal title="Ẩn phim khỏi nền tảng?" onClose={() => setDeleting(null)}>
          <p>
            “{String(deleting.title)}” sẽ được ẩn. Phim, tập, nguồn video và lịch sử được giữ lại.
            Bạn có thể mở lại trong phần sửa trạng thái.
          </p>
          <button className="button primary" disabled={busy} onClick={() => void hide()}>
            Xác nhận ẩn phim
          </button>
        </Modal>
      ) : null}
    </>
  );
}
function MovieEditor({
  item,
  onClose,
  onSaved,
}: {
  item?: AdminMovie;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [data, setData] = useState<MovieInput>(() => (item ? movieForm(item) : { ...blank })),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(!!item),
    [genreText, setGenreText] = useState(""),
    [mediaStatus, setMediaStatus] = useState("");
  const [previewEpisode, setPreviewEpisode] = useState<number | null>(null);
  useEffect(() => {
    if (!item) return;
    let cancelled = false;
    requestJson<Pick<MovieInput, "genres" | "episodes">>(
      `/api/admin/movies/${encodeURIComponent(item.id)}`,
    )
      .then((detail) => {
        if (!cancelled) {
          setData((d) => ({ ...d, ...detail }));
          setGenreText((detail.genres || []).join(", "));
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [item]);
  function change<K extends keyof MovieInput>(key: K, value: MovieInput[K]) {
    setData((d) => ({ ...d, [key]: value }));
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await requestJson(
        item ? `/api/admin/movies/${encodeURIComponent(String(item.id))}` : "/api/admin/movies",
        {
          method: item ? "PUT" : "POST",
          body: JSON.stringify({
            ...data,
            genres: genreText
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
            backdrop_url: data.backdrop_url || data.poster_url,
          }),
        },
      );
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={item ? "Sửa phim / video" : "Thêm phim / video"}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form className="admin-editor-form" onSubmit={save}>
        <fieldset
          className="admin-editor-form"
          disabled={busy || loading}
          style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
        >
          {loading ? <p role="status">Đang tải thông tin phim…</p> : null}
          <label>
            Tên phim *
            <input
              required
              maxLength={160}
              value={data.title}
              onChange={(e) => change("title", e.target.value)}
            />
          </label>
          <div className="admin-editor-row">
            <label>
              Tên gốc
              <input
                value={data.original_title}
                onChange={(e) => change("original_title", e.target.value)}
              />
            </label>
            <label>
              Đường dẫn *
              <input
                required
                placeholder="ten-phim"
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                value={data.slug}
                onChange={(e) => change("slug", e.target.value)}
              />
            </label>
          </div>
          <label>
            Mô tả
            <textarea
              rows={3}
              maxLength={3000}
              value={data.description}
              onChange={(e) => change("description", e.target.value)}
            />
          </label>
          <div className="admin-editor-row">
            <label>
              Ảnh bìa URL *
              <input
                required
                value={data.poster_url}
                onChange={(e) => change("poster_url", e.target.value)}
              />
            </label>
            <label>
              Ảnh nền URL
              <input
                value={data.backdrop_url}
                onChange={(e) => change("backdrop_url", e.target.value)}
              />
            </label>
          </div>
          {data.poster_url ? (
            <img src={data.poster_url} alt="Preview ảnh bìa" className="admin-editor-poster" />
          ) : null}
          <div className="admin-editor-row">
            <label>
              Loại phim
              <select
                aria-label="Loại phim trong form"
                value={data.type}
                onChange={(e) => change("type", e.target.value as MovieInput["type"])}
              >
                <option value="MOVIE">Phim lẻ</option>
                <option value="SERIES">Phim bộ</option>
              </select>
            </label>
            <label>
              Trạng thái
              <select
                aria-label="Trạng thái trong form"
                value={data.status}
                onChange={(e) => change("status", e.target.value as MovieInput["status"])}
              >
                <option value="DRAFT">Bản nháp</option>
                <option value="PUBLISHED">Đang phát hành</option>
                <option value="HIDDEN">Đang ẩn</option>
              </select>
            </label>
          </div>
          <div className="admin-editor-row">
            {[
              ["release_year", "Năm phát hành", 1888, 2200],
              ["duration_minutes", "Thời lượng (phút)", 1, 10000],
              ["rating", "Đánh giá", 0, 10],
            ].map(([key, label, min, max]) => (
              <label key={key as string}>
                {label}
                <input
                  required={key !== "rating"}
                  type="number"
                  step={key === "rating" ? "0.1" : "1"}
                  min={min as number}
                  max={max as number}
                  value={data[key as "rating"] ?? ""}
                  onChange={(e) =>
                    change(
                      key as "rating",
                      key === "rating" && e.target.value === "" ? null : Number(e.target.value),
                    )
                  }
                />
              </label>
            ))}
            <label>
              Quốc gia
              <input
                required
                value={data.country}
                onChange={(e) => change("country", e.target.value)}
              />
            </label>
          </div>
          <div className="admin-editor-row">
            <label>
              Ngôn ngữ
              <input value={data.language} onChange={(e) => change("language", e.target.value)} />
            </label>
            <label>
              Thể loại (phân cách bằng dấu phẩy)
              <input value={genreText} onChange={(e) => setGenreText(e.target.value)} />
            </label>
          </div>
          <h3>Nguồn và giấy phép</h3>
          {(
            [
              ["license_name", "Loại giấy phép"],
              ["license_url", "URL giấy phép"],
              ["license_source_url", "Bằng chứng quyền phát lại"],
              ["source_page_url", "Trang nguồn chính thức"],
              ["attribution", "Ghi công phim"],
              ["poster_attribution", "Ghi công / quyền ảnh bìa"],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              {label}
              <input value={data[key]} onChange={(e) => change(key, e.target.value)} />
            </label>
          ))}
          <label>
            Video URL (MP4/WebM, tùy chọn)
            <input
              value={data.playback_url || ""}
              placeholder="Để trống để giữ nguyên nguồn hiện có"
              onChange={(e) => change("playback_url", e.target.value)}
            />
          </label>
          {data.type === "MOVIE" && (data.playback_url || item?.preview_url) ? (
            <video
              className="admin-preview"
              src={data.playback_url || item?.preview_url || undefined}
              controls
              muted
              playsInline
              preload="metadata"
              onLoadedMetadata={() =>
                setMediaStatus("Nguồn video tải được. Bấm phát để kiểm tra hình và âm thanh.")
              }
              onError={() =>
                setMediaStatus("Không tải được nguồn video. Kiểm tra URL và quyền truy cập.")
              }
            />
          ) : null}
          {mediaStatus ? <p role="status">{mediaStatus}</p> : null}
          {data.type === "SERIES" ? (
            <section className="admin-editor-form">
              <h3>Danh sách tập</h3>
              {(data.episodes || []).map((episode, index) => (
                <div
                  key={episode.id || index}
                  className="dashboard-panel"
                  style={{ padding: 12, display: "grid", gap: 10 }}
                >
                  <div className="admin-editor-row">
                    <label>
                      Mùa
                      <input
                        type="number"
                        min={1}
                        value={episode.season}
                        onChange={(e) =>
                          change(
                            "episodes",
                            data.episodes!.map((v, i) =>
                              i === index ? { ...v, season: Number(e.target.value) } : v,
                            ),
                          )
                        }
                      />
                    </label>
                    <label>
                      Tập
                      <input
                        type="number"
                        min={1}
                        value={episode.episode_number}
                        onChange={(e) =>
                          change(
                            "episodes",
                            data.episodes!.map((v, i) =>
                              i === index ? { ...v, episode_number: Number(e.target.value) } : v,
                            ),
                          )
                        }
                      />
                    </label>
                  </div>
                  <label>
                    Tên tập
                    <input
                      required
                      value={episode.title}
                      onChange={(e) =>
                        change(
                          "episodes",
                          data.episodes!.map((v, i) =>
                            i === index ? { ...v, title: e.target.value } : v,
                          ),
                        )
                      }
                    />
                  </label>
                  <label>
                    Mô tả tập
                    <textarea
                      value={episode.description || ""}
                      maxLength={3000}
                      rows={3}
                      onChange={(e) =>
                        change(
                          "episodes",
                          data.episodes!.map((v, i) =>
                            i === index ? { ...v, description: e.target.value } : v,
                          ),
                        )
                      }
                    />
                  </label>
                  <label>
                    Thời lượng (giây)
                    <input
                      required
                      type="number"
                      min={1}
                      max={86400}
                      value={episode.duration_seconds}
                      onChange={(e) =>
                        change(
                          "episodes",
                          data.episodes!.map((v, i) =>
                            i === index ? { ...v, duration_seconds: Number(e.target.value) } : v,
                          ),
                        )
                      }
                    />
                  </label>
                  <label>
                    Video MP4/WebM
                    <input
                      value={episode.playback_url}
                      onChange={(e) =>
                        change(
                          "episodes",
                          data.episodes!.map((v, i) =>
                            i === index ? { ...v, playback_url: e.target.value } : v,
                          ),
                        )
                      }
                    />
                  </label>
                  {episode.playback_url ? (
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() => setPreviewEpisode(previewEpisode === index ? null : index)}
                    >
                      {previewEpisode === index ? "Đóng xem thử" : "Kiểm tra nguồn tập"}
                    </button>
                  ) : null}
                  {episode.playback_url && previewEpisode === index ? (
                    <video
                      className="admin-preview"
                      controls
                      muted
                      playsInline
                      preload="none"
                      src={episode.playback_url}
                    />
                  ) : null}
                  <label>
                    Trạng thái tập
                    <select
                      value={episode.status}
                      onChange={(e) =>
                        change(
                          "episodes",
                          data.episodes!.map((v, i) =>
                            i === index
                              ? { ...v, status: e.target.value as "DRAFT" | "PUBLISHED" | "HIDDEN" }
                              : v,
                          ),
                        )
                      }
                    >
                      <option value="DRAFT">Bản nháp</option>
                      <option value="PUBLISHED">Phát hành</option>
                      <option value="HIDDEN">Ẩn</option>
                    </select>
                  </label>
                </div>
              ))}
              <button
                type="button"
                className="button secondary"
                onClick={() =>
                  change("episodes", [
                    ...(data.episodes || []),
                    {
                      season: 1,
                      episode_number:
                        Math.max(
                          0,
                          ...(data.episodes || [])
                            .filter((e) => e.season === 1)
                            .map((e) => e.episode_number),
                        ) + 1,
                      title: "",
                      duration_seconds: 1,
                      playback_url: "",
                      status: "DRAFT",
                    },
                  ])
                }
              >
                Thêm tập
              </button>
            </section>
          ) : null}
          <label className="admin-check">
            <input
              type="checkbox"
              checked={data.vip_required}
              onChange={(e) => change("vip_required", e.target.checked)}
            />
            Dành cho VIP
          </label>
        </fieldset>
        {error ? (
          <p role="alert" className="form-error">
            {error}
          </p>
        ) : null}
        <button className="button primary" disabled={busy || loading}>
          {busy ? "Đang lưu…" : "Lưu phim"}
        </button>
      </form>
    </Modal>
  );
}
export function UsersScreen({ initial, actor }: { initial: AdminUser[]; actor: string }) {
  const [items, setItems] = useState(initial),
    [q, setQ] = useState(""),
    [detail, setDetail] = useState<AdminUser | null>(null),
    [confirm, setConfirm] = useState<AdminUser | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    setBusy(true);
    try {
      setItems(
        (await requestJson<{ items: AdminUser[] }>(`/api/admin/users?q=${encodeURIComponent(q)}`))
          .items,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function update() {
    if (!confirm) return;
    setBusy(true);
    setError("");
    try {
      await requestJson(`/api/admin/users/${confirm.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: confirm.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE" }),
      });
      setConfirm(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <DashboardHeading
        title="Người dùng"
        description="Theo dõi thành viên và quản lý trạng thái tài khoản."
      />
      <section className="dashboard-panel">
        <form
          className="admin-filters"
          onSubmit={(e) => {
            e.preventDefault();
            void load();
          }}
        >
          <div className="admin-search">
            <Search size={17} />
            <input
              aria-label="Tìm kiếm người dùng"
              placeholder="Tìm tên hoặc email…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <button className="button secondary" disabled={busy}>
            Tìm kiếm
          </button>
        </form>
        {error ? (
          <p role="alert" className="form-error">
            {error}
          </p>
        ) : null}
        <div className="dashboard-table-wrap">
          <table className="dashboard-table">
            <thead>
              <tr>
                <th>Thành viên</th>
                <th>Cấp trên</th>
                <th>Cấp dưới</th>
                <th>VIP</th>
                <th>Số dư xu</th>
                <th>Trạng thái</th>
                <th>Vai trò</th>
                <th>Ngày tham gia</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {items.map((u) => (
                <tr key={String(u.id)}>
                  <td>
                    <div className="admin-user-cell">
                      <span className="user-monogram">
                        {u.avatar_url ? (
                          <img src={u.avatar_url} alt="" />
                        ) : (
                          String(u.display_name).slice(0, 1).toUpperCase()
                        )}
                      </span>
                      <div>
                        <strong>{String(u.display_name)}</strong>
                        <small>{String(u.email)}</small>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="admin-referral-cell">
                      <strong>{u.parent_name || "Không có"}</strong>
                      <small>{u.parent_email || "Tuyến gốc"}</small>
                    </div>
                  </td>
                  <td>
                    <div className="admin-referral-count">
                      <strong>{u.direct_referrals}</strong>
                      <small>trực tiếp · {u.network_size} toàn tuyến</small>
                    </div>
                  </td>
                  <td>
                    <span className={`admin-badge ${u.vip === "Free" ? "neutral" : "good"}`}>
                      {u.vip}
                    </span>
                  </td>
                  <td>{u.coins.toLocaleString("vi-VN")} xu</td>
                  <td>
                    <span className={`admin-badge ${u.status === "ACTIVE" ? "good" : "danger"}`}>
                      {u.status === "ACTIVE" ? "Hoạt động" : "Đã khóa"}
                    </span>
                  </td>
                  <td>
                    {u.is_admin ? (
                      <span className="gold">
                        <ShieldCheck size={13} /> Admin
                      </span>
                    ) : (
                      "Thành viên"
                    )}
                  </td>
                  <td>{u.created_at.slice(0, 10)}</td>
                  <td>
                    <div className="admin-row-actions">
                      <button
                        aria-label={`Chi tiết ${u.display_name}`}
                        onClick={() => setDetail(u)}
                      >
                        <UserRound size={16} />
                      </button>
                      <button
                        disabled={u.id === actor || !!u.is_admin}
                        aria-label={`${u.status === "ACTIVE" ? "Khóa" : "Mở khóa"} ${u.display_name}`}
                        onClick={() => setConfirm(u)}
                      >
                        {u.status === "ACTIVE" ? <LockKeyhole size={16} /> : <Unlock size={16} />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!items.length ? (
            <div className="dashboard-empty">
              <UsersIcon />
              <p>Không tìm thấy người dùng</p>
            </div>
          ) : null}
        </div>
      </section>
      {detail ? <MemberDrawer user={detail} onClose={() => setDetail(null)} /> : null}
      {confirm ? (
        <Modal
          title={confirm.status === "ACTIVE" ? "Khóa tài khoản?" : "Mở khóa tài khoản?"}
          onClose={() => setConfirm(null)}
        >
          <p>
            {String(confirm.display_name)} · {String(confirm.email)}
          </p>
          <p>
            {confirm.status === "ACTIVE"
              ? "Phiên đăng nhập hiện tại sẽ hết hiệu lực. Dữ liệu và số dư vẫn được giữ nguyên."
              : "Thành viên có thể đăng nhập lại bằng tài khoản hiện có."}
          </p>
          <button className="button primary" disabled={busy} onClick={() => void update()}>
            Xác nhận
          </button>
        </Modal>
      ) : null}
    </>
  );
}
function MemberDrawer({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const [activity, setActivity] = useState<MemberActivity | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    requestJson<MemberActivity>(`/api/admin/users/${encodeURIComponent(user.id)}`).then(
      (d) => {
        if (current) setActivity(d);
      },
      (e) => {
        if (current) setError(e.message);
      },
    );
    return () => {
      current = false;
    };
  }, [user.id]);
  return (
    <div className="admin-member-drawer">
      <Modal title="Thông tin thành viên" onClose={onClose}>
        <div className="member-drawer-profile">
          <span className="user-monogram">{user.display_name.slice(0, 1).toUpperCase()}</span>
          <div>
            <h2>{user.display_name}</h2>
            <p>{user.email}</p>
          </div>
        </div>
        <dl className="admin-user-details">
          <dt>Ngày tham gia</dt>
          <dd>{user.created_at.slice(0, 10)}</dd>
          <dt>VIP</dt>
          <dd>{user.vip}</dd>
          <dt>Số dư xu</dt>
          <dd>{user.coins.toLocaleString("vi-VN")} xu</dd>
          <dt>Trạng thái</dt>
          <dd>{user.status === "ACTIVE" ? "Hoạt động" : "Đã khóa"}</dd>
          <dt>Phim đã xem</dt>
          <dd>{user.watched}</dd>
          <dt>Mã giới thiệu</dt>
          <dd>{user.referral_code || "Chưa tạo"}</dd>
          <dt>Cấp trên</dt>
          <dd>{user.parent_name ? `${user.parent_name} · ${user.parent_email}` : "Không có"}</dd>
          <dt>Cấp dưới trực tiếp</dt>
          <dd>{user.direct_referrals} thành viên</dd>
          <dt>Tổng tuyến dưới</dt>
          <dd>{user.network_size} thành viên</dd>
        </dl>
        {error ? (
          <p role="alert" className="form-error">
            {error}
          </p>
        ) : activity ? (
          <>
            <section className="member-activity">
              <h3>Tổng quan tiền của thành viên</h3>
              <dl className="admin-user-details">
                <dt>Số dư VND</dt>
                <dd>{formatMoney(activity.money.balance)}</dd>
                <dt>Đang giữ</dt>
                <dd>{formatMoney(activity.money.reserved)}</dd>
                <dt>Khả dụng</dt>
                <dd>{formatMoney(activity.money.available)}</dd>
                <dt>Xu thưởng</dt>
                <dd>{activity.money.coins.toLocaleString("vi-VN")} xu</dd>
                <dt>Xu đang giữ để đổi thưởng</dt>
                <dd>{activity.money.reserved_coins.toLocaleString("vi-VN")} xu</dd>
                <dt>Đổi thưởng chờ duyệt</dt>
                <dd>{activity.money.pending_redemptions}</dd>
                <dt>Tổng nạp đã duyệt</dt>
                <dd>{formatMoney(activity.money.deposited)}</dd>
                <dt>Tổng rút hoàn tất</dt>
                <dd>{formatMoney(activity.money.withdrawn)}</dd>
                <dt>Nạp đang chờ</dt>
                <dd>{activity.money.pending_deposits}</dd>
                <dt>Rút đang chờ</dt>
                <dd>{activity.money.pending_withdrawals}</dd>
              </dl>
            </section>
            <section className="member-activity">
              <h3>Hoạt động xem gần đây</h3>
              {activity.watch.length ? (
                activity.watch.map((w, i) => (
                  <div key={i}>
                    <span>
                      {w.title}
                      {w.episode ? ` · Tập ${w.episode}` : ""}
                      <small>
                        {Math.round(w.position / 60)}/{Math.ceil(w.duration / 60)} phút
                      </small>
                    </span>
                    <small>{w.date.slice(0, 10)}</small>
                  </div>
                ))
              ) : (
                <p>Chưa có lịch sử xem.</p>
              )}
            </section>
            <section className="member-activity">
              <h3>Phần thưởng gần đây</h3>
              {activity.rewards.length ? (
                activity.rewards.map((r) => (
                  <div key={r.id}>
                    <span>
                      {r.reason.startsWith("DAILY_CHECKIN") ? "Điểm danh" : r.reason}
                      <small>{r.date.slice(0, 10)}</small>
                    </span>
                    <strong>
                      {r.amount > 0 ? "+" : ""}
                      {r.amount.toLocaleString("vi-VN")} xu
                    </strong>
                  </div>
                ))
              ) : (
                <p>Chưa có giao dịch xu.</p>
              )}
            </section>
            <section className="member-activity">
              <h3>Giao dịch gần đây</h3>
              {activity.transactions.length ? (
                activity.transactions.map((t) => (
                  <div key={t.kind + t.id}>
                    <span>
                      {t.kind}
                      <small>
                        {t.date.slice(0, 10)} ·{" "}
                        {(
                          {
                            COMPLETED: "Hoàn tất",
                            PENDING: "Chờ xử lý",
                            PROCESSING: "Đang xử lý",
                            FAILED: "Thất bại",
                            REJECTED: "Từ chối",
                          } as Record<string, string>
                        )[t.status] || t.status}
                      </small>
                    </span>
                    <strong>{formatMoney(t.amount)}</strong>
                  </div>
                ))
              ) : (
                <p>Chưa có giao dịch tiền mặt.</p>
              )}
            </section>
          </>
        ) : (
          <p role="status">Đang tải hoạt động…</p>
        )}
      </Modal>
    </div>
  );
}
function UsersIcon() {
  return <UserRound size={27} />;
}
export function AdminRewardsScreen({
  data,
  mode = "all",
}: {
  data: {
    balance: number;
    issued: number;
    checkins: number;
    memberships: number;
    plans: Record<string, unknown>[];
  };
  mode?: "all" | "plans" | "codes";
}) {
  const [plans, setPlans] = useState(data.plans);
  const showPlans = mode !== "codes";
  const showCodes = mode !== "plans";
  return (
    <>
      <DashboardHeading
        title={
          mode === "plans" ? "Quản lý gói VIP" : mode === "codes" ? "Mã đổi thưởng" : "Phần thưởng"
        }
        description={
          mode === "plans"
            ? "Theo dõi giá, thời hạn và nhiệm vụ của từng gói VIP."
            : mode === "codes"
              ? "Tạo và theo dõi mã xu phát hành cho thành viên."
              : "Theo dõi xu, điểm danh và các hạng thành viên đang áp dụng."
        }
      />
      {showPlans ? (
        <>
          <div className="dashboard-metrics">
            {[
              ["Xu đang lưu hành", data.balance],
              ["Xu đã phát", data.issued],
              ["Lượt điểm danh", data.checkins],
              ["VIP đang hoạt động", data.memberships],
            ].map(([title, value]) => (
              <article key={title} className="dashboard-metric">
                <div>
                  <span>{title}</span>
                  <Coin small />
                </div>
                <strong>{Number(value).toLocaleString("vi-VN")}</strong>
                <small>Dữ liệu hiện tại từ hệ thống thưởng</small>
              </article>
            ))}
          </div>
          <section className="dashboard-panel">
            <div className="dashboard-panel-heading">
              <div>
                <h2>Hạng thành viên</h2>
                <p>Lịch thưởng đang áp dụng</p>
              </div>
              <Link href="/vip">
                Xem quyền lợi
                <ExternalLink size={15} />
              </Link>
            </div>
            <div className="admin-tier-grid">
              {plans.map((p) => (
                <article key={String(p.id)}>
                  <span className="admin-badge neutral">{String(p.reward_tier || "Free")}</span>
                  <h3>{String(p.name)}</h3>
                  <strong>{formatMoney(Number(p.price))}</strong>
                  <p>
                    {Number(p.mission_count || 0) > 0
                      ? `${Number(p.mission_count)} nhiệm vụ/ngày · ${Number(p.mission_reward).toLocaleString("vi-VN")} xu/nhiệm vụ · ${Number(p.duration_days)} ngày`
                      : Array.isArray(p.checkin_rewards)
                        ? p.checkin_rewards.map(Number).join(" · ")
                        : "Chưa cấu hình lịch thưởng"}
                  </p>
                  <p>
                    {Number(p.mission_count || 0) * Number(p.duration_days)} video · 1 xu = 1 VNĐ
                  </p>
                  <small>
                    {p.purchase_enabled && p.active
                      ? "Đang bán"
                      : p.active
                        ? "Chỉ lịch sử"
                        : "Không hoạt động"}
                  </small>
                  <VipPlanEditor
                    plan={p}
                    onSaved={(updated) =>
                      setPlans((current) =>
                        current.map((item) =>
                          String(item.id) === String(updated.id) ? { ...item, ...updated } : item,
                        ),
                      )
                    }
                  />
                </article>
              ))}
            </div>
          </section>
        </>
      ) : null}
      {showCodes ? <RewardCodesScreen /> : null}
    </>
  );
}

function VipPlanEditor({
  plan,
  onSaved,
}: {
  plan: Record<string, unknown>;
  onSaved: (updated: Record<string, unknown>) => void;
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const [draft, setDraft] = useState({
    name: String(plan.name || ""),
    price: Number(plan.price || 0),
    duration_days: Number(plan.duration_days || 0),
    active: Boolean(plan.active),
    purchase_enabled: Boolean(plan.purchase_enabled),
    mission_count: Number(plan.mission_count || 0),
    mission_reward: Number(plan.mission_reward || 0),
  });
  const formId = `vip-plan-form-${String(plan.id)}`;
  const isFree = plan.id === "FREE";
  function setNumber(
    key: "price" | "duration_days" | "mission_count" | "mission_reward",
    value: string,
  ) {
    setDraft((current) => ({ ...current, [key]: Number(value) }));
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const updated = await requestJson<Record<string, unknown>>(
        `/api/admin/plans/${encodeURIComponent(String(plan.id))}`,
        { method: "PATCH", body: JSON.stringify(draft) },
      );
      onSaved(updated);
      setMessage("Đã lưu");
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không lưu được gói VIP.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="admin-plan-editor">
      <button
        type="button"
        className="button secondary admin-plan-edit-toggle"
        disabled={busy}
        aria-expanded={open}
        aria-controls={formId}
        onClick={() => {
          setOpen((value) => !value);
          setMessage("");
          setError("");
        }}
      >
        <Pencil size={14} aria-hidden="true" />
        {open ? "Đóng chỉnh sửa" : "Sửa thông tin gói"}
      </button>
      {message ? (
        <div className="admin-feedback is-success" role="status">
          {message}
        </div>
      ) : null}
      {open ? (
        <form
          id={formId}
          onSubmit={save}
          className="admin-plan-form admin-plan-edit-form"
          aria-busy={busy}
        >
          <fieldset className="admin-form-fieldset" disabled={busy}>
            <div className="admin-form-grid">
              <label className="admin-form-field">
                <span>Tên gói</span>
                <input
                  className="field"
                  required
                  maxLength={80}
                  value={draft.name}
                  onChange={(e) => setDraft((current) => ({ ...current, name: e.target.value }))}
                />
              </label>
              <label className="admin-form-field">
                <span>Giá (đ)</span>
                <input
                  className="field"
                  required
                  disabled={isFree}
                  type="number"
                  min="0"
                  max="10000000000"
                  step="1"
                  value={draft.price}
                  onChange={(e) => setNumber("price", e.target.value)}
                />
              </label>
              <label className="admin-form-field">
                <span>Thời hạn (ngày)</span>
                <input
                  className="field"
                  required
                  type="number"
                  min="0"
                  max="3650"
                  step="1"
                  value={draft.duration_days}
                  onChange={(e) => setNumber("duration_days", e.target.value)}
                />
              </label>
              <label className="admin-form-field">
                <span>Số nhiệm vụ/ngày</span>
                <input
                  className="field"
                  required
                  disabled={isFree}
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  value={draft.mission_count}
                  onChange={(e) => setNumber("mission_count", e.target.value)}
                />
              </label>
              <label className="admin-form-field">
                <span>Xu/video</span>
                <input
                  className="field"
                  required
                  type="number"
                  min="0"
                  max="10000000"
                  step="1"
                  value={draft.mission_reward}
                  onChange={(e) => setNumber("mission_reward", e.target.value)}
                />
              </label>
              <div className="admin-form-field">
                <span>Tổng video</span>
                <strong>{draft.mission_count * draft.duration_days}</strong>
                <small>
                  Thay đổi chỉ áp dụng cho yêu cầu mua mới. VIP đã mua giữ quyền lợi đã lưu.
                </small>
              </div>
            </div>
            <div className="admin-plan-switches">
              <label className="admin-plan-check">
                <input
                  type="checkbox"
                  role="switch"
                  checked={draft.active}
                  onChange={(e) =>
                    setDraft((current) => ({ ...current, active: e.target.checked }))
                  }
                />{" "}
                Đang hoạt động
              </label>
              <label className="admin-plan-check">
                <input
                  type="checkbox"
                  role="switch"
                  disabled={isFree}
                  checked={draft.purchase_enabled}
                  onChange={(e) =>
                    setDraft((current) => ({ ...current, purchase_enabled: e.target.checked }))
                  }
                />{" "}
                Cho phép mua mới
              </label>
            </div>
          </fieldset>
          {error ? (
            <div className="admin-feedback is-error" role="alert">
              {error}
            </div>
          ) : null}
          <footer className="admin-form-footer">
            <button className="button primary" disabled={busy}>
              <Save size={16} aria-hidden="true" />
              {busy ? "Đang lưu…" : "Lưu thông tin gói"}
            </button>
          </footer>
        </form>
      ) : null}
    </div>
  );
}
