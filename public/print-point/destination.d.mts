export type PrintDestination = { type: 'windows'; printer: string } | { type: 'tcp'; host: string; port: number };
export function parseDestination(value: string): PrintDestination;
export function networkDestination(host: string, port?: string): string;
export const CONNECTION_PROBE: number[];
export function isConnectionProbe(bytes: Uint8Array): boolean;
