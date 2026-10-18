import Link from "next/link";
import { protectPage } from "@/server/auth";
import { assertAdmin } from "@/server/admin-core";
import { ApiError } from "@/server/http";
import { adminShortsList } from "@/server/shorts";
import { ShortsAdmin } from "@/features/admin/shorts-admin";
import { SocialShortsAdmin } from "@/features/admin/social-shorts-admin";
import { socialShortsAdmin } from "@/server/social-shorts";
import "@/features/admin/shorts-admin.css";
export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · Phim ngắn" };
export default async function Page({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const user = await protectPage();
  try {
    await assertAdmin(user.id);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403)
      return (
        <div className="content">
          <h1>Không có quyền quản trị</h1>
          <p>Tài khoản này chưa được cấp quyền quản lý Phim ngắn.</p>
          <Link href="/profile" className="button">
            Về Của tôi
          </Link>
        </div>
      );
    throw e;
  }
  if ((await searchParams).mode !== "managed")
    return <SocialShortsAdmin initial={await socialShortsAdmin(user.id)} />;
  return (
    <ShortsAdmin
      initial={await adminShortsList()}
      userId={user.id}
      uploadReady={!!process.env.BLOB_READ_WRITE_TOKEN}
    />
  );
}
