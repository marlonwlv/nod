/**
 * ADR-188: uma atualização de mentira para testar o cartão e Sobre o nod no app rodando do código (`npm run desktop:dev`),
 * sem bucket, feed nem Squirrel. Só liga com `NOD_SIMULAR_ATUALIZACAO=<versão>` e o app NÃO empacotado: o build de
 * produção nunca entra aqui. A procura acha a versão em 1,5 s, baixa em mais 4 s, e o "reiniciar" grava a versão
 * prometida e relança o app, que volta dizendo que atualizou.
 */
import { versaoDoAppValida } from "../src/domain/versao-app.ts";
import type { DepsAtualizacao, UpdaterDoApp } from "./atualizacao.ts";

export const ESPERA_SIMULADA_ACHAR_MS = 1_500;
export const ESPERA_SIMULADA_BAIXAR_MS = 4_000;

/** A versão pedida pela variável de ambiente; null = simulação desligada (o app empacotado sempre desliga). */
export function versaoSimulada(valor: string | undefined, empacotado: boolean): string | null {
  if (empacotado || !valor) return null;
  const v = valor.trim();
  return versaoDoAppValida(v) ? v : null;
}

/** preferencias.json: a versão que o reinício simulado prometeu (lida e apagada no próximo boot). */
export function lerSimuladoPara(conteudo: string | null): string | null {
  try {
    const obj: unknown = conteudo === null ? null : JSON.parse(conteudo);
    if (typeof obj !== "object" || obj === null || !("simuladoPara" in obj)) return null;
    return versaoDoAppValida(obj.simuladoPara) ? obj.simuladoPara : null;
  } catch { return null; }
}

type Ouvinte = (...args: unknown[]) => void;

export function criarUpdaterSimulado(o: {
  /** A versão que a simulação oferece. */
  versao: string;
  /** A versão "rodando" agora (depois do reinício simulado, a prometida: aí a procura diz que está em dia). */
  emUso: () => string;
  agendar: (f: () => void, ms: number) => void;
  /** O quitAndInstall: grava a versão prometida e relança. */
  aoInstalar: (versao: string) => void;
}): UpdaterDoApp {
  const ouvintes = new Map<string, Ouvinte[]>();
  const emitir = (evento: string, ...args: unknown[]) => { for (const f of ouvintes.get(evento) ?? []) f(...args); };
  const on = (evento: string, f: Ouvinte): unknown => {
    ouvintes.set(evento, [...(ouvintes.get(evento) ?? []), f]);
    return undefined;
  };
  return {
    setFeedURL: () => undefined,
    checkForUpdates: () => {
      if (o.emUso() === o.versao) { o.agendar(() => emitir("update-not-available"), ESPERA_SIMULADA_ACHAR_MS); return; }
      o.agendar(() => emitir("update-available"), ESPERA_SIMULADA_ACHAR_MS);
      o.agendar(() => emitir("update-downloaded", {}, "", o.versao), ESPERA_SIMULADA_ACHAR_MS + ESPERA_SIMULADA_BAIXAR_MS);
    },
    quitAndInstall: () => o.aoInstalar(o.versao),
    on: on as UpdaterDoApp["on"],
  };
}

/** O que a simulação troca nas dependências do coordenador: o updater, "instalado em Aplicativos" e uma conexão de mentira. */
export function depsDaSimulacao(updater: UpdaterDoApp, versao: string): Pick<DepsAtualizacao, "updater" | "empacotado" | "naPastaAplicativos" | "versao" | "conexao"> {
  return { updater, empacotado: true, naPastaAplicativos: () => true, versao, conexao: () => ({ url: "https://simulado.invalid", chave: "-" }) };
}
