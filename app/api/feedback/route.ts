import { NextRequest, NextResponse } from "next/server";
import { appendSession, readStore } from "@/lib/store";
import { SessionRecord } from "@/lib/types";

export async function GET() {
  const store = await readStore();
  return NextResponse.json(store);
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      record: SessionRecord;
      metrics?: {
        confirmedInterpretations?: number;
        correctedInterpretations?: number;
        escalations?: number;
      };
    };

    const store = await appendSession(body.record, body.metrics);
    return NextResponse.json(store);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to persist feedback."
      },
      { status: 500 }
    );
  }
}
