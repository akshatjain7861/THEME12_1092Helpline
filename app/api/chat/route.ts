import { GoogleGenAI } from "@google/genai";

const genAI = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

export const runtime = "nodejs";

interface RequestBody {
  message: string;
  conversationHistory: Array<{
    role: "user" | "ai";
    content: string;
  }>;
}

export async function POST(req: Request) {
  try {
    const { message, conversationHistory } = (await req.json()) as RequestBody;

    if (!message || !message.trim()) {
      return new Response("No message provided", { status: 400 });
    }

    // Build conversation history for the prompt
    const conversationContext = conversationHistory
      .map((msg) => `${msg.role === "user" ? "User" : "AI"}: ${msg.content}`)
      .join("\n");

    const systemPrompt = `You are a helpful, knowledgeable AI assistant. Provide clear, concise, and accurate responses. Be conversational and friendly. When appropriate, break down complex topics into understandable parts.

Conversation History:
${conversationContext}

User: ${message}

AI:`;

    const response = await genAI.models.generateContent({
      model: "gemini-2.5-flash",
      contents: systemPrompt
    });

    // Create a readable stream for the response
    const encoder = new TextEncoder();
    const responseText = response.text?.trim() || "";

    if (!responseText) {
      return new Response("No response generated", { status: 500 });
    }

    let cancelled = false;

    const customReadable = new ReadableStream<Uint8Array>({
      start(controller) {
        try {
          // Stream the text character by character for a more natural effect
          let index = 0;
          const chunkSize = 10;

          const streamChunk = () => {
            if (cancelled) {
              controller.close();
              return;
            }

            if (index < responseText.length) {
              const chunk = responseText.slice(index, index + chunkSize);
              controller.enqueue(encoder.encode(chunk));
              index += chunkSize;
              // Small delay to simulate streaming
              setTimeout(streamChunk, 20);
            } else {
              controller.close();
            }
          };

          streamChunk();
        } catch (error) {
          controller.error(error);
        }
      },
      cancel() {
        cancelled = true;
      }
    });

    return new Response(customReadable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive"
      }
    });
  } catch (error) {
    console.error("Chat API Error:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to process chat request",
        details: error instanceof Error ? error.message : "Unknown error"
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
