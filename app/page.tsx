"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
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

type ConsoleView = "dashboard" | "summary" | "analytics" | "training";

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

const waveformHeights = [14, 26, 18, 32, 22, 38, 48, 30, 56, 42, 28, 62, 36, 24, 46, 34, 58, 40, 22, 30, 50, 68, 44, 28, 36, 52, 24, 18, 42, 30, 64, 46, 34, 22, 28, 48, 72, 54, 36, 26, 44, 32, 20, 30, 26, 18];

function getStagePill(stage: CallStage) {
  if (stage === "confirmed") return "ops-pill ops-pill-green";
  if (stage === "human_takeover") return "ops-pill ops-pill-red";
  if (stage === "understanding" || stage === "verifying") return "ops-pill ops-pill-amber";
  return "ops-pill";
}

function getSignalPill(sentiment: string, urgency: string) {
  if (urgency === "high" || sentiment === "distress" || sentiment === "fear" || sentiment === "anger") {
    return "ops-pill ops-pill-red";
  }
  if (urgency === "medium" || sentiment === "confusion" || sentiment === "urgency") {
    return "ops-pill ops-pill-amber";
  }
  return "ops-pill ops-pill-green";
}

function formatClock(timestamp: string) {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function HomePage() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [view, setView] = useState<ConsoleView>("dashboard");
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

  const confidence = scoreToPercent(interpretation.confidence);
  const liveState = isRecording || isBusy || callStage !== "idle";
  const urgencyLabel = interpretation.urgency.toUpperCase();
  const sentimentLabel = interpretation.sentiment.charAt(0).toUpperCase() + interpretation.sentiment.slice(1);

  async function loadMetrics() {
    try {
      const response = await fetch("/api/feedback");
      if (!response.ok) return;
      const payload = (await response.json()) as { metrics?: SessionMetrics };
      if (payload.metrics) {
        setMetrics(payload.metrics);
      }
    } catch {
      // Metrics are helpful for the demo, but should never block the console.
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

  function endCallToSummary() {
    setCallStage("confirmed");
    setStatusNote("Call ended. Summary is ready for supervisor review and escalation.");
    setView("summary");
  }

  if (!isLoggedIn) {
    return (
      <main className="login-shell">
        <header className="login-topbar">
          <div className="ops-brand">
            <div className="ops-emblem" aria-hidden="true">1092</div>
            <div>
              <span>Government of Karnataka</span>
              <strong>1092 AI Assist</strong>
            </div>
          </div>
          <span>Secure Agent Console</span>
        </header>

        <section className="login-grid">
          <div className="login-visual">
            <div className="login-operator" aria-hidden="true">
              <div className="login-face" />
              <div className="login-headset" />
            </div>
            <div className="login-wave" aria-hidden="true">
              {waveformHeights.slice(0, 28).map((height, index) => (
                <span
                  key={index}
                  style={{ "--bar": index, "--height": `${Math.max(12, height - 12)}px` } as CSSProperties}
                />
              ))}
            </div>
            <div className="login-bubbles">
              <span>Kannada</span>
              <span>Hindi</span>
              <span>English</span>
              <span>Dialect AI</span>
            </div>
            <h1>AI-assisted understanding for every 1092 call.</h1>
            <p>Operators get verified meaning, emotional context, and safe escalation controls before action is taken.</p>
          </div>

          <form
            className="login-card"
            onSubmit={(event) => {
              event.preventDefault();
              setIsLoggedIn(true);
              setView("dashboard");
            }}
          >
            <span className="login-eyebrow">Agent Console Login</span>
            <h2>Start Shift</h2>
            <label>
              Agent ID
              <input type="text" defaultValue="KAVYA-R-1092" />
            </label>
            <label>
              Password
              <input type="password" defaultValue="secure-demo" />
            </label>
            <label>
              Language Preference
              <select defaultValue="kn">
                <option value="kn">Kannada + English</option>
                <option value="hi">Hindi + English</option>
                <option value="en">English</option>
              </select>
            </label>
            <button className="ops-primary" type="submit">Login to Live Dashboard</button>
            <small>Demo login is enabled for hackathon judging.</small>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="ops-shell">
      <header className="ops-topbar">
        <div className="ops-brand">
          <div className="ops-emblem" aria-hidden="true">1092</div>
          <div>
            <span>Government of Karnataka</span>
            <strong>1092 AI HELPLINE</strong>
          </div>
        </div>
        <div className="ops-live-strip">
          <span className={liveState ? "ops-live-badge" : "ops-live-badge ops-live-muted"}>
            {liveState ? "LIVE" : "READY"}
          </span>
          <strong>{liveState ? "LIVE CALL IN PROGRESS" : "AI CALL DESK STANDBY"}</strong>
          <div className={`ops-mini-wave ${liveState ? "ops-mini-wave-live" : ""}`} aria-hidden="true">
            {Array.from({ length: 7 }, (_, index) => <span key={index} />)}
          </div>
        </div>
        <div className="ops-agent-card">
          <div className="ops-headset" aria-hidden="true" />
          <div>
            <span>Agent: Kavya R</span>
            <strong>Online</strong>
          </div>
          <Link href="/voice">Voice</Link>
        </div>
        <button className="ops-end-btn" onClick={endCallToSummary}>End Call</button>
      </header>

      <nav className="ops-view-nav" aria-label="Console views">
        <button className={view === "dashboard" ? "ops-view-active" : ""} onClick={() => setView("dashboard")}>Live Dashboard</button>
        <button className={view === "summary" ? "ops-view-active" : ""} onClick={() => setView("summary")}>Call Summary</button>
        <button className={view === "analytics" ? "ops-view-active" : ""} onClick={() => setView("analytics")}>Analytics</button>
        <button className={view === "training" ? "ops-view-active" : ""} onClick={() => setView("training")}>Training Feedback</button>
      </nav>

      {view === "dashboard" && (
        <>
      <section className="ops-grid">
        <aside className="ops-panel ops-left-panel">
          <h2>Caller Information</h2>
          <div className="ops-info-list">
            <div><span>Call ID</span><strong>1092-25-05-21-00124</strong></div>
            <div><span>Phone Number</span><strong>+91 98XXXX 5678</strong></div>
            <div><span>Call Duration</span><strong>02:18</strong></div>
            <div><span>Detected Language</span><strong className="ops-chip-green">{interpretation.language}</strong></div>
            <div><span>Dialect Prob.</span><strong className="ops-chip-blue">North Karnataka ({confidence || "72%"})</strong></div>
          </div>
          <div className="ops-score-ring" style={{ "--score": interpretation.confidence || 0.72 } as CSSProperties}>
            <span>{confidence || "72%"}</span>
          </div>
          <div className="ops-alert-card">
            <div className="ops-alert-icon" aria-hidden="true">!</div>
            <div>
              <span>Emotion Detected</span>
              <strong>{sentimentLabel}</strong>
              <em>{interpretation.urgency === "high" ? "High Stress" : "Signal monitored"}</em>
            </div>
          </div>
          <div className="ops-info-list">
            <div><span>Urgency</span><strong className="ops-chip-red">{urgencyLabel}</strong></div>
          </div>
          <button className="ops-wide-action" onClick={() => void useScenario(demoScenarios[2])}>Run Judge Demo</button>
        </aside>

        <section className="ops-main-panel">
          <div className="ops-call-status">
            <div className={getSignalPill(interpretation.sentiment, interpretation.urgency)}>
              Citizen Speaking...
            </div>
            <div className="ops-timer">02:18</div>
            <div className="ops-listening">AI Listening</div>
          </div>

          <div className={`ops-waveform ${liveState ? "ops-waveform-live" : ""}`} aria-hidden="true">
            {waveformHeights.map((height, index) => (
              <span
                key={index}
                style={{ "--bar": index, "--height": `${height}px` } as CSSProperties}
              />
            ))}
            <div className="ops-ai-orb"><span /></div>
          </div>

          <div className="ops-tabs">
            <span>Live Transcript</span>
            <strong>AI Interpretation</strong>
            <label>
              Auto Scroll
              <input type="checkbox" defaultChecked />
            </label>
          </div>

          <div className="ops-transcript">
            <article className="ops-turn">
              <div className="ops-avatar ops-avatar-human" aria-hidden="true">C</div>
              <div>
                <header><strong>Citizen</strong><time>10:14:22 AM</time></header>
                <p>{latestCitizenText || "Sir, namma oorinalli mooru dinadinda neeru bartilla..."}</p>
                <small>{citizenText || "Use the microphone, typed fallback, or a demo scenario to fill this live transcript."}</small>
              </div>
            </article>
            <article className="ops-turn">
              <div className="ops-avatar ops-avatar-ai" aria-hidden="true">AI</div>
              <div>
                <header><strong>AI Interpretation</strong><time>10:14:24 AM</time></header>
                <p>{interpretation.issue_summary}</p>
              </div>
            </article>
            <article className="ops-verification">
              <header>
                <div className="ops-avatar ops-avatar-orb" aria-hidden="true">AI</div>
                <div><strong>AI Verification</strong><time>10:14:26 AM</time></div>
              </header>
              <p>{interpretation.verification_text}</p>
              <div className="ops-confirm-row">
                <button className="ops-confirm-good" onClick={() => void handleConfirmation("correct")}>Yes, Correct</button>
                <button className="ops-confirm-mid" onClick={() => void handleConfirmation("partial")}>Partially Correct</button>
                <button className="ops-confirm-bad" onClick={() => void handleConfirmation("incorrect")}>No, Incorrect</button>
              </div>
              <small>Feedback status: {confirmationStatus}</small>
            </article>
          </div>

          <div className="ops-control-deck">
            <div className="ops-mic-card">
              <div className={`ops-glow-mic ${isRecording ? "ops-mic-live" : ""}`} />
              <div><span>Citizen Mic</span><strong>{isRecording ? "Active" : "Ready"}</strong></div>
            </div>
            <div className="ops-ai-response">
              <div className="ops-ai-button"><span /></div>
              <div>
                <strong>{isBusy ? "AI is Responding..." : callStageLabels[callStage]}</strong>
                <small>{statusNote}</small>
              </div>
            </div>
            <div className="ops-action-stack">
              {!isRecording ? (
                <button className="ops-primary" onClick={startRecording} disabled={isBusy}>Start Call</button>
              ) : (
                <button className="ops-danger" onClick={stopRecording}>Stop Recording</button>
              )}
              <button className="ops-secondary" onClick={() => setAudioEnabled((value) => !value)}>
                Playback {audioEnabled ? "On" : "Off"}
              </button>
              <button className="ops-takeover" onClick={markHumanTakeover}>Take Over Call</button>
            </div>
          </div>
        </section>

        <aside className="ops-side-stack">
          <section className="ops-panel">
            <h2>AI Insights</h2>
            <div className="ops-insight-row">
              <span>Sentiment</span>
              <strong className="ops-red-text">{sentimentLabel}</strong>
            </div>
            <div className="ops-confidence">
              <span>Confidence</span>
              <strong>{confidence || "72%"}</strong>
              <em>{interpretation.confidence >= 0.75 ? "High Confidence" : "Medium Confidence"}</em>
            </div>
            <div className="ops-insight-row">
              <span>Urgency Level</span>
              <strong className="ops-chip-red">{urgencyLabel}</strong>
            </div>
            <div className="ops-recommend">
              <span>Recommended Action</span>
              <strong>{interpretation.handover_recommended ? "Switch to Human Agent" : "Create verified service ticket"}</strong>
            </div>
          </section>

          <section className="ops-panel">
            <h2>Quick Actions</h2>
            <div className="ops-quick-grid">
              <button onClick={() => void persistSession("correct", false, {})}>Create Ticket</button>
              <button onClick={() => void useScenario(demoScenarios[0])}>Check Status</button>
              <button onClick={markHumanTakeover}>Escalate Call</button>
              <button onClick={() => setStatusNote("Agent added a note to the live case.")}>Add Note</button>
            </div>
          </section>

          <section className="ops-panel">
            <h2>AI Suggested Response</h2>
            <p className="ops-suggested">{interpretation.agent_question}</p>
            <button className="ops-wide-action" onClick={() => void speakVerification(interpretation.agent_question)}>
              Use This Response
            </button>
          </section>

          <section className="ops-panel">
            <h2>Notes</h2>
            <textarea
              className="ops-textarea"
              value={agentNotes}
              onChange={(event) => {
                setAgentNotes(event.target.value);
                latestNotesRef.current = event.target.value;
              }}
              placeholder="Type your notes here..."
            />
            <button className="ops-secondary" onClick={() => void persistSession("correct", false, {})}>Save Note</button>
          </section>
        </aside>
      </section>

      <section className="ops-bottom-grid">
        <div className="ops-panel ops-timeline-panel">
          <h2>Call Timeline</h2>
          <div className="ops-timeline">
            {turns.map((turn, index) => (
              <div key={turn.id} className={`ops-timeline-item ops-timeline-${turn.speaker}`}>
                <span>{formatClock(turn.timestamp)}</span>
                <strong>{index === 0 ? "Call Connected" : turn.speaker === "ai" ? "AI Interpretation" : "Citizen Input"}</strong>
                <small>{turn.text}</small>
              </div>
            ))}
            <div className="ops-timeline-item ops-timeline-next">
              <span>Next Step</span>
              <strong>{callStageLabels[callStage]}</strong>
              <small>{statusNote}</small>
            </div>
          </div>
        </div>

        <div className="ops-panel ops-fallback-panel">
          <h2>Typed Fallback</h2>
          <textarea
            className="ops-textarea"
            value={citizenText}
            onChange={(event) => setCitizenText(event.target.value)}
            placeholder="Type or paste the citizen issue before processing."
          />
          <div className="ops-fallback-actions">
            <button
              className="ops-primary"
              onClick={() => void processAudio(undefined, citizenText)}
              disabled={!citizenText.trim() || isBusy}
            >
              Process Issue
            </button>
            <button className="ops-secondary" onClick={resetSession}>Reset</button>
          </div>
          <div className="ops-demo-links">
            {demoScenarios.map((scenario) => (
              <button key={scenario.id} onClick={() => void useScenario(scenario)}>{scenario.title}</button>
            ))}
          </div>
        </div>
      </section>
        </>
      )}

      {view === "summary" && (
        <section className="ops-detail-screen">
          <div className="ops-panel ops-summary-hero">
            <span className={getStagePill(callStage)}>{callStageLabels[callStage]}</span>
            <h1>Call Summary</h1>
            <p>{agentSummary || interpretation.issue_summary}</p>
            <div className="ops-summary-actions">
              <button className="ops-primary" onClick={() => void persistSession("correct", false, {})}>Save Record</button>
              <button className="ops-secondary" onClick={() => setStatusNote("PDF export queued for the supervisor desk.")}>Download PDF</button>
              <button className="ops-takeover" onClick={markHumanTakeover}>Send Escalation</button>
            </div>
          </div>
          <div className="ops-summary-grid">
            <article className="ops-panel"><h2>Issue Type</h2><strong>{interpretation.issue_summary}</strong></article>
            <article className="ops-panel"><h2>Language</h2><strong>{interpretation.language}</strong><span>Dialect: North Karnataka ({confidence || "72%"})</span></article>
            <article className="ops-panel"><h2>Emotion Timeline</h2><strong>{sentimentLabel}</strong><span>Urgency: {urgencyLabel}</span></article>
            <article className="ops-panel"><h2>AI Accuracy</h2><strong>{confirmationStatus}</strong><span>Confidence: {confidence || "72%"}</span></article>
            <article className="ops-panel"><h2>Resolution</h2><strong>{interpretation.handover_recommended ? "Escalated to human agent" : "Verified for ticket creation"}</strong></article>
          </div>
        </section>
      )}

      {view === "analytics" && (
        <section className="ops-detail-screen">
          <div className="ops-panel ops-summary-hero">
            <h1>Supervisor Analytics</h1>
            <p>Complaint patterns, language load, distress signals, and AI accuracy for 1092 operations.</p>
          </div>
          <div className="ops-chart-grid">
            <article className="ops-panel ops-bar-chart">
              <h2>Most Common Complaints</h2>
              <div><span style={{ width: "82%" }}>Water Supply</span></div>
              <div><span style={{ width: "64%" }}>Public Safety</span></div>
              <div><span style={{ width: "48%" }}>Electricity</span></div>
            </article>
            <article className="ops-panel ops-donut-card">
              <h2>Language Distribution</h2>
              <div className="ops-donut" />
              <p>Kannada 58% | Hindi 22% | English 20%</p>
            </article>
            <article className="ops-panel ops-bar-chart">
              <h2>Distress Trends</h2>
              <div><span style={{ width: "72%" }}>High Stress</span></div>
              <div><span style={{ width: "45%" }}>Fear</span></div>
              <div><span style={{ width: "30%" }}>Anger</span></div>
            </article>
            <article className="ops-panel ops-donut-card">
              <h2>AI Accuracy</h2>
              <strong className="ops-big-number">91%</strong>
              <p>Based on citizen confirmation and agent corrections.</p>
            </article>
          </div>
        </section>
      )}

      {view === "training" && (
        <section className="ops-detail-screen">
          <div className="ops-panel ops-summary-hero">
            <h1>AI Training Feedback</h1>
            <p>Agents can correct interpretation, translation, and emotion labels so the system learns from verified feedback.</p>
          </div>
          <div className="ops-training-grid">
            <label className="ops-panel">
              <h2>Corrected Interpretation</h2>
              <textarea
                className="ops-textarea"
                value={agentSummary}
                onChange={(event) => {
                  setAgentSummary(event.target.value);
                  latestSummaryRef.current = event.target.value;
                }}
                placeholder="Write the corrected issue summary..."
              />
            </label>
            <label className="ops-panel">
              <h2>Better Translation</h2>
              <textarea className="ops-textarea" defaultValue={latestCitizenText || citizenText} />
            </label>
            <label className="ops-panel">
              <h2>Emotion Label</h2>
              <select className="ops-select" defaultValue={interpretation.sentiment}>
                <option value="distress">Distress</option>
                <option value="fear">Fear</option>
                <option value="anger">Anger</option>
                <option value="confusion">Confusion</option>
                <option value="calm">Calm</option>
              </select>
            </label>
          </div>
          <button className="ops-primary ops-training-save" onClick={() => void persistSession("partial", false, { correctedInterpretations: 1 })}>
            Submit Feedback
          </button>
        </section>
      )}

      <footer className="ops-footer">
        <strong>Bharat listens. <span>Bharat responds.</span></strong>
        <span>AI Powered | Citizen First | Always Here</span>
        <span>1092 Helpline | Government of Karnataka</span>
      </footer>
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
