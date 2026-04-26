import { NextRequest, NextResponse } from "next/server";
import { synthesizeSpeech } from "@/lib/sarvam";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { text: string };
    const result = await synthesizeSpeech(body.text);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to synthesize speech."
      },
      { status: 500 }
    );
  }
}
