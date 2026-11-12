import type { ExecutarComando } from "./mdm.ts";

/**
 * O mínimo do 1Password no Mac (ADR-177), atrás de `NOD_1PASSWORD=1`. O bot pede um preenchimento por REFERÊNCIA
 * (`op://Cofre/Item/campo`) e nunca recebe o valor: o app do Mac lê com o `op` da pessoa e entrega o segredo direto a
 * quem preenche (o campo da página no navegador do computador do bot, pela ponte local), sem passar pelo servidor nem pelo
 * modelo. Antes de rodar o `op`, o app confere que o binário é o da AgileBits (assinatura de código com o Team ID dela,
 * como o launcher do Grok Bot faz): um `op` falso no PATH receberia a sessão do cofre.
 */
export const TEAM_ID_AGILEBITS = "2BUA8C4S2C";
export const CAMINHOS_OP = ["/opt/homebrew/bin/op", "/usr/local/bin/op"] as const;

/** `op://Cofre/Item/campo` (com seção opcional): nomes sem barra invertida, aspas, `$` ou controle; nunca vira shell. */
export function referenciaValida(ref: string): boolean {
  return /^op:\/\/[^/\\"'$`\p{Cc}]{1,100}\/[^/\\"'$`\p{Cc}]{1,100}(?:\/[^/\\"'$`\p{Cc}]{1,100}){1,2}$/u.test(ref);
}

/** O `codesign -dv` diz o Team ID na saída de erro; `--verify --strict` confere que a assinatura vale. */
export async function opDaAgileBits(caminho: string, executar: ExecutarComando): Promise<boolean> {
  const verifica = await executar("/usr/bin/codesign", ["--verify", "--strict", caminho]);
  if (verifica.codigo !== 0) return false;
  const info = await executar("/usr/bin/codesign", ["-dv", "--verbose=4", caminho]);
  return info.codigo === 0 && new RegExp(`^TeamIdentifier=${TEAM_ID_AGILEBITS}$`, "m").test(info.saida);
}

export type MotivoSemPreenchimento = "desligado" | "referencia_invalida" | "op_ausente" | "op_nao_confere" | "op_falhou";

/**
 * Lê o segredo e o entrega a `entregar` (quem preenche, no Mac). Devolve só se deu certo: o valor nunca volta a quem
 * chamou, e a função não o guarda. `existe` e `executar` são injetados (o teste não roda o `op` de verdade).
 */
export async function preencherCom1Password(o: {
  ligado: boolean;
  referencia: string;
  existe: (caminho: string) => Promise<boolean>;
  executar: ExecutarComando;
  entregar: (segredo: string) => Promise<void>;
}): Promise<{ ok: true } | { ok: false; motivo: MotivoSemPreenchimento }> {
  if (!o.ligado) return { ok: false, motivo: "desligado" };
  if (!referenciaValida(o.referencia)) return { ok: false, motivo: "referencia_invalida" };
  let op: string | null = null;
  for (const c of CAMINHOS_OP) if (await o.existe(c)) { op = c; break; }
  if (!op) return { ok: false, motivo: "op_ausente" };
  if (!(await opDaAgileBits(op, o.executar))) return { ok: false, motivo: "op_nao_confere" };
  const r = await o.executar(op, ["read", "--no-newline", o.referencia]);
  if (r.codigo !== 0) return { ok: false, motivo: "op_falhou" };
  await o.entregar(r.saida);
  return { ok: true };
}
