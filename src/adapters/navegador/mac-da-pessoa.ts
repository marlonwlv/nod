import type { FonteCofre, OpcaoLogin } from "../../contracts/navegador-do-bot.ts";
import { FONTES_DO_MAC, type CookieNavegador, type FonteDoMac } from "../../contracts/navegador-maquina.ts";
import { aparelhoDaPlataforma, MOTIVO_BITWARDEN_TRAVADO, OPCOES_MAX, type AparelhoDaPessoa } from "../../domain/navegador-cofre.ts";
import type { Escopo } from "../../shared/types.ts";
import type { CanalNavegador, PedidoNavegadorMaquina } from "./canal-maquina.ts";
import { FalhaNavegador } from "./motor-agent-browser.ts";
import { lerCookies } from "./operacoes-remotas.ts";

/**
 * O app do Mac da pessoa visto do servidor (ADR-177, ADR-190 decisão 6): o cofre dela (1Password e Bitwarden), os
 * cookies do Chrome dela e o Touch ID, cada um um comando na fila do navegador daquela máquina (`canal-maquina.ts`, a
 * mesma do navegador remoto; ADR-021, a máquina puxa). "O Mac está ligado" = o app faz o long-poll do navegador agora.
 *
 * Nenhum segredo é guardado aqui: `ler` devolve o usuário e a senha a quem chamou (o portão, que preenche na hora e
 * esquece); `guardar` leva a senha que a pessoa digitou ao Mac uma vez.
 */
export type MacDaPessoa = {
  /** O Mac ou o PC da pessoa com o app conectado e o navegador ligado agora, ou null. */
  maquina(escopo: Escopo): string | null;
  /** 2026-11-22: qual aparelho está ligado agora (o Mac ou o PC); null = nenhum. */
  aparelho?(escopo: Escopo): AparelhoDaPessoa | null;
  /** Os itens que casam com o host (sem segredo). null = o Mac não respondeu a tempo. */
  listar(escopo: Escopo, agenteId: string, host: string): Promise<OpcaoLogin[] | null>;
  /** Lê e preenche no navegador do bot QUE RODA NESTE Mac (o segredo não sai dele). */
  preencher(escopo: Escopo, agenteId: string, fonte: FonteDoMac, ref: string, host: string): Promise<{ usuario: boolean; senha: boolean }>;
  /** Lê e devolve (o navegador roda em outro lugar): o portão preenche e esquece. */
  ler(escopo: Escopo, agenteId: string, fonte: FonteDoMac, ref: string, host: string): Promise<{ usuario: string; senha: string }>;
  guardar(escopo: Escopo, agenteId: string, fonte: FonteDoMac, site: string, usuario: string, senha: string): Promise<void>;
  /** `aplicar`: o navegador do bot roda neste Mac e os cookies vão direto para ele (volta o número); senão, voltam os cookies. */
  cookies(escopo: Escopo, agenteId: string, host: string, aplicar: boolean): Promise<CookieNavegador[] | number>;
  /** "confirmado" | "recusado"; "sem_mac" = o app não está conectado (vale a confirmação comum, com o aviso). */
  touchId(escopo: Escopo, agenteId: string, motivo: string): Promise<"confirmado" | "recusado" | "sem_mac">;
};

/**
 * definido em 2026-11-20: a lista do cartão espera pouco (o cartão aparece com o que veio; o 1Password travado responde
 * depois de pedir o Touch ID, e aí a opção genérica serve). Ler e o Touch ID esperam a pessoa no Mac: 90 s e 60 s.
 */
export const PRAZO_LISTAR_MS = 8_000;
export const PRAZO_LER_MS = 90_000;
export const PRAZO_TOUCH_ID_MS = 60_000;
export const PRAZO_CHROME_MS = 60_000;

const obj = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");
const ehFonteDoMac = (v: unknown): v is FonteDoMac => typeof v === "string" && (FONTES_DO_MAC as readonly string[]).includes(v);

