import "server-only";
import { randomInt } from "node:crypto";
import sharp from "sharp";

// Local vector glyphs avoid runtime font dependencies. Only raster pixels leave
// the server: no answer, SVG text, or solvable seed is sent to the browser.
const glyphs: Record<string, string> = {
  A: "01110/10001/10001/11111/10001/10001/10001",
  B: "11110/10001/10001/11110/10001/10001/11110",
  C: "01111/10000/10000/10000/10000/10000/01111",
  D: "11110/10001/10001/10001/10001/10001/11110",
  E: "11111/10000/10000/11110/10000/10000/11111",
  F: "11111/10000/10000/11110/10000/10000/10000",
  G: "01111/10000/10000/10111/10001/10001/01111",
  H: "10001/10001/10001/11111/10001/10001/10001",
  J: "00111/00010/00010/00010/10010/10010/01100",
  K: "10001/10010/10100/11000/10100/10010/10001",
  L: "10000/10000/10000/10000/10000/10000/11111",
  M: "10001/11011/10101/10101/10001/10001/10001",
  N: "10001/11001/10101/10011/10001/10001/10001",
  P: "11110/10001/10001/11110/10000/10000/10000",
  Q: "01110/10001/10001/10001/10101/10010/01101",
  R: "11110/10001/10001/11110/10100/10010/10001",
  S: "01111/10000/10000/01110/00001/00001/11110",
  T: "11111/00100/00100/00100/00100/00100/00100",
  U: "10001/10001/10001/10001/10001/10001/01110",
  V: "10001/10001/10001/10001/10001/01010/00100",
  W: "10001/10001/10001/10101/10101/10101/01010",
  X: "10001/10001/01010/00100/01010/10001/10001",
  Y: "10001/10001/01010/00100/00100/00100/00100",
  Z: "11111/00001/00010/00100/01000/10000/11111",
  2: "01110/10001/00001/00010/00100/01000/11111",
  3: "11110/00001/00001/01110/00001/00001/11110",
  4: "00010/00110/01010/10010/11111/00010/00010",
  5: "11111/10000/10000/11110/00001/00001/11110",
  6: "01110/10000/10000/11110/10001/10001/01110",
  7: "11111/00001/00010/00100/01000/01000/01000",
  8: "01110/10001/10001/01110/10001/10001/01110",
  9: "01110/10001/10001/01111/00001/00001/01110",
};
export async function registrationImage(code: string) {
  if (!/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/.test(code)) throw new Error("Invalid challenge");
  const colors = ["#f8fafc", "#fca5a5", "#fde68a", "#bae6fd"];
  const noise = Array.from(
    { length: 90 },
    () =>
      `<circle cx="${randomInt(240)}" cy="${randomInt(72)}" r="${randomInt(1, 3)}" fill="#94a3b8" opacity=".22"/>`,
  ).join("");
  const letters = [...code]
    .map((letter, i) => {
      const cells = glyphs[letter]
        .split("/")
        .flatMap((row, y) =>
          [...row].map((cell, x) =>
            cell === "1"
              ? `<rect x="${x * 6}" y="${y * 6}" width="6.5" height="6.5" rx="1.8"/>`
              : "",
          ),
        )
        .join("");
      return `<g transform="translate(${20 + i * 56},${14 + randomInt(-3, 4)}) rotate(${randomInt(-13, 14)},15,21) skewX(${randomInt(-7, 8)})" fill="${colors[i]}">${cells}</g>`;
    })
    .join("");
  const lines = Array.from(
    { length: 4 },
    () =>
      `<path d="M0 ${randomInt(72)} Q120 ${randomInt(72)} 240 ${randomInt(72)}" fill="none" stroke="#ef4444" stroke-width="1.2" opacity=".4"/>`,
  ).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="144" viewBox="0 0 240 72"><rect width="240" height="72" fill="#171a20"/>${noise}${letters}${lines}</svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}
