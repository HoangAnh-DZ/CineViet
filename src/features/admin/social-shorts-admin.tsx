"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { RefreshCw, Plus, Eye } from "lucide-react";
import { DashboardHeading } from "./dashboard-screen";
import { Modal } from "@/components/ui";
import { requestJson } from "@/services/client";
import { parseSocialVideo, socialErrorLabel, type SocialProvider } from "@/domain/social-shorts";
import type { SocialAdminData } from "@/server/social-shorts";
import "./social-shorts-admin.css";
type Row = Record<string, unknown>;
const stamp = (v: unknown) =>
  v ? new Date(v as string).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) : "—";
const label = (v: unknown) =>
  ({
    PENDING: "Chờ duyệt",
    QUEUED: "Đã xếp hàng",
    PUBLISHED: "Đã xuất bản",
    HIDDEN: "Đã ẩn",
    REJECTED: "Từ chối",
    UNAVAILABLE: "Không khả dụng",
    VERIFIED: "Đã xác minh",
    AVAILABLE: "Nhúng khả dụng",
    NEEDS_REVIEW: "Cần kiểm tra",
    RUNNING: "Đang chạy",
    COMPLETED: "Hoàn tất",
    EMPTY: "Không có video đủ điều kiện",
    RATE_LIMITED: "Nền tảng giới hạn",
    PARTIAL: "Cần kiểm tra",
    PAUSED: "Tạm dừng",
    BUSY: "Đang có lượt đồng bộ",
    EXPIRED: "Hết 30 ngày",
    DAILY_LIMIT: "Đã đủ 5 video hôm nay",
    FAILED: "Đồng bộ lỗi",
    INTERRUPTED: "Lượt chạy bị gián đoạn",
  })[String(v)] || String(v || "—");
