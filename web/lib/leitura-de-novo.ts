import type { ErroNaTela } from "./erro-da-tela.ts";

/**
 * A leitura em segundo plano que o servidor recusou com 5xx (definido em 2026-11-16, validação dos acessos). O banco
 * reiniciou e `GET /nao-lidos` pintou o banner vermelho "Algo deu errado do nosso lado" no topo da conversa — por uma
 * leitura que a pessoa nem pediu. No app de referência e no bot-hq a leitura de fundo que falha não fala nada: tenta de
 * novo; só a AÇÃO da pessoa que falha avisa. Aqui: a mesma leitura tenta de novo em 2, 5 e 10 s, calada; se a quarta
 * também falhar, o erro aparece (um defeito que não passa sozinho não fica escondido). Uma leitura que dá certo zera a conta.
 * O 4xx não entra: é resposta, não falha passageira, e segue o caminho de antes.
 */
export const ESPERAS_DA_LEITURA_MS = [2000, 5000, 10000] as const;

export type DepoisDaFalha = "calar" | "mostrar";

export interface LeituraDeNovo<Q extends string> {
  /** A leitura `q` falhou com `erro`: "calar" quando ela vai tentar de novo sozinha; "mostrar" quando o erro vai à tela. */
  falhou(q: Q, erro: ErroNaTela): DepoisDaFalha;
  /** A leitura `q` deu certo: a conta dela volta a zero. */
  deuCerto(q: Q): void;
  /**
   * A leitura `q` está na espera depois de uma falha 5xx: a passada do `reidratar` não a busca agora. Sem isso a tela que
   * ainda não tem o dado (a "falta da tela", como `trabalhos` com a tela Tarefas aberta) relia a cada passada — cerca de
   * uma por segundo — e as esperas de 2, 5 e 10 s só somavam leituras ao servidor que já estava falhando (QA-211).
   */
  esperando(q: Q): boolean;
}

export function falhaPassageira(erro: ErroNaTela): boolean {
  return typeof erro.status === "number" && erro.status >= 500;
}

/** Depois que o erro foi à tela, a mesma leitura ainda espera a maior das esperas antes de a passada tentar de novo. */
const ESPERA_DEPOIS_DO_ERRO_MS = ESPERAS_DA_LEITURA_MS[2];

export function criarLeituraDeNovo<Q extends string>(deps: { agendar: (fn: () => void, ms: number) => void; reler: (q: Q) => void; agora?: () => number }): LeituraDeNovo<Q> {
  const agora = deps.agora ?? (() => Date.now());
  const tentativas = new Map<Q, number>();
  const ate = new Map<Q, number>();
  return {
    falhou(q, erro) {
      if (!falhaPassageira(erro)) return "mostrar";
      const n = tentativas.get(q) ?? 0;
      const espera = ESPERAS_DA_LEITURA_MS[n];
      if (espera === undefined) {
        tentativas.delete(q);
        ate.set(q, agora() + ESPERA_DEPOIS_DO_ERRO_MS);
        return "mostrar";
      }
      tentativas.set(q, n + 1);
      ate.set(q, agora() + espera);
      deps.agendar(() => {
        ate.delete(q);
        deps.reler(q);
      }, espera);
      return "calar";
    },
    deuCerto(q) {
      tentativas.delete(q);
      ate.delete(q);
    },
    esperando(q) {
      const fim = ate.get(q);
      if (fim === undefined) return false;
      if (agora() < fim) return true;
      ate.delete(q);
      return false;
    },
  };
}
