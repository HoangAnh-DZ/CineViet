"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Entitlement, Movie, User, WatchProgress } from "@/domain/models";
import { requestJson } from "@/services/client";
interface AccountState {
  savedShortIds: string[];
  user: User | null;
  favoriteMovies: Movie[];
  progress: WatchProgress[];
  balance: { cash: number; available: number; coins: number };
  entitlements: Entitlement[];
}
interface AppState extends AccountState {
  refreshAccount: () => Promise<void>;
  toggleSavedShort: (id: string) => Promise<void>;
  favorites: string[];
  toggleFavorite: (id: string) => void;
  saveProgress: (p: WatchProgress) => void;
  setUser: (user: User | null, remember?: boolean) => void;
  toast: (s: string) => void;
  hydrated: boolean;
}
const empty: AccountState = {
  savedShortIds: [],
  user: null,
  favoriteMovies: [],
  progress: [],
  balance: { cash: 0, available: 0, coins: 0 },
  entitlements: [],
};
const Context = createContext<AppState | null>(null);
export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AccountState>(empty),
    [hydrated, setHydrated] = useState(false),
    [message, setMessage] = useState("");
  const stateRef = useRef(state);
  stateRef.current = state;
  const version = useRef(0),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    busy = useRef(new Set<string>());
  const toast = useCallback((value: string) => {
    setMessage(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(""), 3500);
  }, []);
  const refresh = useCallback(async () => {
    const expected = version.current;
    try {
      const next = await requestJson<AccountState>("/api/account");
      if (expected === version.current) setState(next);
    } catch (e) {
      if (expected === version.current) toast((e as Error).message);
    } finally {
      if (expected === version.current) setHydrated(true);
    }
  }, [toast]);
  useEffect(() => {
    void refresh();
    return () => {
      version.current++;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [refresh]);
  const setUser = useCallback(
    (user: User | null) => {
      version.current++;
      setState({ ...empty, user });
      setHydrated(!user);
      if (user) void refresh();
    },
    [refresh],
  );
  const toggleFavorite = useCallback(
    async (id: string) => {
      if (!stateRef.current.user) {
        toast("Đăng nhập để lưu phim yêu thích.");
        return;
      }
      if (busy.current.has(id)) return;
      busy.current.add(id);
      const expected = version.current,
        active = !stateRef.current.favoriteMovies.some((m) => m.id === id);
      try {
        await requestJson("/api/favorites", {
          method: "PUT",
          body: JSON.stringify({ movie_id: id, active }),
        });
        if (expected === version.current) {
          await refresh();
          toast(active ? "Đã thêm vào yêu thích" : "Đã bỏ khỏi yêu thích");
        }
      } catch (e) {
        toast((e as Error).message);
      } finally {
        busy.current.delete(id);
      }
    },
    [refresh, toast],
  );
  const toggleSavedShort = useCallback(
    async (id: string) => {
      if (!stateRef.current.user) {
        toast("Đăng nhập để lưu video vào Danh sách.");
        return;
      }
      const key = "short:" + id;
      if (busy.current.has(key)) return;
      busy.current.add(key);
      const expected = version.current,
        saved = !stateRef.current.savedShortIds.includes(id);
      try {
        await requestJson(`/api/library/shorts/${encodeURIComponent(id)}`, {
          method: "PUT",
          body: JSON.stringify({ saved }),
        });
        if (expected === version.current) {
          await refresh();
          toast(saved ? "Đã lưu vào Danh sách" : "Đã bỏ lưu video");
        }
      } catch (e) {
        toast((e as Error).message);
      } finally {
        busy.current.delete(key);
      }
    },
    [refresh, toast],
  );
  const saveProgress = useCallback(
    async (item: WatchProgress) => {
      if (!stateRef.current.user) return;
      const expected = version.current;
      try {
        await requestJson("/api/progress", {
          method: "PUT",
          keepalive: true,
          body: JSON.stringify({
            movie_id: item.movie_id,
            episode_id: item.episode_id,
            position_seconds: item.position_seconds,
            duration_seconds: item.duration_seconds,
          }),
        });
        if (expected === version.current)
          setState((previous) => ({
            ...previous,
            progress: [
              {
                ...item,
                user_id: previous.user!.id,
                completed: item.position_seconds >= item.duration_seconds * 0.95,
              },
              ...previous.progress.filter(
                (p) => p.movie_id !== item.movie_id || p.episode_id !== item.episode_id,
              ),
            ],
          }));
      } catch (e) {
        toast((e as Error).message);
      }
    },
    [toast],
  );
  return (
    <Context.Provider
      value={{
        ...state,
        favorites: state.favoriteMovies.map((m) => m.id),
        toggleFavorite,
        toggleSavedShort,
        refreshAccount: refresh,
        saveProgress,
        setUser,
        toast,
        hydrated,
      }}
    >
      {children}
      {message ? (
        <div className="toast" role="status">
          {message}
        </div>
      ) : null}
    </Context.Provider>
  );
}
export function useApp() {
  const value = useContext(Context);
  if (!value) throw new Error("AppProvider is required");
  return value;
}
