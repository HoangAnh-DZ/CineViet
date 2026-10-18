import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EpisodeSelector } from "../src/components/movies";
import { AppProvider } from "../src/components/providers";
import { episodeDuration, episodeHeading, resumableProgress } from "../src/domain/episodes";
import { episodeInput } from "../src/domain/movie-management";
import type { Episode, Movie, WatchProgress } from "../src/domain/models";
const episode: Episode = {
  id: "episode-1",
  movie_id: "series-1",
  season: 1,
  episode_number: 1,
  title: "L’Ombre mystérieuse",
  duration: 125,
  thumbnail: "/images/films/spring-poster.webp",
  release_date: "",
};
const movie = { id: "series-1" } as Movie;
function render(episodes: Episode[], selected?: string) {
  return renderToStaticMarkup(
    React.createElement(
      AppProvider,
      null,
      React.createElement(EpisodeSelector, { movie, episodes, selected }),
    ),
  );
}
test("episode labels preserve actual titles and use neutral fallbacks without duplicate numbers", () => {
  assert.equal(episodeHeading(episode), "Tập 1 — L’Ombre mystérieuse");
  assert.equal(episodeHeading({ ...episode, title: "" }), "Tập 1");
  assert.equal(episodeHeading({ ...episode, title: " Episode 1 " }), "Tập 1");
  assert.equal(episodeHeading({ ...episode, season: 2, title: "" }), "Mùa 2 · Tập 1");
  assert.equal(episodeDuration(125), "2 phút 5 giây");
  assert.equal(episodeDuration(0), "");
  assert.equal(episodeDuration(NaN), "");
});
test("episode cards link to their own video and render real metadata, selected state and escaped descriptions", () => {
  const html = render([{ ...episode, description: "<img src=x onerror=alert(1)>" }], episode.id);
  assert.ok(html.includes("/watch/series-1/episode-1"));
  assert.ok(html.includes('aria-current="page"'));
  assert.ok(html.includes("Đang xem") && html.includes("2 phút 5 giây"));
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"));
  assert.ok(!/<img[^>]*onerror=/.test(html));
  const missing = render([{ ...episode, title: "", description: "", duration: 0, thumbnail: "" }]);
  assert.ok(missing.includes("Tập 1"));
  assert.ok(
    !missing.includes("episode-description") &&
      !missing.includes("episode-thumbnail") &&
      !missing.includes("phút"),
  );
});
test("episode descriptions are optional, bounded and preserve old editor requests", () => {
  const input = {
    season: 1,
    episode_number: 1,
    title: "Tập 1",
    duration_seconds: 60,
    status: "DRAFT",
    playback_url: "",
  };
  assert.equal(episodeInput.parse(input).description, undefined);
  assert.equal(
    episodeInput.parse({ ...input, description: "  Nội dung  " }).description,
    "Nội dung",
  );
  assert.throws(() => episodeInput.parse({ ...input, description: "x".repeat(3001) }));
});

test("continue watching uses only unfinished progress for the same movie and a published episode", () => {
  const series = { ...movie, type: "SERIES" } as Movie;
  const saved = {
    movie_id: movie.id,
    episode_id: episode.id,
    position_seconds: 20,
    duration_seconds: 100,
  } as WatchProgress;
  assert.equal(resumableProgress(series, [episode], [saved]), saved);
  assert.equal(resumableProgress(series, [], [saved]), undefined);
  assert.equal(resumableProgress(series, [episode], [{ ...saved, movie_id: "other" }]), undefined);
  assert.equal(
    resumableProgress(series, [episode], [{ ...saved, position_seconds: 99 }]),
    undefined,
  );
});
