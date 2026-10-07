export async function GET() {
  return Response.json({ error: "Demo API đã tắt." }, { status: 410 });
}
export async function POST() {
  return Response.json({ error: "Tính năng đang hoàn thiện." }, { status: 410 });
}
