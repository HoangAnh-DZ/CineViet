"use client";
export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="empty-state">
      <h1>Không thể tải nội dung</h1>
      <p>Vui lòng thử lại sau ít phút.</p>
      <button onClick={reset} className="button primary">
        Thử lại
      </button>
    </div>
  );
}
