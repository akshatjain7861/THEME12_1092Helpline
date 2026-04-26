import { promises as fs } from "fs";
import path from "path";
import { SessionMetrics, SessionRecord } from "@/lib/types";

const dataDir = path.join(process.cwd(), "data");
const sessionsFile = path.join(dataDir, "sessions.json");

interface PersistedData {
  sessions: SessionRecord[];
  metrics: SessionMetrics;
}

const defaultData: PersistedData = {
  sessions: [],
  metrics: {
    confirmedInterpretations: 0,
    correctedInterpretations: 0,
    escalations: 0
  }
};

async function ensureStore() {
  await fs.mkdir(dataDir, { recursive: true });

  try {
    await fs.access(sessionsFile);
  } catch {
    await fs.writeFile(sessionsFile, JSON.stringify(defaultData, null, 2), "utf8");
  }
}

export async function readStore(): Promise<PersistedData> {
  await ensureStore();
  const raw = await fs.readFile(sessionsFile, "utf8");
  return JSON.parse(raw) as PersistedData;
}

export async function writeStore(data: PersistedData) {
  await ensureStore();
  await fs.writeFile(sessionsFile, JSON.stringify(data, null, 2), "utf8");
}

export async function appendSession(record: SessionRecord, updates?: Partial<SessionMetrics>) {
  const store = await readStore();
  store.sessions.unshift(record);

  if (updates) {
    store.metrics = {
      confirmedInterpretations:
        store.metrics.confirmedInterpretations + (updates.confirmedInterpretations ?? 0),
      correctedInterpretations:
        store.metrics.correctedInterpretations + (updates.correctedInterpretations ?? 0),
      escalations: store.metrics.escalations + (updates.escalations ?? 0)
    };
  }

  await writeStore(store);
  return store;
}
