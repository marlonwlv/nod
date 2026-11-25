import type { OndeRodaDto } from "../contracts/rotina.ts";
import type { PlataformaMaquina } from "../contracts/ponte.ts";
import { ehMaquinaDoMotor } from "./plataforma-maquina.ts";

/** Uma chave de máquina viva (não revogada, não vencida) da pessoa, com o sistema que a máquina anunciou. */
export type MaquinaViva = { id: string; nome: string; plataforma: PlataformaMaquina | null };

/**
 * NOD-89 (corte 1, definido em 2026-10-22): onde a rotina de um bot roda. Puro.
 * - Alvo (a máquina do bot ou o padrão da pessoa, `alvoDoBot`) Linux ou Windows (ADR-147): não depende do Mac.
 * - Alvo Mac ou de plataforma desconhecida: depende (null conta como darwin, a mesma convenção do `compor.ts`).
 * - Sem alvo ("qualquer máquina") com alguma Linux viva: a primeira que estiver ligada leva — não depende.
 * - "Qualquer" sem Linux: nomeia o primeiro Mac vivo e depende do Mac; sem Mac e com um PC Windows vivo, nomeia o PC e
 *   não depende do Mac; sem máquina nenhuma = "seu Mac".
 * "Linux viva" é a chave persistida (não a presença do momento): a linha não pisca quando a VM perde um contato.
 */
export function ondeRodaDaRotina(alvo: { id: string; nome: string } | null, vivas: readonly MaquinaViva[]): OndeRodaDto {
  if (alvo) {
    const plataforma = vivas.find((m) => m.id === alvo.id)?.plataforma ?? null;
    return { modo: "maquina", maquina: { id: alvo.id, nome: alvo.nome, plataforma }, dependeDoMac: !ehMaquinaDoMotor(plataforma) };
  }
  if (vivas.some((m) => m.plataforma === "linux")) return { modo: "qualquer", maquina: null, dependeDoMac: false };
  // ADR-147: o PC com Windows não é o Mac nem um servidor sempre ligado — com um Mac vivo, o Mac é nomeado.
  const mac = vivas.find((m) => !ehMaquinaDoMotor(m.plataforma)) ?? null;
  if (mac) return { modo: "qualquer", maquina: { id: mac.id, nome: mac.nome, plataforma: mac.plataforma }, dependeDoMac: true };
  // QA do rc.10 no Windows (PR #333, achado 1): só PC com Windows vivo — é ele que reivindica o turno do "qualquer"
  // (o motor dele roda pela tarefa agendada, sem o app aberto). Não depende do Mac nem vira "seu Mac".
  const pc = vivas.find((m) => m.plataforma === "win32") ?? null;
  if (pc) return { modo: "qualquer", maquina: { id: pc.id, nome: pc.nome, plataforma: pc.plataforma }, dependeDoMac: false };
  return { modo: "qualquer", maquina: null, dependeDoMac: true };
}
