import Link from "next/link";
export default function NotFound() {
  return (
    <div className="empty-state">
      <h1>Không tìm thấy trang</h1>
      <p>Phim hoặc trang này hiện không có trong thư viện.</p>
      <Link href="/" className="button primary">
        Về Home
      </Link>
    </div>
  );
}
