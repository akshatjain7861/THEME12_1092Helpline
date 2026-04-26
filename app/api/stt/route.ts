import { NextRequest, NextResponse } from "next/server";
import { transcribeAudio } from "@/lib/sarvam";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      audioDataUrl?: string;
      transcriptHint?: string;
    };
    const result = await transcribeAudio(body.audioDataUrl, body.transcriptHint);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to transcribe audio."
      },
      { status: 500 }
    );
  }
}
