"use client";

import { useEffect, useState } from "react";
import {
  Check,
  CheckCircle2,
  Coins,
  Copy,
  Gift,
  Hourglass,
  RefreshCw,
  Search,
  Ticket,
} from "lucide-react";
import { requestJson } from "@/services/client";
import styles from "./reward-codes.module.css";

type RewardCode = {
  id: string;
  code_last4: string;
  reward_coins: number;
  max_redemptions: number;
  redeemed_count: number;
  expires_at: string | null;
  created_at: string;
};
type CreatedCode = {
  id: string;
  code: string;
  reward_coins: number;
  max_redemptions: number;
  expires_at: string | null;
};
type CodeStatus = "active" | "expired" | "exhausted";
const statusLabels: Record<CodeStatus, string> = {
  active: "Đang hoạt động",
  expired: "Đã hết hạn",
  exhausted: "Đã hết lượt",
};
const formatCount = (value: number) => value.toLocaleString("vi-VN");
function statusOf(code: RewardCode, now: number): CodeStatus {
  if (code.expires_at && new Date(code.expires_at).getTime() <= now) return "expired";
  return code.redeemed_count >= code.max_redemptions ? "exhausted" : "active";
}
function formatDate(value: string | null) {
  if (!value) return "Không hết hạn";
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(new Date(value));
}

