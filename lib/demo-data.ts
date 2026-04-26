import { CallStage, Interpretation, SessionMetrics, TranscriptTurn } from "@/lib/types";

export const initialTurns: TranscriptTurn[] = [
  {
    id: "seed-1",
    speaker: "ai",
    text: "1092 helpline copilot is ready. Start the call when the citizen begins speaking.",
    timestamp: new Date().toISOString()
  }
];

export const initialInterpretation: Interpretation = {
  issue_summary: "Waiting for the citizen to describe the issue.",
  language: "Unknown",
  sentiment: "calm",
  urgency: "low",
  confidence: 0,
  verification_text: "Please tell me what happened, and I will repeat it back for confirmation.",
  agent_question: "What is the caller’s issue and location?",
  handover_recommended: false
};

export const initialMetrics: SessionMetrics = {
  confirmedInterpretations: 0,
  correctedInterpretations: 0,
  escalations: 0
};

export const callStageLabels: Record<CallStage, string> = {
  idle: "Idle",
  listening: "Listening",
  understanding: "Understanding",
  verifying: "Verifying",
  confirmed: "Confirmed",
  human_takeover: "Escalated to Human"
};
