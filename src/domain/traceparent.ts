/**
 * ADR-171 (definido em 2026-11-12): `traceparent` W3C (Trace Context, versão 00) entre o motor e o servidor, propagado
 * até o gateway. O trace-id de um turno é o PRÓPRIO id do turno sem hífens (um UUID tem os 32 hex
 * de um trace-id): servidor e motor chegam ao mesmo trace sem campo novo no plano, e uma ferramenta de OTEL junta os dois
 * lados pelo turno. O span-id muda a cada chamada. Puro: os bytes aleatórios vêm de fora.
 */
const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Rastro = { traceId: string; spanId: string; amostrado: boolean };

export function lerTraceparent(v: unknown): Rastro | null {
  if (typeof v !== "string") return null;
  const m = TRACEPARENT.exec(v.trim().toLowerCase());
  if (!m || /^0+$/.test(m[1]!) || /^0+$/.test(m[2]!)) return null;
  return { traceId: m[1]!, spanId: m[2]!, amostrado: (parseInt(m[3]!, 16) & 1) === 1 };
}

/** O trace do turno: o id dele sem hífens. Id que não é UUID não gera trace. */
export function traceDoTurno(turnoId: string): string | null {
  return UUID.test(turnoId) ? turnoId.replace(/-/g, "").toLowerCase() : null;
}

/** `spanHex`: 16 hex aleatórios de quem chama (crypto.randomBytes(8)). */
export function traceparentDoTurno(turnoId: string, spanHex: string): string | null {
  const trace = traceDoTurno(turnoId);
  if (!trace || !/^[0-9a-f]{16}$/.test(spanHex) || /^0+$/.test(spanHex)) return null;
  return `00-${trace}-${spanHex}-01`;
}
