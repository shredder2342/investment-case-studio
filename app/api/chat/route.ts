import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { messages, model = "gpt-5.1", temperature = 0.3 } = await req.json();
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model, temperature, messages }),
  });
  if (!r.ok) {
    const t = await r.text();
    return new NextResponse(t || "Upstream error", { status: r.status });
  }
  const data = await r.json();
  return NextResponse.json(data);
}
