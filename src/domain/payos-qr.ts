// Read the provider's VietQR payload; never construct bank payment information.
function fields(text: string): Map<string, string> | null {
  const bytes = new TextEncoder().encode(text),
    result = new Map<string, string>();
  let offset = 0;
  while (offset < bytes.length) {
    const header = new TextDecoder().decode(bytes.slice(offset, offset + 4));
    if (!/^\d{4}$/.test(header)) return null;
    const tag = header.slice(0, 2),
      length = Number(header.slice(2));
    offset += 4;
    if (offset + length > bytes.length || result.has(tag)) return null;
    result.set(tag, new TextDecoder().decode(bytes.slice(offset, offset + length)));
    offset += length;
  }
  return result;
}
export function qrChecksum(text: string) {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(text)) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
    crc &= 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}
export function payosQrDetails(payload: string | null | undefined, amount: number) {
  if (!payload || payload.length > 3000 || !/6304[\da-f]{4}$/i.test(payload)) return null;
  if (qrChecksum(payload.slice(0, -4)) !== payload.slice(-4).toUpperCase()) return null;
  const top = fields(payload),
    merchant = top?.get("38") ? fields(top.get("38")!) : null;
  const bank = merchant?.get("01") ? fields(merchant.get("01")!) : null;
  const extra = top?.get("62") ? fields(top.get("62")!) : null;
  if (
    top?.get("00") !== "01" ||
    top.get("53") !== "704" ||
    top.get("58") !== "VN" ||
    !/^\d+(?:\.0{1,2})?$/.test(top.get("54") || "") ||
    Number(top.get("54")) !== amount ||
    merchant?.get("00") !== "A000000727" ||
    !bank?.get("01") ||
    !bank.get("00")
  )
    return null;
  return {
    amount,
    bankCode: bank.get("00")!,
    accountNumber: bank.get("01")!,
    description: extra?.get("08") || null,
  };
}