export function RewardCodesScreen() {
  const [items, setItems] = useState<RewardCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [method, setMethod] = useState("automatic");
  const [customCode, setCustomCode] = useState("");
  const [coins, setCoins] = useState("100");
  const [limit, setLimit] = useState("1");
  const [expiry, setExpiry] = useState("");
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<CreatedCode | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    requestJson<{ items: RewardCode[] }>("/api/admin/reward-codes", {
      signal: controller.signal,
    }).then(
      (result) => {
        if (!controller.signal.aborted) {
          setItems(result.items);
          setLoading(false);
        }
      },
      (reason) => {
        if (!controller.signal.aborted) {
          setLoadError(reason instanceof Error ? reason.message : "Không tải được danh sách mã.");
          setLoading(false);
        }
      },
    );
    return () => controller.abort();
  }, []);

  async function refresh() {
    setLoading(true);
    setLoadError("");
    try {
      setItems((await requestJson<{ items: RewardCode[] }>("/api/admin/reward-codes")).items);
    } catch (reason) {
      setLoadError(reason instanceof Error ? reason.message : "Không tải được danh sách mã.");
    } finally {
      setLoading(false);
    }
  }
  async function createCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setCopyError("");
    setCopied(false);
    setCreated(null);
    try {
      const result = await requestJson<CreatedCode>("/api/admin/reward-codes", {
        method: "POST",
        body: JSON.stringify({
          ...(method === "custom" ? { code: customCode.trim().toUpperCase() } : {}),
          reward_coins: Number(coins),
          max_redemptions: Number(limit),
          expires_at: expiry ? new Date(`${expiry}:00+07:00`).toISOString() : null,
        }),
      });
      setCreated(result);
      setItems((current) =>
        [
          {
            ...result,
            code_last4: result.code.slice(-4),
            redeemed_count: 0,
            created_at: new Date().toISOString(),
          },
          ...current,
        ].slice(0, 100),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không tạo được mã.");
    } finally {
      setSaving(false);
    }
  }
  async function copyCode() {
    if (!created) return;
    setCopyError("");
    try {
      await navigator.clipboard.writeText(created.code);
      setCopied(true);
    } catch {
      setCopyError("Hãy chọn và sao chép mã trong ô bên cạnh.");
    }
  }

  const now = Date.now();
  const totalRedemptions = items.reduce((sum, code) => sum + code.redeemed_count, 0);
  const totalCoins = items.reduce((sum, code) => sum + code.redeemed_count * code.reward_coins, 0);
  const normalizedQuery = query.trim().toUpperCase();
  const filtered = items.filter(
    (code) =>
      (!status || statusOf(code, now) === status) &&
      (!normalizedQuery ||
        code.code_last4.toUpperCase().includes(normalizedQuery) ||
        code.id.toUpperCase().includes(normalizedQuery)),
  );
  const metrics = [
    { label: "Tổng mã", value: items.length, Icon: Ticket },
    {
      label: "Đang hoạt động",
      value: items.filter((code) => statusOf(code, now) === "active").length,
      Icon: CheckCircle2,
    },
    {
      label: "Đã hết hạn",
      value: items.filter((code) => statusOf(code, now) === "expired").length,
      Icon: Hourglass,
    },
    { label: "Tổng lượt đổi", value: totalRedemptions, Icon: Gift },
    { label: "Xu đã phát", value: totalCoins, Icon: Coins },
  ];

  return (
    <div className={styles.screen}>
      <div className={styles.metrics} aria-label="Thống kê mã đổi thưởng" aria-busy={loading}>
        {metrics.map(({ label, value, Icon }) => (
          <article key={label} className={styles.metric}>
            <div>
              <span>{label}</span>
              <Icon size={19} aria-hidden="true" />
            </div>
            <strong>{loading && !items.length ? "—" : formatCount(value)}</strong>
          </article>
        ))}
      </div>
      <section className={styles.createPanel} aria-labelledby="reward-code-create-title">
        <div className={styles.panelTitle}>
          <h2 id="reward-code-create-title">
            <Gift size={22} aria-hidden="true" />
            Tạo mã đổi thưởng
          </h2>
          <p>Mã được tạo an toàn. Mỗi tài khoản được đổi một lần.</p>
        </div>
        <form className={styles.createForm} onSubmit={createCode}>
          <div className={styles.fields}>
            <label>
              <span>Cách tạo</span>
              <select aria-label="Cách tạo" value={method} onChange={(event) => setMethod(event.target.value)}>
                <option value="automatic">Tạo mã tự động</option>
                <option value="custom">Mã tùy chỉnh</option>
              </select>
            </label>
            <label>
              <span>Mã tùy chỉnh</span>
              <input
                disabled={method !== "custom"}
                value={customCode}
                onChange={(event) => setCustomCode(event.target.value.toUpperCase())}
                placeholder={method === "custom" ? "VD: CINEVJET2026" : "Hệ thống tự tạo"}
                required={method === "custom"}
                pattern="(?:[A-Za-z0-9]|-){6,32}"
                minLength={6}
                maxLength={32}
                autoComplete="off"
              />
            </label>
            <label>
              <span>Giá trị (xu)</span>
              <input
                type="number"
                min={1}
                max={1000000}
                step={1}
                value={coins}
                onChange={(event) => setCoins(event.target.value)}
                required
              />
            </label>
            <label>
              <span>Tổng lượt đổi</span>
              <input
                type="number"
                min={1}
                max={10000000}
                step={1}
                value={limit}
                onChange={(event) => setLimit(event.target.value)}
                required
              />
            </label>
            <label className={styles.wideField}>
              <span>Hết hạn (giờ Việt Nam)</span>
              <input
                type="datetime-local"
                aria-label="Hết hạn (giờ Việt Nam)"
                step={60}
                value={expiry}
                onChange={(event) => setExpiry(event.target.value)}
              />
              <small>Để trống nếu không giới hạn thời gian.</small>
            </label>
            <div className={styles.rules}>
              <span>Loại phần thưởng</span>
              <strong>
                <Coins size={17} aria-hidden="true" />
                Xu thưởng
              </strong>
              <small>1 lượt / tài khoản</small>
            </div>
          </div>
          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
          <button className={styles.primaryButton} disabled={saving}>
            <Gift size={18} aria-hidden="true" />
            {saving ? "Đang tạo mã…" : method === "custom" ? "Tạo mã tùy chỉnh" : "Tạo mã tự động"}
          </button>
        </form>
        {created ? (
          <div className={styles.created} role="status">
            <div>
              <CheckCircle2 size={20} aria-hidden="true" />
              <strong>Đã tạo mã đổi thưởng</strong>
              <span>Sao chép mã trước khi rời trang.</span>
            </div>
            <div className={styles.copyRow}>
              <input
                aria-label="Mã đổi thưởng vừa tạo"
                value={created.code}
                readOnly
                onFocus={(event) => event.target.select()}
              />
              <button type="button" onClick={() => void copyCode()}>
                {copied ? <Check size={17} /> : <Copy size={17} />}
                {copied ? "Đã sao chép" : "Sao chép"}
              </button>
            </div>
            {copyError ? <p className={styles.error}>{copyError}</p> : null}
          </div>
        ) : null}
      </section>
      <section className={styles.listPanel} aria-labelledby="reward-code-list-title">
        <div className={styles.listHeading}>
          <div>
            <h2 id="reward-code-list-title">Danh sách mã đổi thưởng</h2>
            <p>
              {items.length >= 100
                ? "100 mã gần nhất"
                : `${formatCount(items.length)} mã đã phát hành`}
            </p>
          </div>
          <button
            className={styles.refreshButton}
            type="button"
            disabled={loading}
            onClick={() => void refresh()}
          >
            <RefreshCw size={16} aria-hidden="true" />
            {loading ? "Đang tải…" : "Làm mới"}
          </button>
        </div>
        <div className={styles.filters}>
          <div className={styles.search}>
            <Search size={18} aria-hidden="true" />
            <input
              aria-label="Tìm mã đổi thưởng"
              placeholder="Tìm theo 4 ký tự cuối của mã…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <select
            aria-label="Lọc trạng thái mã"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">Tất cả trạng thái</option>
            <option value="active">Đang hoạt động</option>
            <option value="expired">Đã hết hạn</option>
            <option value="exhausted">Đã hết lượt</option>
          </select>
        </div>
        {loadError ? (
          <p className={styles.error} role="alert">
            {loadError}
          </p>
        ) : null}
        <div className={styles.tableWrap} aria-busy={loading}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Mã đổi thưởng</th>
                <th>Giá trị</th>
                <th>Lượt sử dụng</th>
                <th>Ngày tạo</th>
                <th>Hết hạn</th>
                <th>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((code) => {
                const codeStatus = statusOf(code, now);
                return (
                  <tr key={code.id}>
                    <td>
                      <span className={styles.maskedCode}>•••• {code.code_last4}</span>
                    </td>
                    <td>
                      <strong className={styles.coinValue}>
                        {formatCount(code.reward_coins)} <small>xu</small>
                      </strong>
                    </td>
                    <td>
                      <div className={styles.usage}>
                        <span>
                          {formatCount(code.redeemed_count)}{" "}
                          <small>/ {formatCount(code.max_redemptions)}</small>
                        </span>
                        <progress
                          value={code.redeemed_count}
                          max={code.max_redemptions}
                          aria-label={`Lượt dùng mã kết thúc ${code.code_last4}`}
                        />
                      </div>
                    </td>
                    <td>{formatDate(code.created_at)}</td>
                    <td>{formatDate(code.expires_at)}</td>
                    <td>
                      <span className={`${styles.status} ${styles[codeStatus]}`}>
                        <i aria-hidden="true" />
                        {statusLabels[codeStatus]}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!filtered.length ? (
            <div className={styles.empty}>
              <Ticket size={30} aria-hidden="true" />
              <strong>
                {loading
                  ? "Đang tải danh sách…"
                  : items.length
                    ? "Không tìm thấy mã phù hợp"
                    : "Chưa có mã đổi thưởng"}
              </strong>
              <p>
                {items.length
                  ? "Thử từ khóa hoặc trạng thái khác."
                  : "Tạo mã đầu tiên bằng biểu mẫu bên trên."}
              </p>
            </div>
          ) : null}
        </div>
        <div className={styles.listFooter}>
          Hiển thị {formatCount(filtered.length)} / {formatCount(items.length)} mã
          {items.length >= 100 ? " gần nhất" : ""}
        </div>
      </section>
    </div>
  );
}
