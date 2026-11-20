/**
 * "Ensinar uma tarefa" (ADR-190, quadro T do Paper; o "Teach a task" do nightly-labs/openbot). Puro.
 *
 * definido em 2026-11-20: grava só a pessoa, só enquanto ela está no controle. Guarda páginas e cliques pelo nome do
 * botão e o rótulo do campo, nunca o que ela digitou nem senhas. Até 200 passos ou 10 minutos; passou disso, a gravação
 * para sozinha e oferece salvar o que tem.
 */
export const MAX_PASSOS_GRAVACAO = 200;
export const MAX_MS_GRAVACAO = 10 * 60_000;

export type EventoGravado =
  | { tipo: "abriu"; url: string }
  | { tipo: "clicou"; papel: string; nome: string }
  | { tipo: "digitou"; campo: string; protegido: boolean }
  | { tipo: "escolheu"; campo: string; opcao: string }
  | { tipo: "tecla"; tecla: string }
  | { tipo: "entrou"; site: string };

export type Gravacao = { desde: number; eventos: readonly EventoGravado[] };

export function novaGravacao(agora: number): Gravacao {
  return { desde: agora, eventos: [] };
}

/** O host da URL sem o "www." (o domínio é puro: sem `URL`). */
export function hostDaUrl(url: string): string {
  const m = url.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#:@]+@)?([^/?#:]+)/i);
  return (m?.[2] ?? url.slice(0, 80)).toLowerCase().replace(/^www\./, "");
}
const host = hostDaUrl;

function curto(t: string, n = 60): string {
  const s = t.replace(/\s+/g, " ").trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** Junta o evento novo ao anterior quando é a mesma coisa (digitar no mesmo campo, abrir a mesma página). */
export function gravar(g: Gravacao, e: EventoGravado, agora: number): { gravacao: Gravacao; parou: null | "passos" | "tempo" } {
  if (agora - g.desde > MAX_MS_GRAVACAO) return { gravacao: g, parou: "tempo" };
  const ultimo = g.eventos.at(-1);
  if (ultimo && ultimo.tipo === "digitou" && e.tipo === "digitou" && ultimo.campo === e.campo) return { gravacao: g, parou: null };
  if (ultimo && ultimo.tipo === "abriu" && e.tipo === "abriu" && host(ultimo.url) === host(e.url) && ultimo.url === e.url) return { gravacao: g, parou: null };
  if (g.eventos.length >= MAX_PASSOS_GRAVACAO) return { gravacao: g, parou: "passos" };
  return { gravacao: { ...g, eventos: [...g.eventos, e] }, parou: null };
}

/** O passo em linguagem simples, como na lista "PASSOS GRAVADOS" (T2). */
export function fraseDoPasso(e: EventoGravado): string {
  switch (e.tipo) {
    case "abriu": return `Abriu ${host(e.url)}`;
    case "clicou": return `Clicou em "${curto(e.nome)}"`;
    case "digitou": return e.protegido ? `Preencheu ${curto(e.campo)} (não gravado)` : `Preencheu "${curto(e.campo)}"`;
    case "escolheu": return `Escolheu "${curto(e.opcao)}"`;
    case "tecla": return `Apertou ${e.tecla}`;
    case "entrou": return `Entrou em ${e.site} (senha não gravada)`;
  }
}

export function passosDaGravacao(g: Gravacao): string[] {
  return g.eventos.map(fraseDoPasso);
}

/** "0:42 · 4 passos" da barra de gravação. */
export function rotuloDaGravacao(g: Gravacao, agora: number): string {
  const s = Math.max(0, Math.floor((agora - g.desde) / 1000));
  const n = g.eventos.length;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} · ${n} ${n === 1 ? "passo" : "passos"}`;
}

/**
 * O arquivo que vai anexado à mensagem da pessoa (T3): os passos numerados e uma nota para o bot. O pedido é o texto
 * da mensagem, não o arquivo (o bot não obedece arquivo).
 */
export function arquivoDosPassos(nome: string, g: Gravacao): string {
  const linhas = passosDaGravacao(g).map((p, i) => `${i + 1}. ${p}`);
  return [`Tarefa ensinada: ${nome}`, "", ...linhas, "", "Gravado no navegador do bot, com a pessoa no controle. O que ela digitou e as senhas não foram gravados."].join("\n");
}

/** O nome que a pessoa dá, ou um nome a partir dos passos ("Baixar a fatura do Itaú"). */
export function nomeSugerido(g: Gravacao): string {
  const site = g.eventos.find((e) => e.tipo === "abriu");
  const ultimoClique = [...g.eventos].reverse().find((e) => e.tipo === "clicou");
  const s = site && site.tipo === "abriu" ? host(site.url) : "";
  const c = ultimoClique && ultimoClique.tipo === "clicou" ? curto(ultimoClique.nome, 40) : "";
  if (c && s) return `${c} em ${s}`;
  return c || s || "Tarefa ensinada";
}
