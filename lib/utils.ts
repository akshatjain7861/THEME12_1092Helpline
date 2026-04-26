export function makeId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function scoreToPercent(confidence: number) {
  return `${Math.round(confidence * 100)}%`;
}
