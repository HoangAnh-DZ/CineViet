import test from "node:test";
import assert from "node:assert/strict";
import QRCode from "qrcode";
import jsQR from "jsqr";
import sharp from "sharp";
import { payosQrDetails, qrChecksum } from "../src/domain/payos-qr";

// Isolated, non-payable EMV fixture. No provider or production writes.
function tlv(tag: string, value: string) {
  return tag + String(Buffer.byteLength(value)).padStart(2, "0") + value;
}
const body =
  tlv("00", "01") +
  tlv("01", "12") +
  tlv(
    "38",
    tlv("00", "A000000727") +
      tlv("01", tlv("00", "000000") + tlv("01", "TESTONLY")) +
      tlv("02", "QRIBFTTA"),
  ) +
  tlv("53", "704") +
  tlv("54", "150000") +
  tlv("58", "VN") +
  tlv("62", tlv("08", "TEST ONLY")) +
  "6304";
const payload = body + qrChecksum(body);
test("QR renders and decodes exact provider payload with a standard quiet zone", async () => {
  const png = await QRCode.toBuffer(payload, { margin: 4, width: 320, errorCorrectionLevel: "M" });
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const decoded = jsQR(new Uint8ClampedArray(data), info.width, info.height);
  assert.equal(decoded?.data, payload);
  assert.deepEqual(payosQrDetails(decoded?.data, 150000), {
    amount: 150000,
    bankCode: "000000",
    accountNumber: "TESTONLY",
    description: "TEST ONLY",
  });
  assert.equal(data[0], 255);
});
test("invalid CRC, different amount, missing data and non-VND QR cannot be shown", () => {
  assert.equal(payosQrDetails(payload, 300000), null);
  assert.equal(payosQrDetails(payload.slice(0, -4) + "0000", 150000), null);
  assert.equal(payosQrDetails("", 150000), null);
  assert.equal(payosQrDetails("test-only-qr", 150000), null);
  const foreign = body.replace("5303704", "5303840");
  assert.equal(payosQrDetails(foreign + qrChecksum(foreign), 150000), null);
});