/** As opções que vieram do Mac, conferidas: só 1Password e Bitwarden, rótulo curto, referência sem controle. */
export function lerOpcoesDoMac(v: unknown): OpcaoLogin[] {
  const lista = Array.isArray(obj(v).opcoes) ? (obj(v).opcoes as unknown[]) : [];
  return lista.slice(0, OPCOES_MAX * 2).flatMap((x) => {
    const o = obj(x);
    if (!ehFonteDoMac(o.fonte) || typeof o.ref !== "string" || o.ref.length > 300 || /[\p{Cc}]/u.test(o.ref)) return [];
    const disponivel = o.disponivel !== false;
    const motivo = str(o.motivoIndisponivel, 80);
    const fonte: FonteCofre = o.fonte;
    return [{ fonte, ref: o.ref, rotulo: str(o.rotulo, 120) || (fonte === "1password" ? "1Password" : "Bitwarden"), disponivel, ...(!disponivel ? { motivoIndisponivel: motivo || MOTIVO_BITWARDEN_TRAVADO } : {}) }];
  });
}

export function criarMacDaPessoa(o: { canal: CanalNavegador }): MacDaPessoa {
  // 2026-11-22 (o navegador no PC): o aparelho é o app do Mac ou o motor do Windows (o PC da pessoa); a máquina Linux
  // sempre ligada não tem cofre, Chrome da pessoa nem confirmação.
  const doAparelho = (escopo: Escopo) => o.canal.ligadas(escopo).find((m) => m.plataforma === "darwin" || m.plataforma === "win32") ?? null;
  const maquina = (escopo: Escopo) => doAparelho(escopo)?.maquinaId ?? null;
  const aparelho = (escopo: Escopo): AparelhoDaPessoa | null => { const m = doAparelho(escopo); return m ? aparelhoDaPlataforma(m.plataforma) : null; };

  async function enviar(escopo: Escopo, pedido: PedidoNavegadorMaquina, prazoMs: number): Promise<unknown> {
    const id = maquina(escopo);
    if (!id) throw new FalhaNavegador("indisponivel", "o seu Mac ou PC não está ligado");
    const r = await o.canal.enviar(escopo, id, pedido, prazoMs);
    if (!r.ok) throw new FalhaNavegador(r.motivo, r.detalhe);
    return r.valor;
  }

  return {
    maquina,
    aparelho,
    async listar(escopo, agenteId, host) {
      if (!maquina(escopo)) return null;
      // O canal só corta no prazo + a folga da rede; a lista do cartão não espera tanto.
      const corte = new Promise<null>((r) => { const t = setTimeout(() => r(null), PRAZO_LISTAR_MS); t.unref?.(); });
      const valor = await Promise.race([enviar(escopo, { tipo: "cofre", agenteId, pedido: { operacao: "listar", host } }, PRAZO_LISTAR_MS).catch(() => null), corte]);
      return valor === null ? null : lerOpcoesDoMac(valor);
    },
    async preencher(escopo, agenteId, fonte, ref, host) {
      const v = obj(await enviar(escopo, { tipo: "cofre", agenteId, pedido: { operacao: "preencher", fonte, ref, host } }, PRAZO_LER_MS));
      return { usuario: v.usuario === true, senha: v.senha === true };
    },
    async ler(escopo, agenteId, fonte, ref, host) {
      const v = obj(await enviar(escopo, { tipo: "cofre", agenteId, pedido: { operacao: "ler", fonte, ref, host } }, PRAZO_LER_MS));
      if (typeof v.senha !== "string" || v.senha === "" || v.senha.length > 4096) throw new FalhaNavegador("acao_falhou", "o cofre não devolveu a senha");
      return { usuario: str(v.usuario, 320), senha: v.senha };
    },
    async guardar(escopo, agenteId, fonte, site, usuario, senha) {
      await enviar(escopo, { tipo: "cofre", agenteId, pedido: { operacao: "guardar", fonte, site, usuario, senha } }, PRAZO_LER_MS);
    },
    async cookies(escopo, agenteId, host, aplicar) {
      const v = obj(await enviar(escopo, { tipo: "chrome", agenteId, host, aplicar }, PRAZO_CHROME_MS));
      if (aplicar) return typeof v.quantos === "number" ? v.quantos : 0;
      return lerCookies("chrome", v.cookies ?? []);
    },
    async touchId(escopo, agenteId, motivo) {
      if (!maquina(escopo)) return "sem_mac";
      try {
        await enviar(escopo, { tipo: "touch_id", agenteId, motivo: motivo.slice(0, 200) }, PRAZO_TOUCH_ID_MS);
        return "confirmado";
      } catch {
        // Cancelou, não respondeu a tempo ou o Mac saiu no meio: vale como recusa (nada de pagar sem a pessoa).
        return "recusado";
      }
    },
  };
}
