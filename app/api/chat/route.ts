import { GoogleGenAI } from "@google/genai";

const genAI = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

export const runtime = "nodejs";

function getFallbackChatResponse(message: string) {
  const lower = message.toLowerCase();

  if (lower.includes("water")) {
    return "I understand this is about a water supply issue. Please confirm the village name, duration of the issue, and whether any emergency support is needed.";
  }

  if (lower.includes("help") || lower.includes("urgent") || lower.includes("scared")) {
    return "I understand this may be urgent. Please share your exact location first, and I will help escalate this safely.";
  }

  return "I am currently using offline assistance because the AI model is busy. Please share the issue, location, urgency, and any immediate risk.";
}

function isTemporaryModelError(error: unknown) {
  const messageText = error instanceof Error ? error.message : String(error);
  return /503|unavailable|high demand|overload|temporar|rate|quota/i.test(messageText);
}

async function wait(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function streamText(responseText: string) {
  const encoder = new TextEncoder();
  let cancelled = false;

  const customReadable = new ReadableStream<Uint8Array>({
    start(controller) {
      try {
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
}

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

    let responseText = "";

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await genAI.models.generateContent({
          model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
          contents: systemPrompt
        });

        responseText = response.text?.trim() || "";
        break;
      } catch (error) {
        if (!isTemporaryModelError(error) || attempt === 2) {
          console.warn("Using chat fallback after AI provider error:", error);
          responseText = getFallbackChatResponse(message);
          break;
        }

        await wait(350 * (attempt + 1));
      }
    }

    if (!responseText) {
      responseText = getFallbackChatResponse(message);
    }

    return streamText(responseText);
  } catch (error) {
    console.error("Chat API Error:", error);
    return streamText("The AI model is busy, so I switched to offline assistance. Please provide the caller issue, location, and urgency.");
  }
}
