import type { User, WatchProgress } from "@/domain/models";
export interface UiSnapshot {
  favorites: string[];
  progress: WatchProgress[];
  user: User | null;
  rememberUser: boolean;
}
const key = "cinema:ui:v1";
const sessionKey = "cinema:session:v1";
function validUser(user: unknown): user is User | null {
  return (
    user === null ||
    (!!user &&
      typeof user === "object" &&
      "email" in user &&
      "username" in user &&
      typeof user.email === "string" &&
      typeof user.username === "string")
  );
}
export function readUiSnapshot(fallback: UiSnapshot): UiSnapshot {
  const snapshot = { ...fallback };
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? "null");
    if (raw?.version === 1) {
      if (Array.isArray(raw.favorites))
        snapshot.favorites = raw.favorites.filter((id: unknown) => typeof id === "string");
      if (Array.isArray(raw.progress))
        snapshot.progress = raw.progress.filter(
          (p: WatchProgress) =>
            p &&
            typeof p.movie_id === "string" &&
            Number.isFinite(p.position_seconds) &&
            p.position_seconds >= 0 &&
            Number.isFinite(p.duration_seconds) &&
            p.duration_seconds > 0,
        );
      if (validUser(raw.user)) snapshot.user = raw.user;
      snapshot.rememberUser = raw.rememberUser !== false;
    }
    const session = JSON.parse(sessionStorage.getItem(sessionKey) ?? "null");
    if (session?.version === 1 && validUser(session.user)) {
      snapshot.user = session.user;
      snapshot.rememberUser = false;
    }
  } catch {
    /* An unavailable or corrupt browser store does not block the interface. */
  }
  return snapshot;
}
export function writeUiSnapshot(snapshot: UiSnapshot): void {
  try {
    localStorage.setItem(
      key,
      JSON.stringify({
        version: 1,
        favorites: snapshot.favorites,
        progress: snapshot.progress,
        user: snapshot.rememberUser ? snapshot.user : null,
        rememberUser: snapshot.rememberUser,
      }),
    );
    if (snapshot.rememberUser) sessionStorage.removeItem(sessionKey);
    else sessionStorage.setItem(sessionKey, JSON.stringify({ version: 1, user: snapshot.user }));
  } catch {
    /* UI remains usable when storage is full or disabled. */
  }
}
