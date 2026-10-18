"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Plus, Clapperboard } from "lucide-react";
import { DashboardHeading } from "./dashboard-screen";
import { upload } from "@vercel/blob/client";
import { Modal } from "@/components/ui";
import { requestJson } from "@/services/client";
import { validUpload, shortInput, type ShortInput } from "@/domain/short-validation";
import type { AdminShort } from "@/domain/shorts";
type Batch = { items: AdminShort[]; nextCursor: number | null };
type Options = {
  movies: { id: string; title: string; poster_url: string }[];
  episodes: { id: string; title: string; episode_number: number; season_number: number }[];
};
const empty: ShortInput = {
  title: "",
  description: "",
  creator_name: null,
  movie_id: null,
  episode_id: null,
  video_url: "",
  thumbnail_url: null,
  duration_seconds: null,
  hashtags: [],
  display_order: 0,
  is_active: true,
  source_type: "EXTERNAL",
};
function inputFrom(item: AdminShort): ShortInput {
  if(item.source_type==='EMBED')throw new Error("Dùng quản lý URL nhúng.");
  return {
    title: item.title,
    description: item.description,
    creator_name: item.creator_name,
    movie_id: item.movie_id,
    episode_id: item.episode_id,
    video_url: item.video_url,
    thumbnail_url: item.stored_thumbnail_url,
    duration_seconds: item.duration_seconds,
    hashtags: item.hashtags,
    display_order: item.display_order,
    is_active: item.is_active,
    source_type: item.source_type,
  };
}
function message(e: unknown) {
  return e instanceof Error ? e.message : "Chưa thực hiện được. Vui lòng thử lại.";
}
export function ShortsAdmin({
  initial,
  userId,
  uploadReady,
}: {
  initial: Batch;
  userId: string;
  uploadReady: boolean;
}) {
  const [batch, setBatch] = useState(initial),
    [editor, setEditor] = useState<AdminShort | "new" | null>(null),
    [preview, setPreview] = useState<AdminShort | null>(null),
    [deleting, setDeleting] = useState<AdminShort | null>(null);
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  async function reload() {
    setBatch(await requestJson<Batch>("/api/admin/shorts"));
  }
  async function action(run: () => Promise<unknown>, success: string) {
    setBusy(true);
    setNotice("");
    try {
      await run();
      await reload();
      setNotice(success);
      setDeleting(null);
    } catch (e) {
      setNotice(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="shorts-admin">
      <DashboardHeading title="Quản lý phim ngắn" description="Video ngắn, nguồn phát và thứ tự hiển thị." action={<button className="button primary" onClick={() => setEditor("new")}><Plus size={17} />Thêm video</button>} />
      <div className="admin-content-tabs">
        <Link href="/admin/videos"><Clapperboard size={17} />Kho phim</Link>
        <Link href="/admin/shorts">TikTok / Facebook</Link>
        <Link href="/admin/shorts?mode=managed" aria-current="page">Video tự quản</Link>
      </div>
      {notice ? (
        <p role="status" className="admin-notice">
          {notice}
        </p>
      ) : null}
      <div className="admin-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Video</th>
              <th>Phim / thời lượng</th>
              <th>Nguồn</th>
              <th>Trạng thái</th>
              <th>Thứ tự</th>
              <th>Ngày tạo</th>
              <th>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {batch.items.map((item) => (
              <tr key={item.id}>
                <td>
                  <div className="admin-video-title">
                    {item.thumbnail_url ? (
                      <img src={item.thumbnail_url} alt="" loading="lazy" />
                    ) : (
                      <span className="admin-thumb-empty">▶</span>
                    )}
                    <strong>{item.title}</strong>
                  </div>
                </td>
                <td>
                  {item.movie_title || "Không liên kết"}
                  <small>
                    {item.duration_seconds ? `${item.duration_seconds} giây` : "Chưa có thời lượng"}
                  </small>
                </td>
                <td>
                  {item.source_type === "UPLOAD"
                    ? "Upload"
                    : item.source_type === "DEMO"
                      ? "Demo · CC BY 3.0"
                      : "URL"}
                </td>
                <td>
                  <span className={item.is_active ? "admin-active" : "admin-inactive"}>
                    {item.is_active ? "Đang hiển thị" : "Đang ẩn"}
                  </span>
                </td>
                <td>{item.display_order}</td>
                <td>{new Date(item.created_at).toISOString().slice(0, 10)}</td>
                <td>
                  <div className="admin-actions">
                    <button onClick={() => setEditor(item)}>Sửa</button>
                    <button onClick={() => setPreview(item)}>Preview</button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void action(
                          () =>
                            requestJson(`/api/admin/shorts/${encodeURIComponent(item.id)}`, {
                              method: "PATCH",
                              body: JSON.stringify({ is_active: !item.is_active }),
                            }),
                          "Đã cập nhật trạng thái.",
                        )
                      }
                    >
                      {item.is_active ? "Ẩn" : "Hiện"}
                    </button>
                    <button
                      className="admin-danger"
                      disabled={busy}
                      onClick={() => setDeleting(item)}
                    >
                      Xóa
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!batch.items.length ? <p>Chưa có video. Thêm video đầu tiên.</p> : null}
      </div>
      {batch.nextCursor !== null ? (
        <button
          className="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const next = await requestJson<Batch>(`/api/admin/shorts?cursor=${batch.nextCursor}`);
              setBatch((b) => ({
                items: [...b.items, ...next.items],
                nextCursor: next.nextCursor,
              }));
            } catch (e) {
              setNotice(message(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Tải thêm
        </button>
      ) : null}
      {editor ? (
        <ShortEditor
          key={editor === "new" ? "new" : editor.id}
          item={editor === "new" ? undefined : editor}
          userId={userId}
          uploadReady={uploadReady}
          onClose={() => setEditor(null)}
          onSaved={async () => {
            await reload();
            setEditor(null);
            setNotice("Đã lưu video. Feed sử dụng dữ liệu DB vừa cập nhật.");
          }}
        />
      ) : null}
      {preview ? (
        <Modal title={preview.title} onClose={() => setPreview(null)}>
          <video
            className="admin-preview"
            src={preview.video_url}
            poster={preview.thumbnail_url || undefined}
            playsInline
            controls
            muted
            preload="metadata"
          />
          <p>{preview.description}</p>
          {preview.movie_slug ? (
            <Link href={`/movie/${preview.movie_slug}`}>Xem phim đầy đủ →</Link>
          ) : null}
        </Modal>
      ) : null}
      {deleting ? (
        <Modal title="Xóa video khỏi feed?" onClose={() => setDeleting(null)}>
          <p>
            “{deleting.title}” sẽ được lưu trữ và ẩn khỏi danh sách. File và các liên kết được giữ
            lại.
          </p>
          <button
            className="button primary"
            disabled={busy}
            onClick={() =>
              void action(
                () =>
                  requestJson(`/api/admin/shorts/${encodeURIComponent(deleting.id)}`, {
                    method: "DELETE",
                  }),
                "Đã lưu trữ video.",
              )
            }
          >
            Xác nhận xóa
          </button>
        </Modal>
      ) : null}
    </div>
  );
}
function ShortEditor({
  item,
  userId,
  uploadReady,
  onClose,
  onSaved,
}: {
  item?: AdminShort;
  userId: string;
  uploadReady: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState<ShortInput>(() => (item ? inputFrom(item) : { ...empty })),
    [tags, setTags] = useState(item?.hashtags.join(" ") || ""),
    [query, setQuery] = useState(""),
    [options, setOptions] = useState<Options>({ movies: [], episodes: [] }),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false),
    [progress, setProgress] = useState(""),
    [localVideo, setLocalVideo] = useState("");
  const localRef = useRef("");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (localRef.current) URL.revokeObjectURL(localRef.current);
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void requestJson<Options>(
        `/api/admin/shorts/movies?q=${encodeURIComponent(query)}&movie=${encodeURIComponent(form.movie_id || "")}`,
        { signal: controller.signal },
      )
        .then(setOptions)
        .catch((e) => {
          if (!controller.signal.aborted) setError(message(e));
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, form.movie_id]);
  function change<K extends keyof ShortInput>(key: K, value: ShortInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }
  async function uploadFile(file: File, kind: "video" | "thumbnail") {
    setError("");
    if (!validUpload(kind, file.name, file.type, file.size)) {
      setError(
        "Chỉ nhận MP4/WebM hoặc ảnh JPG/PNG/WebP đúng định dạng; file phải lớn hơn 0 và không vượt 5 TB.",
      );
      return;
    }
    if (kind === "video") {
      change("duration_seconds", null);
      if (localRef.current) URL.revokeObjectURL(localRef.current);
      localRef.current = URL.createObjectURL(file);
      setLocalVideo(localRef.current);
    }
    setUploading(true);
    setProgress("Đang tải file…");
    try {
      const path = `shorts/${userId}/${kind}/${crypto.randomUUID()}.${file.name.toLowerCase().split(".").pop()}`;
      const blob = await upload(path, file, {
        access: "public",
        handleUploadUrl: "/api/admin/shorts/uploads",
        multipart: true,
        contentType: file.type,
        clientPayload: JSON.stringify({ kind, name: file.name, type: file.type, size: file.size }),
        onUploadProgress: (e) => {
          if (mounted.current) setProgress(`Đang tải ${Math.round(e.percentage)}%`);
        },
      });
      await requestJson("/api/admin/shorts/uploads/complete", {
        method: "POST",
        body: JSON.stringify({ url: blob.url, kind }),
      });
      if (mounted.current) {
        setForm((f) =>
          kind === "video"
            ? { ...f, video_url: blob.url, source_type: "UPLOAD" }
            : { ...f, thumbnail_url: blob.url },
        );
        setProgress("Upload và xác thực file thành công.");
      }
    } catch (e) {
      if (mounted.current) {
        setError(message(e));
        setProgress("");
      }
    } finally {
      if (mounted.current) setUploading(false);
    }
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const data = {
      ...form,
      hashtags: tags
        .split(/[\s,]+/)
        .filter(Boolean)
        .map((t) => (t.startsWith("#") ? t : `#${t}`)),
    };
    const parsed = shortInput.safeParse(data);
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    setBusy(true);
    try {
      await requestJson(
        item ? `/api/admin/shorts/${encodeURIComponent(item.id)}` : "/api/admin/shorts",
        { method: item ? "PUT" : "POST", body: JSON.stringify(parsed.data) },
      );
      await onSaved();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  const poster =
    form.thumbnail_url || options.movies.find((m) => m.id === form.movie_id)?.poster_url;
  return (
    <Modal
      title={item ? "Sửa video" : "Thêm video ngắn"}
      onClose={() => {
        if (!uploading && !busy) onClose();
      }}
    >
      <form className="admin-short-form" onSubmit={save}>
        <label>
          Tiêu đề *
          <input
            required
            maxLength={160}
            value={form.title}
            onChange={(e) => change("title", e.target.value)}
          />
        </label>
        <label>
          Mô tả
          <textarea
            rows={3}
            maxLength={2000}
            value={form.description}
            onChange={(e) => change("description", e.target.value)}
          />
        </label>
        <div className="admin-form-row">
          <label>
            Creator name
            <input
              maxLength={100}
              value={form.creator_name || ""}
              onChange={(e) => change("creator_name", e.target.value || null)}
            />
          </label>
          <label>
            Hashtags
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="#hoathinh #khampha"
            />
          </label>
        </div>
        <label>
          Tìm phim
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Nhập tên phim…"
          />
        </label>
        <div className="admin-form-row">
          <label>
            Liên kết phim
            <select
              aria-label="Liên kết phim"
              value={form.movie_id || ""}
              onChange={(e) =>
                setForm((f) => ({ ...f, movie_id: e.target.value || null, episode_id: null }))
              }
            >
              <option value="">Không liên kết</option>
              {options.movies.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Tập phim (tùy chọn)
            <select
              aria-label="Tập phim (tùy chọn)"
              disabled={!form.movie_id}
              value={form.episode_id || ""}
              onChange={(e) => change("episode_id", e.target.value || null)}
            >
              <option value="">Không liên kết tập</option>
              {options.episodes.map((ep) => (
                <option key={ep.id} value={ep.id}>
                  S{ep.season_number} · Tập {ep.episode_number}: {ep.title}
                </option>
              ))}
            </select>
          </label>
        </div>
        <fieldset>
          <legend>Nguồn video</legend>
          <select
            aria-label="Loại nguồn video"
            value={form.source_type}
            disabled={uploading}
            onChange={(e) => change("source_type", e.target.value as ShortInput["source_type"])}
          >
            <option value="EXTERNAL">External URL</option>
            <option value="UPLOAD" disabled={!uploadReady}>
              Upload file
            </option>
            {item?.source_type === "DEMO" ? (
              <option value="DEMO">Demo có bản quyền CC BY 3.0</option>
            ) : null}
          </select>
          {form.source_type === "UPLOAD" ? (
            <>
              <label>
                File video MP4 / WebM
                <input
                  type="file"
                  accept="video/mp4,video/webm,.mp4,.webm"
                  disabled={uploading || !uploadReady}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void uploadFile(f, "video");
                    e.target.value = "";
                  }}
                />
              </label>
              <small>
                Upload trực tiếp qua Blob, hỗ trợ multipart. Giới hạn provider: 5 TB/file. MP4
                H.264/AAC được ưu tiên.
              </small>
            </>
          ) : null}
          {!uploadReady ? <p>Storage chưa sẵn sàng. Bạn có thể lưu video bằng URL HTTPS.</p> : null}
          <label>
            Video URL
            <input
              value={form.video_url}
              readOnly={form.source_type !== "EXTERNAL"}
              placeholder="https://…/video.mp4"
              onChange={(e) => {
                change("video_url", e.target.value);
                setLocalVideo("");
                change("duration_seconds", null);
              }}
            />
          </label>
        </fieldset>
        <fieldset>
          <legend>Thumbnail</legend>
          <label>
            Thumbnail URL
            <input
              value={form.thumbnail_url || ""}
              placeholder="Để trống để dùng poster phim"
              onChange={(e) => change("thumbnail_url", e.target.value || null)}
            />
          </label>
          <label>
            Tải ảnh JPG / PNG / WebP
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
              disabled={uploading || !uploadReady}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadFile(f, "thumbnail");
                e.target.value = "";
              }}
            />
          </label>
          {poster ? (
            <img className="admin-poster-preview" src={poster} alt="Thumbnail preview" />
          ) : null}
        </fieldset>
        {localVideo || form.video_url ? (
          <div>
            <p>Preview video trước khi lưu</p>
            <video
              key={localVideo || form.video_url}
              className="admin-preview"
              src={localVideo || form.video_url}
              poster={poster || undefined}
              controls
              muted
              playsInline
              preload="metadata"
              onLoadedMetadata={(e) => {
                const d = e.currentTarget.duration;
                if (Number.isFinite(d) && d > 0 && d <= 86400)
                  change("duration_seconds", Math.ceil(d));
              }}
              onError={() =>
                setError("Preview chưa phát được video. Kiểm tra URL hoặc codec MP4 H.264/AAC.")
              }
            />
          </div>
        ) : null}
        <div className="admin-form-row">
          <label>
            Thứ tự hiển thị
            <input
              type="number"
              min={-1000000}
              max={1000000}
              value={form.display_order}
              onChange={(e) => change("display_order", Number(e.target.value))}
            />
          </label>
          <label>
            Thời lượng (giây)
            <input
              type="number"
              min={1}
              max={86400}
              value={form.duration_seconds || ""}
              onChange={(e) =>
                change("duration_seconds", e.target.value ? Number(e.target.value) : null)
              }
            />
          </label>
        </div>
        <label className="admin-check">
          <input
            type="checkbox"
            checked={form.is_active}
            onChange={(e) => change("is_active", e.target.checked)}
          />
          Hiển thị trên feed
        </label>
        {progress ? <p role="status">{progress}</p> : null}
        {error ? (
          <p role="alert" className="admin-error">
            {error}
          </p>
        ) : null}
        <button className="button primary" type="submit" disabled={busy || uploading}>
          {busy ? "Đang lưu…" : "Lưu video"}
        </button>
      </form>
    </Modal>
  );
}
