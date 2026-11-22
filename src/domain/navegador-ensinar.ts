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

/**
 * Ponto 15 dos cenários (2026-11-22): o passo "Abriu" leva o caminho da página ("demoqa.com/text-box"), sem a busca nem o
 * fragmento (que costumam ter dados da sessão); só o domínio fazia a repetição perder a página exata.
 */
export function paginaDaUrl(url: string): string {
  const m = url.match(/^[a-z][a-z0-9+.-]*:\/\/(?:[^/?#:@]+@)?[^/?#:]+(?::\d+)?(\/[^?#]*)?/i);
  const caminho = (m?.[1] ?? "").replace(/\/+$/u, "");
  return curto(`${host(url)}${caminho}`, 90);
}

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
    case "abriu": return `Abriu ${paginaDaUrl(e.url)}`;
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
/**
 * O nome do anexo dos passos (T3): "passos-gravados (6 passos).txt". definido em 2026-11-20: o número vai no nome porque o
 * anexo não tem outro campo que a tela leia, e o chip embaixo do balão diz "passos-gravados.txt · 6 passos".
 */
export function nomeDoArquivoDosPassos(g: Gravacao): string {
  const n = g.eventos.length;
  return `passos-gravados (${n} ${n === 1 ? "passo" : "passos"}).txt`;
}

export function arquivoDosPassos(nome: string, g: Gravacao): string {
  const linhas = passosDaGravacao(g).map((p, i) => `${i + 1}. ${p}`);
  return [`Tarefa ensinada: ${nome}`, "", ...linhas, "", "Gravado no navegador do bot, com a pessoa no controle. O que ela digitou e as senhas não foram gravados."].join("\n");
}

/**
 * A mensagem da pessoa ao salvar (T3, Paper): "Ensinei: baixar a fatura do Itaú." O nome entra no meio da frase: quando
 * começa por um verbo no infinitivo ("Baixar", "Conferir", "Pagar"), a maiúscula do começo cai. Nome próprio, site ou
 * sigla no começo ("Itaú", "TAP", "Bradesco: extrato") fica como a pessoa escreveu.
 */
export function mensagemDoEnsinado(nome: string): string {
  const n = nome.trim();
  const meio = /^\p{Lu}\p{Ll}*[aeiu]r(?=\s|$)/u.test(n) ? n.charAt(0).toLocaleLowerCase("pt-BR") + n.slice(1) : n;
  return `Ensinei: ${meio.replace(/[.!?…]+$/u, "")}.`;
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

/**
 * O elemento sob o clique da pessoa, como o servidor o descreve na página (papel, nome acessível, rótulo do campo, tipo
 * do input). Nunca o valor do campo.
 */
export type ElementoNaPagina = { papel: string; nome: string; rotulo: string; tipo: string | null; autocomplete: string | null; editavel: boolean };

/** Papéis que a gravação guarda como "Clicou em …". Campo de texto vira o campo da próxima digitação, não um clique. */
const PAPEIS_DO_CLIQUE: ReadonlySet<string> = new Set(["button", "link", "menuitem", "tab", "option", "checkbox", "radio", "switch", "combobox", "treeitem", "menuitemcheckbox", "menuitemradio"]);

/** O clique gravado; null = não vale um passo (texto solto, o fundo da página, um campo de digitar). */
export function eventoDoClique(el: ElementoNaPagina | null): EventoGravado | null {
  if (!el || el.editavel) return null;
  const nome = (el.nome || el.rotulo).trim();
  if (!nome || !PAPEIS_DO_CLIQUE.has(el.papel.toLowerCase())) return null;
  return { tipo: "clicou", papel: el.papel, nome: nome.slice(0, 200) };
}

/** O campo em que a pessoa digita: o rótulo (ou o nome acessível) e se é secreto. Nunca o que ela digitou. */
export function campoDoElemento(el: ElementoNaPagina, secreto: (p: { papel: string; nome: string; tipo?: string | null; autocomplete?: string | null }) => boolean): { campo: string; protegido: boolean } {
  const campo = (el.rotulo || el.nome).replace(/\s+/g, " ").trim().slice(0, 120) || "um campo";
  return { campo, protegido: secreto({ papel: el.papel === "textbox" || el.papel === "searchbox" ? el.papel : "textbox", nome: campo, tipo: el.tipo, autocomplete: el.autocomplete }) };
}
