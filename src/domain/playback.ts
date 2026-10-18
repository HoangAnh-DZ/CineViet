import type { VideoSource } from "./models";
export const BUFFER_SPINNER_DELAY_MS = 350;
export const BUFFER_TIMEOUT_MS = 15000;
export const NETWORK_RETRY_DELAYS = [1000, 3000] as const;
export function sourceBandwidth(source: VideoSource) {
  return (
    source.bitrate_bps ||
    ({
      "240p": 400000,
      "360p": 700000,
      "480p": 1100000,
      "720p": 2200000,
      "1080p": 4500000,
      AUTO: 1500000,
    }[source.quality] ??
      1500000)
  );
}
export function autoSource(
  sources: VideoSource[],
  connection?: { downlink?: number; saveData?: boolean },
) {
  const sorted = [...sources].sort((a, b) => sourceBandwidth(a) - sourceBandwidth(b));
  if (connection?.saveData) return sorted[0];
  const budget =
    connection?.downlink && connection.downlink > 0
      ? connection.downlink * 1000000 * 0.65
      : 1200000;
  return sorted.filter((s) => sourceBandwidth(s) <= budget).at(-1) || sorted[0];
}
export function lowerSource(sources: VideoSource[], current: VideoSource) {
  return [...sources]
    .filter((s) => sourceBandwidth(s) < sourceBandwidth(current))
    .sort((a, b) => sourceBandwidth(b) - sourceBandwidth(a))[0];
}
