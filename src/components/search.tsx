"use client";
import { Search, X } from "lucide-react";
export function SearchBar({
  value,
  onChange,
  autoFocus = false,
}: {
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <div className="search-bar">
      <Search size={18} />
      <input
        type="search"
        aria-label="Tìm phim, diễn viên"
        placeholder="Tìm kiếm phim, diễn viên..."
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
      />
      {value ? (
        <button type="button" aria-label="Xóa tìm kiếm" onClick={() => onChange("")}>
          <X size={16} />
        </button>
      ) : null}
    </div>
  );
}
export function GenreChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`genre-chip ${active ? "active" : ""}`}
      aria-pressed={active}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