const emptySource = {
  id: undefined as string | undefined,
  provider: "TIKTOK" as SocialProvider,
  source_url: "",
  creator_name: "",
  authorization_status: "PENDING",
  permission_evidence: "",
  sync_enabled: true,
  confirm_rights: false,
};
export function SocialShortsAdmin({ initial }: { initial: SocialAdminData }) {
  const [data, setData] = useState(initial),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [source, setSource] = useState(emptySource),
    [sourceOpen, setSourceOpen] = useState(false),
    [sourceId, setSourceId] = useState(String(initial.sources[0]?.id || "")),
    [urls, setUrls] = useState(""),
    [preview, setPreview] = useState<Row | null>(null);
  const [title, setTitle] = useState(""),
    [creator, setCreator] = useState(""),
    [evidence, setEvidence] = useState(""),
    [rights, setRights] = useState(false),
    [embedConfirmed, setEmbedConfirmed] = useState(false);
  const flight = useRef(false);
  async function reload(page = data.page) {
    setData(await requestJson<SocialAdminData>(`/api/admin/shorts/social?page=${page}`));
  }
  async function action(action: string, input?: unknown) {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    setMessage("");
    try {
      const result = await requestJson<Record<string, unknown>>("/api/admin/shorts/social", {
        method: "POST",
        body: JSON.stringify({ action, input }),
      });
      await reload();
      if (action === "SOURCE") {
        setSourceOpen(false);
        setSource(emptySource);
        if (!sourceId && result.id) setSourceId(String(result.id));
      }
      if (action === "IMPORT") {
        setUrls("");
        setMessage(`Đã thêm ${result.added} URL · Trùng ${result.duplicates}.`);
      } else if (action === "SYNC")
        setMessage(
          `${label(result.status)} · ${result.added} video mới · ${result.checked} đã kiểm tra.`,
        );
      else if (action === "CHECK")
        setMessage(
          result.error
            ? socialErrorLabel(String(result.error))
            : "Đã kiểm tra metadata chính thức.",
        );
      else {
        setMessage(action === "REVIEW" ? "Đã cập nhật trạng thái video." : "Đã lưu.");
        if (action === "REVIEW") setPreview(null);
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Chưa thực hiện được. Thử lại sau.");
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }
  function openPreview(row: Row) {
    setPreview(row);
    setTitle(row.title === String(row.original_url).slice(0, 160) ? "" : String(row.title));
    setCreator(String(row.creator_name || ""));
    setEvidence(String(row.permission_evidence || ""));
    setRights(false);
    setEmbedConfirmed(false);
  }
  let previewUrl: string | null = null;
  if (preview)
    try {
      previewUrl = parseSocialVideo(String(preview.original_url)).embedUrl;
    } catch {}
  const total = Number(data.stats.total),
    last = data.runs[0];
  return (
    <div className="social-shorts-admin">
      <DashboardHeading
        title="Phim ngắn"
        description="Nhập URL được phép sử dụng · Tự xử lý và xuất bản mỗi ngày."
        action={
          <button className="button primary" disabled={busy} onClick={() => void action("SYNC")}>
            <RefreshCw size={17} />
            {busy ? "Đang xử lý…" : "Đồng bộ"}
          </button>
        }
      />
      <div className="admin-content-tabs">
        <Link href="/admin/videos">Kho phim</Link>
        <Link href="/admin/shorts" aria-current="page">
          TikTok / Facebook
        </Link>
        <Link href="/admin/shorts?mode=managed">Video tự quản</Link>
      </div>
      <div className="finance-context-grid">
        <article>
          <span>Đã xuất bản</span>
          <strong>{Number(data.stats.published)}</strong>
        </article>
        <article>
          <span>Thêm hôm nay</span>
          <strong>{Number(data.stats.today)} / 5</strong>
        </article>
        <article>
          <span>Đang chờ</span>
          <strong>{Number(data.stats.pending)}</strong>
        </article>
        <article>
          <span>Đồng bộ gần nhất</span>
          <strong className="social-run-status">{last ? label(last.status) : "Chưa chạy"}</strong>
          <small>{stamp(last?.started_at)}</small>
        </article>
      </div>
      {message ? (
        <p className="admin-notice" role="status">
          {message}
        </p>
      ) : null}
      <section className="dashboard-panel social-sync-settings">
        <div>
          <h2>Lịch xuất bản</h2>
          <p>Mỗi ngày khoảng 08:00 (giờ Việt Nam) · Kết thúc {stamp(data.control.ends_at)}.</p>
          <p>Chế độ nhập URL, không tự tìm video. Chỉ xuất bản nguồn và video đã xác minh quyền.</p>
        </div>
        <label>
          Video mỗi lượt
          <select
            aria-label="Mục tiêu video mỗi ngày"
            value={Number(data.control.daily_target)}
            disabled={busy}
            onChange={(e) =>
              void action("SETTINGS", {
                enabled: Boolean(data.control.enabled),
                daily_target: Number(e.target.value),
              })
            }
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n} video
              </option>
            ))}
          </select>
        </label>
        <button
          className="button secondary"
          disabled={busy}
          onClick={() =>
            void action("SETTINGS", {
              enabled: !data.control.enabled,
              daily_target: Number(data.control.daily_target),
            })
          }
        >
          {data.control.enabled ? "Tạm dừng đồng bộ" : "Bật đồng bộ"}
        </button>
      </section>
      <section className="dashboard-panel">
        <div className="dashboard-panel-heading">
          <div>
            <h2>Nguồn nội dung</h2>
            <p>
              Chỉ đánh dấu xác minh khi có quyền phù hợp với CineVjet, bao gồm mục đích thương mại.
            </p>
          </div>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => {
              setSource(emptySource);
              setSourceOpen(true);
            }}
          >
            <Plus size={16} />
            Thêm nguồn
          </button>
        </div>
        <div className="social-source-list">
          {data.sources.length ? (
            data.sources.map((s) => (
              <article key={String(s.id)}>
                <div>
                  <strong>{String(s.creator_name)}</strong>
                  <small>
                    {String(s.provider)} · {label(s.authorization_status)} ·{" "}
                    {s.sync_enabled ? "Đang bật" : "Tạm dừng"}
                  </small>
                  <a href={String(s.source_url)} target="_blank" rel="noreferrer">
                    {String(s.source_url)}
                  </a>
                  <small>
                    Kiểm tra: {stamp(s.last_synced_at)}{" "}
                    {socialErrorLabel(s.last_error as string | null)}
                  </small>
                </div>
                <div className="admin-actions">
                  <button
                    disabled={busy}
                    onClick={() => {
                      setSource({
                        id: String(s.id),
                        provider: s.provider as SocialProvider,
                        source_url: String(s.source_url),
                        creator_name: String(s.creator_name),
                        authorization_status: String(s.authorization_status),
                        permission_evidence: String(s.permission_evidence),
                        sync_enabled: Boolean(s.sync_enabled),
                        confirm_rights: false,
                      });
                      setSourceOpen(true);
                    }}
                  >
                    Sửa / quyền
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void action("SOURCE", {
                        id: s.id,
                        provider: s.provider,
                        source_url: s.source_url,
                        creator_name: s.creator_name,
                        authorization_status: s.authorization_status,
                        permission_evidence: s.permission_evidence,
                        sync_enabled: !s.sync_enabled,
                        confirm_rights: s.authorization_status === "VERIFIED",
                      })
                    }
                  >
                    {s.sync_enabled ? "Tắt nguồn" : "Bật nguồn"}
                  </button>
                </div>
              </article>
            ))
          ) : (
            <p className="social-empty">
              Chưa có nguồn được cung cấp. Thêm tác giả và căn cứ quyền sử dụng trước.
            </p>
          )}
        </div>
      </section>
      <section className="dashboard-panel social-import-panel">
        <h2>Thêm URL video</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void action("IMPORT", {
              source_id: sourceId,
              urls: urls.split(/[\s,]+/).filter(Boolean),
            });
          }}
        >
          <label>
            Nguồn
            <select required value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
              <option value="">Chọn tác giả</option>
              {data.sources.map((s) => (
                <option key={String(s.id)} value={String(s.id)}>
                  {String(s.creator_name)} · {String(s.provider)}
                </option>
              ))}
            </select>
          </label>
          <label>
            URL video gốc · mỗi dòng một URL, tối đa 30
            <textarea
              required
              maxLength={6000}
              rows={4}
              value={urls}
              onChange={(e) => setUrls(e.target.value)}
              placeholder="https://www.tiktok.com/@tacgia/video/..."
            />
          </label>
          <button className="button primary" disabled={busy || !data.sources.length}>
            Đưa vào hàng chờ duyệt
          </button>
        </form>
      </section>
      <section className="dashboard-panel">
        <div className="dashboard-panel-heading">
          <div>
            <h2>Video và hàng chờ</h2>
            <p>
              TikTok: kiểm tra metadata trước khi duyệt. Facebook: kiểm tra trực tiếp preview, xác
              nhận có hiệu lực 48 giờ trước khi xuất bản.
            </p>
          </div>
          <button className="button secondary" disabled={busy} onClick={() => void reload()}>
            Tải lại
          </button>
        </div>
        <div className="dashboard-table-wrap">
          <table className="dashboard-table">
            <thead>
              <tr>
                <th>Video / tác giả</th>
                <th>Quyền / nhúng</th>
                <th>Trạng thái</th>
                <th>Kiểm tra gần nhất</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((v) => (
                <tr key={String(v.id)}>
                  <td className="social-video-title">
                    <strong>{String(v.title)}</strong>
                    <small>
                      {String(v.provider)} · {String(v.creator_name)} ·{" "}
                      {String(v.provider_video_id)}
                    </small>
                    <a href={String(v.original_url)} target="_blank" rel="noreferrer">
                      Video gốc
                    </a>
                  </td>
                  <td>
                    {label(v.permission_status)}
                    <small>{label(v.embed_status)}</small>
                    <small>{socialErrorLabel(v.last_error as string | null)}</small>
                  </td>
                  <td>{label(v.publish_status)}</td>
                  <td>
                    {stamp(v.last_checked_at)}
                    <small>{v.published_at ? `Xuất bản ${stamp(v.published_at)}` : ""}</small>
                  </td>
                  <td>
                    <div className="admin-actions">
                      <button disabled={busy} onClick={() => void action("CHECK", { id: v.id })}>
                        Metadata
                      </button>
                      <button disabled={busy} onClick={() => openPreview(v)}>
                        <Eye size={14} />
                        Preview / duyệt
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => void action("REVIEW", { id: v.id, decision: "HIDE" })}
                      >
                        Ẩn
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.items.length ? (
            <p className="social-empty">
              Chưa có URL video. Video chưa duyệt sẽ không hiển thị cho người xem.
            </p>
          ) : null}
        </div>
        <nav className="admin-pagination" aria-label="Phân trang video ngắn">
          <button disabled={busy || data.page <= 1} onClick={() => void reload(data.page - 1)}>
            ‹
          </button>
          <span>
            Trang {data.page} · {total} video
          </span>
          <button
            disabled={busy || data.page * 25 >= total}
            onClick={() => void reload(data.page + 1)}
          >
            ›
          </button>
        </nav>
      </section>
      <section className="dashboard-panel">
        <div className="dashboard-panel-heading">
          <h2>Lịch sử đồng bộ</h2>
        </div>
        <div className="social-run-list">
          {data.runs.length ? (
            data.runs.map((r) => (
              <p key={String(r.id)}>
                <strong>{label(r.status)}</strong> · {stamp(r.started_at)} · Kiểm tra{" "}
                {Number(r.candidates_checked)} · Thêm {Number(r.videos_added)} · Bỏ qua{" "}
                {Number(r.videos_skipped)} {socialErrorLabel(r.error_summary as string | null)}
              </p>
            ))
          ) : (
            <p>Chưa có lượt đồng bộ.</p>
          )}
        </div>
      </section>
      {sourceOpen ? (
        <Modal
          title={source.id ? "Sửa nguồn và quyền sử dụng" : "Thêm nguồn nội dung"}
          onClose={() => {
            if (!busy) setSourceOpen(false);
          }}
        >
          <form
            className="social-source-form"
            onSubmit={(e) => {
              e.preventDefault();
              void action("SOURCE", source);
            }}
          >
            <label>
              Nền tảng
              <select
                disabled={!!source.id}
                value={source.provider}
                onChange={(e) =>
                  setSource({ ...source, provider: e.target.value as SocialProvider })
                }
              >
                <option value="TIKTOK">TikTok</option>
                <option value="FACEBOOK">Facebook</option>
              </select>
            </label>
            <label>
              Tên tác giả
              <input
                required
                maxLength={100}
                value={source.creator_name}
                onChange={(e) => setSource({ ...source, creator_name: e.target.value })}
              />
            </label>
            <label>
              URL trang tác giả
              <input
                required
                type="url"
                disabled={!!source.id}
                value={source.source_url}
                onChange={(e) => setSource({ ...source, source_url: e.target.value })}
              />
            </label>
            <label>
              Trạng thái quyền
              <select
                value={source.authorization_status}
                onChange={(e) =>
                  setSource({
                    ...source,
                    authorization_status: e.target.value,
                    confirm_rights: false,
                  })
                }
              >
                <option value="PENDING">Chờ xác minh</option>
                <option value="VERIFIED">Đã xác minh</option>
                <option value="REJECTED">Không được phép sử dụng</option>
              </select>
            </label>
            <label>
              Căn cứ cho phép sử dụng
              <textarea
                maxLength={1500}
                required={source.authorization_status === "VERIFIED"}
                minLength={source.authorization_status === "VERIFIED" ? 12 : 0}
                value={source.permission_evidence}
                onChange={(e) => setSource({ ...source, permission_evidence: e.target.value })}
              />
            </label>
            {source.authorization_status === "VERIFIED" ? (
              <label className="social-check">
                <input
                  type="checkbox"
                  required
                  checked={source.confirm_rights}
                  onChange={(e) => setSource({ ...source, confirm_rights: e.target.checked })}
                />
                Tôi đã xác minh quyền hiển thị nội dung trên CineVjet, gồm mục đích thương mại. URL
                công khai không tự tạo quyền này.
              </label>
            ) : null}
            <button className="button primary wide" disabled={busy}>
              Lưu nguồn
            </button>
          </form>
        </Modal>
      ) : null}
      {preview ? (
        <Modal
          title="Preview và duyệt video"
          onClose={() => {
            if (!busy) setPreview(null);
          }}
        >
          <div className="social-admin-preview">
            {previewUrl ? (
              <iframe
                title="Preview trình phát chính thức"
                src={previewUrl}
                allow="fullscreen; picture-in-picture; encrypted-media"
                sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation allow-top-navigation-by-user-activation"
                allowFullScreen
              />
            ) : (
              <p>URL không hợp lệ.</p>
            )}
          </div>
          <p>
            <a href={String(preview.original_url)} target="_blank" rel="noreferrer">
              Mở video gốc
            </a>{" "}
            · {label(preview.embed_status)}
          </p>
          <form
            className="social-source-form"
            onSubmit={(e) => {
              e.preventDefault();
              void action("REVIEW", {
                id: preview.id,
                decision: "APPROVE",
                title,
                creator_name: creator,
                permission_evidence: evidence,
                confirm_rights: rights,
                embed_confirmed: embedConfirmed,
              });
            }}
          >
            <label>
              Tiêu đề video
              <input
                required
                maxLength={160}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label>
              Tác giả
              <input
                required
                maxLength={100}
                value={creator}
                onChange={(e) => setCreator(e.target.value)}
              />
            </label>
            <label>
              Căn cứ quyền sử dụng video
              <textarea
                required
                minLength={12}
                maxLength={1500}
                value={evidence}
                onChange={(e) => setEvidence(e.target.value)}
              />
            </label>
            <label className="social-check">
              <input
                type="checkbox"
                required
                checked={rights}
                onChange={(e) => setRights(e.target.checked)}
              />
              Tôi đã kiểm tra quyền sử dụng video phù hợp với CineVjet, không chỉ dựa vào URL công
              khai.
            </label>
            {preview.provider === "FACEBOOK" ? (
              <label className="social-check">
                <input
                  type="checkbox"
                  required
                  checked={embedConfirmed}
                  onChange={(e) => setEmbedConfirmed(e.target.checked)}
                />
                Tôi đã xem video công khai phát được trong trình nhúng Facebook chính thức.
              </label>
            ) : null}
            <button className="button primary wide" disabled={busy}>
              Duyệt và xếp lịch xuất bản
            </button>
            <button
              type="button"
              className="button secondary wide"
              disabled={busy}
              onClick={() => void action("REVIEW", { id: preview.id, decision: "REJECT" })}
            >
              Từ chối video
            </button>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
