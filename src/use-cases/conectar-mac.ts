import type { ConectorGuardado } from "../contracts/conector.ts";
import { COMANDO_MAC_NATIVO, SLUG_MAC } from "../contracts/mac.ts";
import { conectorPublico } from "./registrar-conector.ts";
import type { Deps } from "./tipos.ts";

/**
 * ADR-171 (definido em 2026-11-12): o conector `mac` nasce no primeiro `pedir_acesso` a ele, como o `github` nativo da
 * ADR-048 — sem card de conexão e sem configuração: o catálogo é o contrato (`sondaMacNativa`). Nascer não liga nada no
 * Mac: as famílias continuam desligadas em Ajustes até a pessoa ligar, e o plano só mostra as ferramentas quando a
 * máquina do turno é um Mac dela (`ferramentasMacNoPlano`). O acesso do bot segue o card de sempre.
 *
 * Não mexe no que a pessoa desligou (catálogo sondado e desligado) nem num `mac` de outra pessoa ou com outro comando.
 */
export type ResultadoMacSemConfiguracao = { ok: true; conector: ConectorGuardado } | { ok: false; motivo: "desligado" | "outro" | "sonda_falhou" };

export async function garantirMacSemConfiguracao(deps: Deps): Promise<ResultadoMacSemConfiguracao> {
  const achado = await deps.repos.conectores.buscarPorSlug(SLUG_MAC);
  if (achado && (achado.ownerId !== deps.escopo.pessoaId || achado.comando !== COMANDO_MAC_NATIVO)) return { ok: false, motivo: "outro" };
  if (achado?.habilitado) return { ok: true, conector: achado };
  if (achado && achado.catalogo.length > 0) return { ok: false, motivo: "desligado" };
  // 'toca': e-mail, mensagens e contatos são dado pessoal de terceiros (ADR-002, default fechado).
  const nativo = achado ?? (await deps.repos.conectores.criar({ nome: "Mac", slug: SLUG_MAC, transporte: "stdio", comando: COMANDO_MAC_NATIVO, declaracao: "toca" }));
  if (!nativo) return { ok: false, motivo: "sonda_falhou" };
  const sonda = await deps.services.conectores.sondar(conectorPublico(nativo));
  const agora = deps.agora();
  const atualizado = await deps.repos.conectores.registrarSonda(nativo.id, sonda.ok ? { ok: true, catalogo: sonda.ferramentas, agora } : { ok: false, motivo: sonda.motivo, agora, ...(sonda.causa ? { causa: sonda.causa } : {}) });
  if (!sonda.ok || !atualizado) return { ok: false, motivo: "sonda_falhou" };
  return { ok: true, conector: atualizado };
}
