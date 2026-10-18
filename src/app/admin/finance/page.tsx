import { redirect } from "next/navigation";
import { protectAdminPage } from "@/server/admin";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await protectAdminPage();
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (Array.isArray(value)) value.forEach((v) => query.append(key, v));
    else if (value !== undefined) query.set(key, value);
  }
  redirect("/admin" + (query.size ? "?" + query.toString() : ""));
}
