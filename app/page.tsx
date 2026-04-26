"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { callStageLabels, initialInterpretation, initialMetrics, initialTurns } from "@/lib/demo-data";
import {
  CallStage,
  ConfirmationStatus,
  Interpretation,
  SessionMetrics,
  TranscriptTurn
} from "@/lib/types";
import { makeId, nowIso, scoreToPercent } from "@/lib/utils";

type DemoScenario = {
  id: string;
  title: string;
  transcript: string;
};

const demoScenarios: DemoScenario[] = [
  {
    id: "dialect",
    title: "Dialect-heavy calm report",
    transcript:
      "Sir, nam area alli late night rowdy issue ide, people are shouting near the bus stand and families are scared."
  },
  {
    id: "mixed",
    title: "Hindi-English confusion",
    transcript:
      "Mujhe samajh nahi aa raha, police station mein complaint diya tha but abhi tak koi response nahi aaya and I need guidance."
  },
  {
    id: "distress",
    title: "High-distress urgent caller",
    transcript:
      "Please help immediately, one person is following me near the market and I am very scared right now."
  }
];

function getStagePill(stage: CallStage) {
  if (stage === "confirmed") return "pill pill-green";
  if (stage === "human_takeover") return "pill pill-red";
  if (stage === "understanding" || stage === "verifying") return "pill pill-amber";
  return "pill";
}

function getSignalPill(sentiment: string, urgency: string) {
  if (urgency === "high" || sentiment === "distress" || sentiment === "fear" || sentiment === "anger") {
    return "pill pill-red";
  }
  if (urgency === "medium" || sentiment === "confusion" || sentiment === "urgency") {
    return "pill pill-amber";
  }
  return "pill pill-green";
}

