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
}

export function falhaPassageira(erro: ErroNaTela): boolean {
  return typeof erro.status === "number" && erro.status >= 500;
}

export function criarLeituraDeNovo<Q extends string>(deps: { agendar: (fn: () => void, ms: number) => void; reler: (q: Q) => void }): LeituraDeNovo<Q> {
  const tentativas = new Map<Q, number>();
  return {
    falhou(q, erro) {
      if (!falhaPassageira(erro)) return "mostrar";
      const n = tentativas.get(q) ?? 0;
      const espera = ESPERAS_DA_LEITURA_MS[n];
      if (espera === undefined) {
        tentativas.delete(q);
        return "mostrar";
      }
      tentativas.set(q, n + 1);
      deps.agendar(() => deps.reler(q), espera);
      return "calar";
    },
    deuCerto(q) {
      tentativas.delete(q);
    },
  };
}
