export type ConfirmationStatus = "pending" | "correct" | "partial" | "incorrect";

export type CallStage =
  | "idle"
  | "listening"
  | "understanding"
  | "verifying"
  | "confirmed"
  | "human_takeover";

export type Sentiment = "distress" | "urgency" | "anger" | "fear" | "confusion" | "calm";
export type Urgency = "low" | "medium" | "high";

export interface TranscriptTurn {
  id: string;
  speaker: "citizen" | "ai" | "agent";
  text: string;
  timestamp: string;
}

export interface Interpretation {
  issue_summary: string;
  language: string;
  sentiment: Sentiment;
  urgency: Urgency;
  confidence: number;
  verification_text: string;
  agent_question: string;
  handover_recommended: boolean;
}

export interface SessionMetrics {
  confirmedInterpretations: number;
  correctedInterpretations: number;
  escalations: number;
}

export interface SessionRecord {
  id: string;
  transcriptTurns: TranscriptTurn[];
  finalSummary: string;
  agentNotes: string;
  sentiment: Sentiment;
  urgency: Urgency;
  confirmationStatus: ConfirmationStatus;
  humanOverride: boolean;
  createdAt: string;
}
