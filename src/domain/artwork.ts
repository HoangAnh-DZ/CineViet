// Resize the full-resolution Blender artwork. Wikimedia already supplies
// sized thumbnails; those and custom Admin artwork retain their direct URLs.
export function unoptimizedArtwork(source: string): boolean {
  if (source.startsWith("/")) return false;
  try {
    const url = new URL(source);
    if (
      url.protocol !== "https:" ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return true;
    const trusted =
      url.hostname === "video.blender.org" && url.pathname.startsWith("/lazy-static/thumbnails/");
    return !trusted;
  } catch {
    return true;
  }
}
