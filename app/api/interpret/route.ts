import { NextRequest, NextResponse } from "next/server";
import { interpretTranscript } from "@/lib/ai";
import { TranscriptTurn } from "@/lib/types";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      transcript: string;
      turns: TranscriptTurn[];
    };

    const interpretation = await interpretTranscript(body.transcript, body.turns ?? []);
    return NextResponse.json(interpretation);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to interpret transcript."
      },
      { status: 500 }
    );
  }
}
