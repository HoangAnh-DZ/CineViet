import { protectPage } from "@/server/auth";
import { Suspense } from "react";
import { ProfileScreen } from "@/features/profile/profile-screen";
import { LoadingScreen } from "@/components/ui";
export const metadata = { title: "Cá nhân" };
export default async function Page() {
  await protectPage();
  return (
    <Suspense fallback={<LoadingScreen />}>
      <ProfileScreen />
    </Suspense>
  );
}
