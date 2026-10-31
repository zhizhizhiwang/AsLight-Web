import type { Bindings } from './bindings.ts';
export type AdminActor = { id: string; credentialVersion: number; sessionId: string };
export type AdminContext = { Bindings: Bindings; Variables: { actor: AdminActor } };
