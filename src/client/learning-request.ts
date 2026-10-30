import type { RefObject } from 'react';

export type PendingOperation = { signature: string; id: string } | null;
// Keep the same key on a network retry; edited payloads represent a new operation.
export function requestId(ref: RefObject<PendingOperation>, payload: unknown) {
  const signature = JSON.stringify(payload);
  if (ref.current?.signature !== signature) ref.current = { signature, id: crypto.randomUUID() };
  return ref.current.id;
}