export default function HomePage() {
  const [callStage, setCallStage] = useState<CallStage>("idle");
  const [turns, setTurns] = useState<TranscriptTurn[]>(initialTurns);
  const [interpretation, setInterpretation] = useState<Interpretation>(initialInterpretation);
  const [metrics, setMetrics] = useState<SessionMetrics>(initialMetrics);
  const [citizenText, setCitizenText] = useState("");
  const [agentSummary, setAgentSummary] = useState("");
  const [agentNotes, setAgentNotes] = useState("");
  const [confirmationStatus, setConfirmationStatus] = useState<ConfirmationStatus>("pending");
  const [retryCount, setRetryCount] = useState(0);
  const [statusNote, setStatusNote] = useState("Waiting for the citizen to start the call.");
  const [isRecording, setIsRecording] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const turnsRef = useRef<TranscriptTurn[]>(initialTurns);
  const latestSummaryRef = useRef("");
  const latestNotesRef = useRef("");

  useEffect(() => {
    void loadMetrics();
  }, []);

  const latestCitizenText = useMemo(() => {
    const citizenTurns = turns.filter((turn) => turn.speaker === "citizen");
    return citizenTurns[citizenTurns.length - 1]?.text ?? "";
  }, [turns]);

  async function loadMetrics() {
    try {
      const response = await fetch("/api/feedback");
      if (!response.ok) return;
      const payload = (await response.json()) as { metrics?: SessionMetrics };
      if (payload.metrics) {
        setMetrics(payload.metrics);
      }
    } catch {
      // Ignore initial metric load failures in the MVP.
    }
  }

  function addTurn(speaker: TranscriptTurn["speaker"], text: string) {
    setTurns((current) => {
      const nextTurns = [
        ...current,
        {
          id: makeId(speaker),
          speaker,
          text,
          timestamp: nowIso()
        }
      ];
      turnsRef.current = nextTurns;
      return nextTurns;
    });
  }

  async function startRecording() {
    setStatusNote("Listening for the citizen in Kannada, Hindi, or English.");
    setCallStage("listening");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        stream.getTracks().forEach((track) => track.stop());
        setIsRecording(false);
        await processAudio(blob);
      };

      recorder.start();
      setIsRecording(true);
    } catch {
      setStatusNote("Microphone permission was unavailable. Use a demo scenario or type the citizen issue.");
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
    setStatusNote("Audio captured. Interpreting the issue now.");
  }

  async function processAudio(blob?: Blob, scenarioTranscript?: string) {
    setIsBusy(true);
    setCallStage("understanding");

    try {
      const audioDataUrl = blob ? await blobToDataUrl(blob) : undefined;
      const sttResponse = await fetch("/api/stt", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          audioDataUrl,
          transcriptHint: scenarioTranscript || citizenText
        })
      });

      const sttPayload = (await sttResponse.json()) as { text?: string; error?: string };
      const transcript = sttPayload.text?.trim();
      if (!transcript) {
        throw new Error(sttPayload.error || "No transcript received.");
      }

      addTurn("citizen", transcript);
      setCitizenText(transcript);
      await interpretAndVerify(transcript);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to process the caller audio.";
      setStatusNote(message);
      setCallStage("idle");
    } finally {
      setIsBusy(false);
    }
  }

  async function interpretAndVerify(transcript: string) {
    const localTurns = [
      ...turns,
      {
        id: makeId("citizen"),
        speaker: "citizen" as const,
        text: transcript,
        timestamp: nowIso()
      }
    ];

    const response = await fetch("/api/interpret", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        transcript,
        turns: localTurns
      })
    });

    const payload = (await response.json()) as Interpretation & { error?: string };
    if (!response.ok || payload.error) {
      throw new Error(payload.error || "Interpretation failed.");
    }

    setInterpretation(payload);
    setAgentSummary(payload.issue_summary);
    latestSummaryRef.current = payload.issue_summary;
    addTurn("ai", payload.verification_text);
    setConfirmationStatus("pending");
    setCallStage(payload.handover_recommended ? "human_takeover" : "verifying");
    setStatusNote(
      payload.handover_recommended
        ? "AI confidence is low or distress is high. Handing over to the human agent."
        : "AI has restated the issue and is waiting for confirmation."
    );

    if (audioEnabled) {
      void speakVerification(payload.verification_text);
    }
  }

  async function speakVerification(text: string) {
    const response = await fetch("/api/tts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ text })
    });

    const payload = (await response.json()) as { audioUrl?: string | null };
    if (payload.audioUrl) {
      new Audio(payload.audioUrl).play().catch(() => undefined);
    } else {
      const utterance = new SpeechSynthesisUtterance(text);
      window.speechSynthesis.speak(utterance);
    }
  }

  async function handleConfirmation(status: ConfirmationStatus) {
    setConfirmationStatus(status);

    if (status === "correct") {
      setCallStage("confirmed");
      setStatusNote("Citizen confirmed the interpretation. Agent can proceed confidently.");
      setMetrics((current) => ({
        ...current,
        confirmedInterpretations: current.confirmedInterpretations + 1
      }));
      await persistSession(status, false, { confirmedInterpretations: 1 });
      return;
    }

    const nextRetry = retryCount + 1;
    setRetryCount(nextRetry);

    if (nextRetry >= 2 || interpretation.confidence < 0.55) {
      setCallStage("human_takeover");
      setStatusNote("Repeated misunderstanding detected. Switching to full human-led handling.");
      setMetrics((current) => ({
        ...current,
        escalations: current.escalations + 1,
        correctedInterpretations: current.correctedInterpretations + 1
      }));
      await persistSession(status, true, {
        escalations: 1,
        correctedInterpretations: 1
      });
      return;
    }

    setStatusNote("Citizen signaled a mismatch. AI is ready for one corrected retry.");
    setCallStage("verifying");
  }

  async function persistSession(
    status: ConfirmationStatus,
    humanOverride: boolean,
    metricDelta: Partial<SessionMetrics>
  ) {
    await fetch("/api/feedback", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        record: {
          id: makeId("session"),
          transcriptTurns: turnsRef.current,
          finalSummary: latestSummaryRef.current || interpretation.issue_summary,
          agentNotes: latestNotesRef.current,
          sentiment: interpretation.sentiment,
          urgency: interpretation.urgency,
          confirmationStatus: status,
          humanOverride,
          createdAt: nowIso()
        },
        metrics: metricDelta
      })
    }).catch(() => undefined);
  }

  async function useScenario(scenario: DemoScenario) {
    setCitizenText(scenario.transcript);
    setStatusNote(`Loaded scenario: ${scenario.title}.`);
    await processAudio(undefined, scenario.transcript);
  }

  function resetSession() {
    setCallStage("idle");
    setTurns(initialTurns);
    setInterpretation(initialInterpretation);
    setCitizenText("");
    setAgentSummary("");
    setAgentNotes("");
    turnsRef.current = initialTurns;
    latestSummaryRef.current = "";
    latestNotesRef.current = "";
    setConfirmationStatus("pending");
    setRetryCount(0);
    setStatusNote("Session reset. Ready for the next caller.");
  }

  function markHumanTakeover() {
    setCallStage("human_takeover");
    setStatusNote("Human agent took control of the call.");
  }

  return (
    <main className="page-shell">
      <section className="hero">
        <div className="hero-card">
          <div className="eyebrow">Theme 12 • AI for 1092 Helpline</div>
          <h1>Understand first. Respond second.</h1>
          <p>
            This hackathon MVP acts as a multilingual call copilot for Karnataka’s 1092 helpline,
            verifying the citizen’s issue before the human agent takes action.
          </p>
          <div className="badge-row">
            <span className={getStagePill(callStage)}>{callStageLabels[callStage]}</span>
            <span className={getSignalPill(interpretation.sentiment, interpretation.urgency)}>
              {interpretation.sentiment} • {interpretation.urgency} urgency
            </span>
            <span className="badge">{scoreToPercent(interpretation.confidence)} confidence</span>
          </div>
          <div className="wave" />
          <div className="call-stage">{statusNote}</div>
          <div className="action-row">
            {!isRecording ? (
              <button className="primary-btn" onClick={startRecording} disabled={isBusy}>
                Start Call
              </button>
            ) : (
              <button className="danger-btn" onClick={stopRecording}>
                Stop Recording
              </button>
            )}
            <button className="ghost-btn" onClick={resetSession}>
              Reset Session
            </button>
            <button className="ghost-btn" onClick={() => setAudioEnabled((value) => !value)}>
              {audioEnabled ? "Voice Playback On" : "Voice Playback Off"}
            </button>
          </div>
        </div>

        <div className="hero-side">
          <div className="metrics-card">
            <h2>Impact Metrics</h2>
            <div className="metrics-grid">
              <div>
                <div className="section-title">Confirmed</div>
                <div className="metric-value">{metrics.confirmedInterpretations}</div>
              </div>
              <div>
                <div className="section-title">Corrected</div>
                <div className="metric-value">{metrics.correctedInterpretations}</div>
              </div>
              <div>
                <div className="section-title">Escalated</div>
                <div className="metric-value">{metrics.escalations}</div>
              </div>
            </div>
          </div>
          <div className="timeline-card">
            <h2>Demo Scenarios</h2>
            <div className="list">
              {demoScenarios.map((scenario) => (
                <button key={scenario.id} className="ghost-btn" onClick={() => void useScenario(scenario)}>
                  {scenario.title}
                </button>
              ))}
            </div>
            <div className="footer-note">
              Use these as reliable fallback paths during judging if live mic quality drops.
            </div>
          </div>
        </div>
      </section>

      <section className="panel-grid">
        <article className="panel">
          <h2>Citizen Panel</h2>
          <div className="mini-grid">
            <div>
              <div className="section-title">Current Stage</div>
              <div className="summary-text">{callStageLabels[callStage]}</div>
            </div>
            <div>
              <div className="section-title">Retry Count</div>
              <div className="summary-text">{retryCount}</div>
            </div>
          </div>
          <div className="section-title" style={{ marginTop: 16 }}>
            Transcript Hint / Typed Fallback
          </div>
          <textarea
            className="textarea"
            value={citizenText}
            onChange={(event) => setCitizenText(event.target.value)}
            placeholder="If needed, type or paste the citizen’s issue here before processing."
          />
          <div className="action-row" style={{ marginTop: 12 }}>
            <button
              className="secondary-btn"
              onClick={() => void processAudio(undefined, citizenText)}
              disabled={!citizenText.trim() || isBusy}
            >
              Process Typed Issue
            </button>
          </div>
          <div className="section-title" style={{ marginTop: 20 }}>
            Understanding Check
          </div>
          <div className="summary-box">{interpretation.verification_text}</div>
          <div className="confirm-row" style={{ marginTop: 12 }}>
            <button className="secondary-btn" onClick={() => void handleConfirmation("correct")}>
              Correct
            </button>
            <button className="ghost-btn" onClick={() => void handleConfirmation("partial")}>
              Partly Correct
            </button>
            <button className="danger-btn" onClick={() => void handleConfirmation("incorrect")}>
              Incorrect
            </button>
          </div>
          <div className="footer-note">Current citizen confirmation: {confirmationStatus}</div>
        </article>

        <article className="panel">
          <h2>AI Interpretation Panel</h2>
          <div className="mini-grid">
            <div className="turn">
              <div className="turn-speaker">Detected Language</div>
              <div>{interpretation.language}</div>
            </div>
            <div className="turn">
              <div className="turn-speaker">Recommended Next Question</div>
              <div>{interpretation.agent_question}</div>
            </div>
            <div className="turn">
              <div className="turn-speaker">Sentiment</div>
              <div>{interpretation.sentiment}</div>
            </div>
            <div className="turn">
              <div className="turn-speaker">Urgency</div>
              <div>{interpretation.urgency}</div>
            </div>
          </div>
          <div className="section-title" style={{ marginTop: 20 }}>
            Issue Summary
          </div>
          <div className="summary-box">{interpretation.issue_summary}</div>
          <div className="section-title" style={{ marginTop: 20 }}>
            Signal Notes
          </div>
          <div className="kpi">
            Handover recommended: {interpretation.handover_recommended ? "Yes" : "No"} • Latest citizen
            text: {latestCitizenText || "Waiting for input"}
          </div>
        </article>

        <article className="panel">
          <h2>Agent Dashboard</h2>
          <div className="section-title">Editable AI Summary</div>
          <textarea
            className="textarea"
            value={agentSummary}
            onChange={(event) => {
              setAgentSummary(event.target.value);
              latestSummaryRef.current = event.target.value;
            }}
            placeholder="Agent can refine the summary before proceeding."
          />
          <div className="section-title" style={{ marginTop: 20 }}>
            Agent Notes
          </div>
          <textarea
            className="textarea"
            value={agentNotes}
            onChange={(event) => {
              setAgentNotes(event.target.value);
              latestNotesRef.current = event.target.value;
            }}
            placeholder="Capture location, names, and any manual corrections."
          />
          <div className="action-row" style={{ marginTop: 12 }}>
            <button className="secondary-btn" onClick={() => void persistSession("correct", false, {})}>
              Approve Summary
            </button>
            <button className="ghost-btn" onClick={markHumanTakeover}>
              Take Over
            </button>
            <button
              className="danger-btn"
              onClick={() => setStatusNote("Agent flagged the AI sentiment as inaccurate and will proceed manually.")}
            >
              Mark Sentiment Wrong
            </button>
          </div>
        </article>
      </section>

      <section className="timeline-card" style={{ marginTop: 24 }}>
        <h2>Call Timeline</h2>
        <div className="timeline-list">
          {turns.map((turn) => (
            <div key={turn.id} className="timeline-item">
              <div className="timeline-time">
                {turn.speaker.toUpperCase()} • {new Date(turn.timestamp).toLocaleTimeString()}
              </div>
              <div>{turn.text}</div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

async function blobToDataUrl(blob: Blob) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Unable to read audio blob."));
    reader.readAsDataURL(blob);
  });
}
