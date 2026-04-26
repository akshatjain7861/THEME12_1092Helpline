function decodeDataUrl(dataUrl: string) {
  const [, payload = ""] = dataUrl.split(",");
  return Buffer.from(payload, "base64");
}

export async function transcribeAudio(audioDataUrl?: string, transcriptHint?: string) {
  const apiKey = process.env.SARVAM_API_KEY;
  const endpoint = process.env.SARVAM_STT_URL;

  if (!apiKey || !endpoint || !audioDataUrl) {
    return {
      text:
        transcriptHint?.trim() ||
        "Caller reports a local safety issue and requests urgent support in their own language.",
      source: "fallback"
    };
  }

  const audioBuffer = decodeDataUrl(audioDataUrl);
  const formData = new FormData();
  const blob = new Blob([audioBuffer], { type: "audio/webm" });
  formData.append("file", blob, "call.webm");
  formData.append("model", "saaras:v3");
  formData.append("language_code", "unknown");

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "api-subscription-key": apiKey
    },
    body: formData
  });

  if (!response.ok) {
    throw new Error(`Sarvam STT failed with ${response.status}`);
  }

  const payload = (await response.json()) as { transcript?: string; text?: string };
  return {
    text: payload.transcript ?? payload.text ?? transcriptHint ?? "",
    source: "sarvam"
  };
}

export async function synthesizeSpeech(text: string) {
  const apiKey = process.env.SARVAM_API_KEY;
  const endpoint = process.env.SARVAM_TTS_URL;

  if (!apiKey || !endpoint) {
    return { audioUrl: null, source: "disabled" };
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-subscription-key": apiKey
    },
    body: JSON.stringify({
      text,
      speaker: "anushka",
      language_code: "en-IN"
    })
  });

  if (!response.ok) {
    throw new Error(`Sarvam TTS failed with ${response.status}`);
  }

  const payload = (await response.json()) as { audio_url?: string; audioUrl?: string };
  return {
    audioUrl: payload.audio_url ?? payload.audioUrl ?? null,
    source: "sarvam"
  };
}
