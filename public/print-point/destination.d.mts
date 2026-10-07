export type PrintDestination = ({ type: 'windows'; printer: string } | { type: 'tcp'; host: string; port: number }) & { cut?: boolean };
export function parseDestination(value: string): PrintDestination;
export function networkDestination(host: string, port?: string): string;
export const CONNECTION_PROBE: number[];
export function isConnectionProbe(bytes: Uint8Array): boolean;
export function withPrinterCut(printer: string, cut: boolean): string;
export function describeDestination(printer: string): string;
