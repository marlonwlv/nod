import { existsSync, readFileSync, renameSync, unwatchFile, watchFile, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Atividade } from "./driver.ts";

/**
 * ADR-197 no PC: o motor (que roda o cua-driver na sessão da pessoa) e o app do Windows (que tem janela) são processos
 * separados. A ilha e a borda são do app; o driver é do motor. Os dois falam por dois arquivos na pasta do executor
 * (só da pessoa, fora da pasta da chave): `atividade.json` (o motor escreve a cada ação; o app desenha a ilha) e
 * `parar.json` (o app escreve no Parar; o motor derruba o driver). Leitura tolerante: arquivo torto ou velho é ignorado.
 */
export const ARQUIVO_ATIVIDADE = "atividade.json";
export const ARQUIVO_PARAR = "parar.json";
/** definido em 2026-11-26: atividade com mais disto já não acende a ilha (o app abriu depois que o bot parou). */
export const ATIVIDADE_VALE_MS = 15_000;

function gravarAtomico(arquivo: string, conteudo: string): void {
  const temp = `${arquivo}.${process.pid}.tmp`;
  writeFileSync(temp, conteudo);
  renameSync(temp, arquivo);
}

/** Motor: a cada ação, a atividade para o app (falha de disco não derruba a ação). */
export function publicarAtividade(pasta: string, a: Atividade): void {
  try { gravarAtomico(join(pasta, ARQUIVO_ATIVIDADE), JSON.stringify(a)); } catch { /* a ilha é só aviso */ }
}

export function lerAtividade(texto: string, agora: number): Atividade | null {
  try {
    const a = JSON.parse(texto) as Partial<Atividade>;
    if (typeof a.bot !== "string" || typeof a.app !== "string" || typeof a.acao !== "string" || typeof a.em !== "number" || typeof a.agenteId !== "string") return null;
    if (agora - a.em > ATIVIDADE_VALE_MS || a.em > agora + 60_000) return null;
    const j = a.janela;
    const janela = j && [j.x, j.y, j.largura, j.altura].every((n) => typeof n === "number" && Number.isFinite(n)) ? { x: j.x, y: j.y, largura: j.largura, altura: j.altura } : null;
    return { agenteId: a.agenteId, bot: a.bot.slice(0, 60), app: a.app.slice(0, 120), acao: a.acao.slice(0, 20), em: a.em, janela };
  } catch { return null; }
}

/** App: vigia a atividade do motor (a cada 400 ms) e chama `aoMudar` com cada atividade nova. Devolve o desligar. */
export function vigiarAtividade(pasta: string, aoMudar: (a: Atividade) => void, agora: () => number = Date.now): () => void {
  const arquivo = join(pasta, ARQUIVO_ATIVIDADE);
  let ultima = 0;
  const ver = () => {
    if (!existsSync(arquivo)) return;
    let texto: string;
    try { texto = readFileSync(arquivo, "utf8"); } catch { return; }
    const a = lerAtividade(texto, agora());
    if (a && a.em > ultima) { ultima = a.em; aoMudar(a); }
  };
  watchFile(arquivo, { interval: 400 }, ver);
  return () => unwatchFile(arquivo, ver);
}

/** App: o Parar da ilha. */
export function pedirParada(pasta: string, agora: number = Date.now()): void {
  try { gravarAtomico(join(pasta, ARQUIVO_PARAR), JSON.stringify({ em: agora })); } catch { /* sem disco: o próximo Parar tenta de novo */ }
}

/** Motor: vigia o Parar do app (a cada 500 ms); cada pedido novo chama `aoParar`. Devolve o desligar. */
export function vigiarParada(pasta: string, aoParar: () => void): () => void {
  const arquivo = join(pasta, ARQUIVO_PARAR);
  let visto = Date.now();
  const ver = () => {
    try {
      const em = (JSON.parse(readFileSync(arquivo, "utf8")) as { em?: unknown }).em;
      if (typeof em === "number" && em > visto) { visto = em; aoParar(); }
    } catch { /* ainda não existe ou torto */ }
  };
  watchFile(arquivo, { interval: 500 }, ver);
  return () => unwatchFile(arquivo, ver);
}
