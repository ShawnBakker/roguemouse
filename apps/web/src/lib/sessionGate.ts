import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";

const SESSION_COOKIE = "rgm_session";
const triggered = new Map<string, string>();

export async function getOrCreateSessionId(): Promise<{ sessionId: string; isNew: boolean }> {
  const store = await cookies();
  const existing = store.get(SESSION_COOKIE)?.value;
  if (existing && typeof existing === "string" && existing.length > 0) {
    return { sessionId: existing, isNew: false };
  }
  const sessionId = randomUUID();
  store.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24,
  });
  return { sessionId, isNew: true };
}

export async function readSessionId(): Promise<string | null> {
  const store = await cookies();
  const value = store.get(SESSION_COOKIE)?.value;
  return value && value.length > 0 ? value : null;
}

export function hasTriggered(sessionId: string): boolean {
  return triggered.has(sessionId);
}

export function markTriggered(sessionId: string, runId: string): void {
  triggered.set(sessionId, runId);
}

export function getTriggeredRunId(sessionId: string): string | null {
  return triggered.get(sessionId) ?? null;
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  const existing = store.get(SESSION_COOKIE)?.value;
  if (existing) triggered.delete(existing);
  store.delete(SESSION_COOKIE);
}
