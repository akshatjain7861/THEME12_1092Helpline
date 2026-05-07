import { GoogleGenAI } from "@google/genai";
import { Interpretation, Sentiment, TranscriptTurn, Urgency } from "@/lib/types";

const fallbackSentiments: Sentiment[] = ["calm", "confusion", "urgency", "distress", "anger", "fear"];
const urgencyWords = ["urgent", "help", "immediately", "attack", "harassment", "scared", "fear", "danger"];

export function fallbackInterpretation(transcript: string): Interpretation {
  const lower = transcript.toLowerCase();
  const sentiment =
    fallbackSentiments.find((entry) => lower.includes(entry)) ??
    (urgencyWords.some((word) => lower.includes(word)) ? "urgency" : "calm");
  const urgency: Urgency =
    lower.includes("immediately") || lower.includes("danger") || lower.includes("urgent")
      ? "high"
      : lower.length > 120
        ? "medium"
        : "low";
  const confidence = transcript.trim().length > 30 ? 0.82 : 0.46;

  return {
    issue_summary: transcript.trim() || "No clear issue captured yet.",
    language: /[\u0C80-\u0CFF]/.test(transcript)
      ? "Kannada"
      : /[\u0900-\u097F]/.test(transcript)
        ? "Hindi"
        : "English / mixed",
    sentiment,
    urgency,
    confidence,
    verification_text: `I understood that ${transcript.trim() || "the caller has not finished speaking yet"}. Is that correct?`,
    agent_question: "Can you confirm the exact location and immediate risk?",
    handover_recommended: confidence < 0.55 || urgency === "high" || sentiment === "distress"
  };
}

function isTemporaryModelError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /503|unavailable|high demand|overload|temporar|rate|quota/i.test(message);
}

async function wait(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function interpretTranscript(transcript: string, turns: TranscriptTurn[]) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return fallbackInterpretation(transcript);
  }

  const client = new GoogleGenAI({ apiKey });
  const prompt = `
You are an assistive AI for the Karnataka 1092 helpline.
Given the latest transcript and prior turns, return JSON only with the following fields:
issue_summary, language, sentiment, urgency, confidence, verification_text, agent_question, handover_recommended.

Rules:
- sentiment must be one of: distress, urgency, anger, fear, confusion, calm
- urgency must be one of: low, medium, high
- confidence must be a number from 0 to 1
- verification_text must be a short sentence suitable to speak back to the citizen
- handover_recommended must be true when confidence is low, distress is high, or the transcript is too uncertain

Prior turns:
${turns.map((turn) => `${turn.speaker}: ${turn.text}`).join("\n")}

Latest citizen transcript:
${transcript}
`;

  let text = "";

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await client.models.generateContent({
        model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json"
        }
      });

      text = response.text?.trim() ?? "";
      break;
    } catch (error) {
      if (!isTemporaryModelError(error) || attempt === 2) {
        console.warn("Using local interpretation fallback after AI provider error:", error);
        return fallbackInterpretation(transcript);
      }

      await wait(350 * (attempt + 1));
    }
  }

  if (!text) {
    return fallbackInterpretation(transcript);
  }

  try {
    const parsed = JSON.parse(text) as Interpretation;
    return {
      ...parsed,
      confidence: Math.max(0, Math.min(1, parsed.confidence))
    };
  } catch {
    return fallbackInterpretation(transcript);
  }
}
