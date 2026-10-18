import test from "node:test";
import assert from "node:assert/strict";
import {
  registrationFormSchema,
  registrationRequestSchema,
  credentialsSchema,
} from "../src/server/validation";
import { unoptimizedArtwork } from "../src/domain/artwork";
const fields = {
  display_name: "Cinema Tester",
  email: "cinema@example.invalid",
  password: "Cinema-Test-123!",
  confirm_password: "Cinema-Test-123!",
  verification_challenge: "3fda11b5-2067-42d4-8091-416f0d5fec43",
  verification_code: "A4B9",
  referral_code: "",
};
test("only known public artwork folders use optimized thumbnails; custom artwork remains compatible", () => {
  assert.equal(unoptimizedArtwork("/images/films/spring.webp"), false);
  assert.equal(
    unoptimizedArtwork("https://video.blender.org/lazy-static/thumbnails/film.jpg"),
    false,
  );
  assert.equal(
    unoptimizedArtwork(
      "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Film.webm/480px-Film.webm.jpg",
    ),
    true,
  );
  for (const url of [
    "http://video.blender.org/lazy-static/thumbnails/film.jpg",
    "https://video.blender.org/object-storage/movie.mp4",
    "https://video.blender.org:444/lazy-static/thumbnails/film.jpg",
    "https://video.blender.org/lazy-static/thumbnails/film.jpg?v=2",
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/film.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo",
    "https://upload.wikimedia.org.evil.invalid/wikipedia/commons/thumb/film.jpg",
    "https://custom-artwork.example.invalid/poster.jpg",
  ])
    assert.equal(unoptimizedArtwork(url), true);
});
test("registration confirmation matches exactly, rejects empty/mismatched, uses existing password policy", () => {
  assert.ok(registrationFormSchema.safeParse(fields).success);
  for (const value of ["", "Cinema-Test-123", "cinema-Test-123!"]) {
    const v = registrationFormSchema.safeParse({ ...fields, confirm_password: value });
    assert.equal(v.success, false);
    if (!v.success) assert.ok(v.error.issues.some((e) => e.path[0] === "confirm_password"));
  }
  for (const password of ["", "1234567", "é".repeat(37)])
    assert.equal(
      registrationFormSchema.safeParse({ ...fields, password, confirm_password: password }).success,
      false,
    );
  assert.equal(
    registrationFormSchema.safeParse({
      ...fields,
      password: "é".repeat(36),
      confirm_password: "é".repeat(36),
    }).success,
    true,
  );
});
test("confirmation is stripped by API schema; old registration and login clients remain compatible", () => {
  assert.equal("confirm_password" in registrationRequestSchema.parse(fields), false);
  const { confirm_password, ...legacy } = fields;
  assert.ok(registrationRequestSchema.safeParse(legacy).success);
  assert.ok(
    credentialsSchema.safeParse({ email: fields.email, password: fields.password }).success,
  );
});
