import { deriveEntitlements } from "@/domain/rules";
import { vipPlans } from "@/data/account";
import type { Entitlement, VipSubscription } from "@/domain/models";
export async function getDemoSubscription(): Promise<VipSubscription | null> {
  return null;
}
export async function getEntitlements(): Promise<ReadonlySet<Entitlement>> {
  return deriveEntitlements(await getDemoSubscription(), vipPlans, new Date());
}
