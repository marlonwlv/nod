/**
 * ADR-188: a atualização de mentira no NAVEGADOR, para ver e testar o cartão "Atualizar o nod" e Sobre o nod na 5280 sem
 * o app do Mac. Só liga em 127.0.0.1/localhost e com `?simular-atualizacao=<versão>` na URL; em produção (outro host)
 * nunca existe. `&simular-ocupado=1` faz o primeiro reinício responder "bot trabalhando" (a pergunta). O "reinício"
 * recarrega a página, que volta dizendo que atualizou.
 */
import type { AtualizacaoNaTela, RespostaReinicio } from "../../src/contracts/desktop-atualizacao.ts";
import type { PonteAtz } from "./atualizacao-app.ts";

const FEITA = "nod.atualizacaoSimulada.feita";
const VERSAO_ANTES = "1.0.3";
const VERSAO = /^\d+\.\d+\.\d+(?:-rc\.\d+)?$/;

function guardado(chave: string): string | null {
  try { return sessionStorage.getItem(chave); } catch { return null; }
}
function guardar(chave: string, valor: string | null): void {
  try { if (valor === null) sessionStorage.removeItem(chave); else sessionStorage.setItem(chave, valor); } catch { /* sem armazenamento */ }
}

/** A versão pedida na URL, só em loopback; null = simulação desligada. */
export function versaoSimuladaNaWeb(l: { hostname: string; search: string }): string | null {
  if (!["127.0.0.1", "localhost", "[::1]"].includes(l.hostname)) return null;
  const v = new URLSearchParams(l.search).get("simular-atualizacao")?.trim() ?? "";
  return VERSAO.test(v) ? v : null;
}

export function criarPonteSimuladaNaWeb(o: { versao: string; ocupado: boolean; recarregar: () => void; agendar?: (f: () => void, ms: number) => void; agora?: () => number }): PonteAtz {
  const agendar = o.agendar ?? ((f, ms) => { setTimeout(f, ms); });
  const agora = o.agora ?? Date.now;
  const feita = guardado(FEITA) === o.versao;
  let ouvinte: ((e: AtualizacaoNaTela) => void) | null = null;
  let jaPerguntou = false;
  let e: AtualizacaoNaTela = {
    fase: feita ? "ociosa" : "procurando", versaoAtual: feita ? o.versao : VERSAO_ANTES, versaoNova: null, motivo: null,
    procuradaEm: feita ? agora() : null, esperandoLivre: false, reiniciando: false, sozinho: true, atualizadoDe: feita ? VERSAO_ANTES : null,
  };
  if (feita) guardar(FEITA, null);
  const mudar = (novo: Partial<AtualizacaoNaTela>) => { e = { ...e, ...novo }; ouvinte?.(e); };
  const achar = () => {
    mudar({ fase: "procurando" });
    agendar(() => mudar({ fase: "baixando" }), 1_000);
    agendar(() => mudar({ fase: "pronta", versaoNova: o.versao }), 3_000);
  };
  const reiniciarJa = () => {
    guardar(FEITA, o.versao);
    mudar({ reiniciando: true, esperandoLivre: false });
    agendar(o.recarregar, 1_500);
  };
  if (!feita) agendar(achar, 0);
  return {
    estado: async () => e,
    aoMudar: (fn) => { ouvinte = fn; },
    reiniciar: async ({ quando }): Promise<RespostaReinicio> => {
      if (quando === "cancelarEspera") { mudar({ esperandoLivre: false }); return { ok: true, esperando: false }; }
      if (e.fase !== "pronta") return { ok: false, motivo: "naoPronta" };
      if (o.ocupado && !jaPerguntou && quando === "agora") { jaPerguntou = true; return { ok: false, motivo: "ocupado", turnos: 1, telas: 0 }; }
      if (quando === "quandoLivre") {
        mudar({ esperandoLivre: true });
        // O bot "termina" em 5 s e o app reinicia sozinho.
        agendar(() => { if (e.esperandoLivre) reiniciarJa(); }, 5_000);
        return { ok: true, esperando: true };
      }
      reiniciarJa();
      return { ok: true, esperando: false };
    },
    procurar: async () => { if (e.fase !== "pronta") achar(); return e; },
    definirSozinho: async (ligado) => { mudar({ sozinho: ligado }); return e; },
    avisoVisto: async () => { e = { ...e, atualizadoDe: null }; },
  };
}
