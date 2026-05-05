"use client";

import { useEffect, useRef, useState } from "react";

interface Message {
  id: string;
  speaker: "user" | "ai";
  text: string;
  timestamp: string;
}

export default function VoiceChat() {
  const [mounted, setMounted] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      speaker: "ai",
      text: "Hello! I'm your AI assistant. Click the start button to begin speaking with me.",
      timestamp: "initial"
    }
  ]);
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [waveform, setWaveform] = useState<number[]>(Array(30).fill(0));
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState("");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const callTimerRef = useRef<NodeJS.Timeout | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Mount effect
  useEffect(() => {
    setMounted(true);
  }, []);

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Call duration timer
  useEffect(() => {
    if (isListening || isProcessing || isSpeaking) {
      callTimerRef.current = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
    } else {
      if (callTimerRef.current) clearInterval(callTimerRef.current);
    }
    return () => {
      if (callTimerRef.current) clearInterval(callTimerRef.current);
    };
  }, [isListening, isProcessing, isSpeaking]);

  const formatTime = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hrs.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const updateWaveform = () => {
    if (!analyserRef.current) return;

    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(dataArray);

    const sampled = [];
    const step = Math.floor(dataArray.length / 30);
    for (let i = 0; i < 30; i++) {
      const value = dataArray[i * step] || 0;
      sampled.push(value / 255);
    }

    setWaveform(sampled);

    if (isListening) {
      animationFrameRef.current = requestAnimationFrame(updateWaveform);
    }
  };

  const startListening = async () => {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { 
          echoCancellation: true, 
          noiseSuppression: true,
          autoGainControl: true 
        } 
      });
      streamRef.current = stream;

      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 2048;
      const source = audioContextRef.current.createMediaStreamSource(stream);
      source.connect(analyserRef.current);

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: "audio/webm;codecs=opus"
      });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        setIsListening(false);
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        stream.getTracks().forEach((track) => track.stop());
        
        if (blob.size > 100) {
          await processAudio(blob);
        } else {
          setError("No audio detected. Please try again.");
        }
      };

      mediaRecorder.start();
      setIsListening(true);
      setTranscript("Listening...");
      updateWaveform();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Microphone access denied";
      setError(`Microphone Error: ${errorMsg}`);
      console.error("Microphone error:", error);
    }
  };

  const stopListening = () => {
    if (mediaRecorderRef.current && isListening) {
      mediaRecorderRef.current.stop();
    }
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    setWaveform(Array(30).fill(0));
  };

  const blobToDataUrl = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  const processAudio = async (blob: Blob) => {
    setIsProcessing(true);
    setTranscript("Processing your voice...");
    setError("");
    
    try {
      // Convert audio to text
      const audioDataUrl = await blobToDataUrl(blob);
      
      const sttResponse = await fetch("/api/stt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audioDataUrl, transcriptHint: "" })
      });

      if (!sttResponse.ok) {
        throw new Error("Speech recognition failed");
      }

      const sttData = (await sttResponse.json()) as { text?: string };
      const userText = sttData.text?.trim();

      if (!userText) {
        setError("Could not understand. Please speak more clearly.");
        setIsProcessing(false);
        setTranscript("");
        return;
      }

      setTranscript(`You said: "${userText}"`);

      // Add user message
      const userMessage: Message = {
        id: `user-${Date.now()}`,
        speaker: "user",
        text: userText,
        timestamp: new Date().toISOString()
      };
      setMessages((prev) => [...prev, userMessage]);

      setTranscript("Getting AI response...");

      // Get AI response
      const aiResponse = await fetch("/api/voice-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userText,
          conversationHistory: [
            ...messages,
            userMessage
          ].map((m) => ({
            role: m.speaker === "user" ? "user" : "ai",
            content: m.text
          }))
        })
      });

      if (!aiResponse.ok) {
        throw new Error("AI response failed");
      }

      const aiData = (await aiResponse.json()) as { text?: string };
      const aiText = aiData.text?.trim() || "I'm sorry, I couldn't process that.";

      // Add AI message
      const aiMessage: Message = {
        id: `ai-${Date.now()}`,
        speaker: "ai",
        text: aiText,
        timestamp: new Date().toISOString()
      };
      setMessages((prev) => [...prev, aiMessage]);

      setTranscript("AI is speaking...");
      setIsSpeaking(true);

      // Convert AI response to speech and play
      await playVoiceResponse(aiText);

      setIsSpeaking(false);
      setTranscript("Ready for next message. Click Start Call!");
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      setError(errorMsg);
      console.error("Error:", error);

      const errorMessage: Message = {
        id: `error-${Date.now()}`,
        speaker: "ai",
        text: `Error: ${errorMsg}. Please try again.`,
        timestamp: new Date().toISOString()
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsProcessing(false);
      setTranscript("");
    }
  };

  const playVoiceResponse = async (text: string) => {
    try {
      const ttsResponse = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text })
      });

      if (ttsResponse.ok) {
        const ttsData = (await ttsResponse.json()) as { audioUrl?: string };

        if (ttsData.audioUrl) {
          const audio = new Audio(ttsData.audioUrl);
          audio.onended = () => {
            setIsSpeaking(false);
          };
          await audio.play();
          return;
        }
      }

      // Fallback to browser speech synthesis
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1;
      utterance.pitch = 1;
      utterance.onend = () => {
        setIsSpeaking(false);
      };
      window.speechSynthesis.speak(utterance);
    } catch (error) {
      console.error("TTS Error:", error);
      setIsSpeaking(false);
    }
  };

  const handleEndCall = () => {
    stopListening();
    window.speechSynthesis.cancel();
    setCallDuration(0);
    setTranscript("");
    setError("");
    setMessages([
      {
        id: "welcome",
        speaker: "ai",
        text: "Hello! I'm your AI assistant. Click the start button to begin speaking with me.",
        timestamp: "initial"
      }
    ]);
  };

  const isCallActive = isListening || isProcessing || isSpeaking || callDuration > 0;
  const statusText = isListening 
    ? "🎤 Listening..." 
    : isProcessing 
    ? "🔄 Processing..." 
    : isSpeaking 
    ? "🔊 Speaking..."
    : "Ready";

  return (
    <div className="voice-chat-container">
      {/* Header */}
      <div className="voice-call-header">
        <div className="header-content">
          <h1>🎤 Voice Call Assistant</h1>
          <p>Natural voice conversation with AI</p>
        </div>
        {isCallActive && (
          <div className="call-timer">
            <span className="pulse"></span>
            {formatTime(callDuration)}
          </div>
        )}
      </div>

      {/* Main Call Interface */}
      <div className="voice-call-main">
        <div className="call-avatar">
          <div className={`avatar-circle ${isListening ? "listening" : isProcessing ? "processing" : isSpeaking ? "speaking" : ""}`}>
            <span className="avatar-icon">🤖</span>
          </div>
          <p className="avatar-status">{statusText}</p>
        </div>

        {/* Waveform Visualizer */}
        <div className="waveform-container">
          <div className="waveform">
            {waveform.map((height, i) => (
              <div
                key={i}
                className="waveform-bar"
                style={{
                  height: `${Math.max(8, height * 100)}px`
                }}
              />
            ))}
          </div>
        </div>

        {/* Status Messages */}
        {transcript && (
          <div className="status-message">
            <p>{transcript}</p>
          </div>
        )}

        {error && (
          <div className="error-message">
            <p>⚠️ {error}</p>
          </div>
        )}

        {/* Call Controls */}
        <div className="call-controls">
          {!isListening && !isProcessing && !isSpeaking ? (
            <button
              className="call-button start-button"
              onClick={startListening}
              title="Click to start speaking"
            >
              <span className="button-icon">📞</span>
              <span className="button-text">Start Call</span>
            </button>
          ) : null}

          {isListening && (
            <button
              className="call-button stop-button"
              onClick={stopListening}
              title="Click to stop speaking"
            >
              <span className="button-icon">⏹️</span>
              <span className="button-text">Stop Speaking</span>
            </button>
          )}

          {isCallActive && (
            <button
              className="call-button end-button"
              onClick={handleEndCall}
              title="End the call"
            >
              <span className="button-icon">📵</span>
              <span className="button-text">End Call</span>
            </button>
          )}
        </div>
      </div>

      {/* Conversation Transcript */}
      <div className="voice-transcript">
        <h2>💬 Conversation</h2>
        <div className="transcript-messages">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`transcript-message message-${message.speaker}`}
            >
              <div className="message-speaker">
                {message.speaker === "user" ? "👤 You" : "🤖 AI"}
              </div>
              <div className="message-text">{message.text}</div>
              <div className="message-time">
                {message.timestamp === "initial" 
                  ? "Welcome"
                  : new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                }
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>
    </div>
  );
}
