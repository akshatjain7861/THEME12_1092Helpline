import { GoogleGenAI } from "@google/genai";
import { Interpretation, Sentiment, TranscriptTurn, Urgency } from "@/lib/types";

const fallbackSentiments: Sentiment[] = ["calm", "confusion", "urgency", "distress", "anger", "fear"];
const urgencyWords = ["urgent", "help", "immediately", "attack", "harassment", "scared", "fear", "danger"];

function fallbackInterpretation(transcript: string): Interpretation {
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

  const response = await client.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
    config: {
      responseMimeType: "application/json"
    }
  });

  const text = response.text?.trim();
  if (!text) {
    return fallbackInterpretation(transcript);
  }

  const parsed = JSON.parse(text) as Interpretation;
  return {
    ...parsed,
    confidence: Math.max(0, Math.min(1, parsed.confidence))
  };
}
