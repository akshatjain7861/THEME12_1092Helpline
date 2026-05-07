export const runtime = "nodejs";

interface Message {
  role: "user" | "ai";
  content: string;
}

interface RequestBody {
  message: string;
  conversationHistory: Message[];
}

export async function POST(req: Request) {
  try {
    const { message, conversationHistory } = (await req.json()) as RequestBody;

    if (!message || !message.trim()) {
      return new Response(
        JSON.stringify({ text: "I didn't catch that. Please try again." }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error("GEMINI_API_KEY not configured");
      return new Response(
        JSON.stringify({
          text: "I'm having trouble right now. Let me give you a direct response: That's interesting! Please tell me more about what you're looking for."
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // Build natural conversation context
    const conversationContext = conversationHistory
      .slice(-6) // Keep last 6 messages for context
      .map((msg) => `${msg.role === "user" ? "User" : "AI"}: ${msg.content}`)
      .join("\n");

    const systemPrompt = `You are a friendly, helpful AI assistant. Keep responses short and natural for voice conversation (1-3 sentences max). Be warm, engaging, and conversational. Respond naturally as if you're talking to someone on the phone.

Previous Conversation:
${conversationContext}

User: ${message}

Respond naturally and conversationally:`;

    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: systemPrompt
              }
            ]
          }
        ],
        generationConfig: {
          maxOutputTokens: 150,
          temperature: 0.8
        }
      })
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error("Gemini API Error:", errorData);
      
      // Provide a fallback response
      const fallbackResponses = [
        `That's a great question! Let me think about that for a moment...`,
        `I understand what you're saying. Here's what I think...`,
        `Interesting! I have a few thoughts on that...`,
        `That's something I can definitely help you with!`,
        `I see what you mean. Let me help you with that...`
      ];
      
      const fallback = fallbackResponses[Math.floor(Math.random() * fallbackResponses.length)];
      
      return new Response(
        JSON.stringify({ text: fallback }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    const data = (await response.json()) as any;
    let aiText =
      data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
      "That's interesting! Let me think about that.";

    // Clean up the response
    aiText = aiText
      .replace(/^Respond naturally and conversationally:\s*/i, "")
      .replace(/^[^a-zA-Z0-9]*/g, "")
      .trim();

    // Ensure it's not too long for voice
    if (aiText.length > 500) {
      aiText = aiText.substring(0, 500) + "...";
    }

    return new Response(
      JSON.stringify({ text: aiText || "I'd love to help with that!" }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Voice Chat API Error:", error);
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    
    return new Response(
      JSON.stringify({
        text: "Let me try that again... I'm ready to help!"
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  }
}
