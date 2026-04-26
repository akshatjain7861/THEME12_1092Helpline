import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { summary?: string; language?: string };
  const summary = body.summary?.trim() || "the issue";
  const language = body.language?.trim() || "your language";

  return NextResponse.json({
    verificationText: `I understood in ${language} that ${summary}. Is that correct?`
  });
}
