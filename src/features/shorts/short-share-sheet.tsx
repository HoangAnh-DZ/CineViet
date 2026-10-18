"use client";
import { useEffect, useState } from "react";
import { Copy, Share2 } from "lucide-react";
import { Modal } from "@/components/ui";
import { shortHref, type ShortVideo } from "@/domain/shorts";
import { shareShort } from "@/services/shorts";
export function ShortShareSheet({ item, onClose }: { item: ShortVideo; onClose: () => void }) {
  const [url, setUrl] = useState(shortHref(item.id));
  const [canShare, setCanShare] = useState(false);
  const [status, setStatus] = useState("");
  useEffect(() => {
    setUrl(new URL(shortHref(item.id), window.location.origin).href);
    setCanShare(typeof navigator.share === "function");
  }, [item.id]);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setStatus("Đã sao chép liên kết video ngắn.");
    } catch {
      setStatus("Chọn liên kết bên dưới để sao chép.");
    }
  }
  async function share() {
    try {
      const result = await shareShort(item, {
        origin: window.location.origin,
        share: (data) => navigator.share(data),
        copy: (text) => navigator.clipboard.writeText(text),
      });
      setStatus(
        result === "copied"
          ? "Đã sao chép liên kết video ngắn."
          : result === "shared"
            ? "Đã chia sẻ video."
            : "",
      );
    } catch {
      setStatus("Chọn Sao chép liên kết để chia sẻ video.");
    }
  }
  return (
    <Modal title="Chia sẻ video" onClose={onClose}>
      <p>{item.title}</p>
      <label className="field-label" htmlFor="short-share-url">
        Liên kết video ngắn
      </label>
      <input
        id="short-share-url"
        className="field"
        value={url}
        readOnly
        onFocus={(event) => event.currentTarget.select()}
      />
      <div className="short-share-actions">
        {canShare ? (
          <button className="button primary" onClick={share}>
            <Share2 size={18} />
            Chia sẻ qua ứng dụng
          </button>
        ) : null}
        <button className="button secondary" onClick={copy}>
          <Copy size={18} />
          Sao chép liên kết
        </button>
      </div>
      <p className="short-share-status" role="status">
        {status}
      </p>
    </Modal>
  );
}
