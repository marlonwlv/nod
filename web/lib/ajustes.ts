/**
 * ADR-167 (Configurações): o catálogo dos ajustes. Cada ajuste tem um id estável, a seção onde mora, um título
 * curto e uma frase que começa por verbo ("Escolha…", "Mostre…"). O mesmo catálogo serve:
 * - à busca das Configurações (o campo no topo das seções);
 * - à paleta ⌘K (o grupo "Ajustes", com o caminho "Configurações › Geral › Aparência");
 * - ao link de cada ajuste (`#ajuste=<id>`), que abre as Configurações já na linha, realçada.
 *
 * Puro: sem DOM nem framework. A linha desenhada leva `id="ajuste-<id>"` (linhaConfig, campo `ajuste`).
 */
import type { SecaoEspaco } from "../estado/reducer.ts";
import { normalizarBusca } from "./linha-config.ts";

export type Ajuste = {
  id: string;
  secao: SecaoEspaco;
  /** O bloco dentro da seção ("Aparência", "Avisos"…); null quando o ajuste é a seção inteira. */
  grupo: string | null;
  titulo: string;
  frase: string;
  /** Outras palavras que acham o ajuste ("escuro" acha Tema). */
  palavras?: readonly string[];
};

/** O nome de cada seção como a navegação das Configurações mostra (web/telas/espaco.ts, SECOES_ESPACO). */
export const NOME_DA_SECAO: Record<SecaoEspaco, string> = {
  conta: "Conta",
  geral: "Geral",
  conexao: "Provedores de IA",
  maquinas: "Máquinas",
  computador: "Computador",
  agentes: "Agentes",
  rotinas: "Rotinas",
  aprovacoes: "Aprovações",
  cofre: "Cofre",
  feedback: "Feedback",
};

export const AJUSTES: readonly Ajuste[] = [
  { id: "tema", secao: "geral", grupo: "Aparência", titulo: "Tema", frase: "Escolha o visual claro, escuro ou o mesmo do sistema", palavras: ["escuro", "claro", "dark", "aparência", "cor"] },
  { id: "balao-cor", secao: "geral", grupo: "Aparência", titulo: "Cor do bot nos balões", frase: "Pinte as suas mensagens com a cor do bot da conversa, ou deixe em preto", palavras: ["acento", "accent", "balão", "cor"] },
  { id: "avisos", secao: "geral", grupo: "Avisos", titulo: "Avisar quando algo precisar de você", frase: "Receba um aviso quando um bot pedir uma decisão ou uma resposta", palavras: ["notificação", "notificações", "dock"] },
  { id: "som-mensagem", secao: "geral", grupo: "Sons", titulo: "Som de mensagem", frase: "Toque um som curto quando um bot responder", palavras: ["som", "áudio", "barulho", "mensagem"] },
  { id: "som-aprovacao", secao: "geral", grupo: "Sons", titulo: "Som de pedido de aprovação", frase: "Toque um som quando um bot pedir sua aprovação", palavras: ["som", "áudio", "aprovação", "pedido"] },
  { id: "atalhos", secao: "geral", grupo: "Ajuda", titulo: "Atalhos de teclado", frase: "Veja as teclas que levam a cada lugar do nod", palavras: ["teclado", "atalho", "folha"] },
  { id: "onboarding", secao: "geral", grupo: "Ajuda", titulo: "Ver o onboarding de novo", frase: "Reveja a apresentação do nod, do começo", palavras: ["tutorial", "apresentação"] },
  { id: "modo-dev", secao: "geral", grupo: "Avançado", titulo: "Modo dev", frase: "Mostre o custo, os tokens e o que foi enviado ao modelo em cada resposta", palavras: ["custo", "tokens", "debug"] },
  { id: "provedores", secao: "conexao", grupo: null, titulo: "Provedores de IA", frase: "Conecte e ordene as contas de IA que seus bots usam", palavras: ["claude", "codex", "modelo", "ia", "conta"] },
  { id: "maquinas", secao: "maquinas", grupo: null, titulo: "Máquinas", frase: "Veja e gerencie os computadores onde seus bots trabalham", palavras: ["mac", "computador", "vm"] },
  // Especificação D, item 7: o computador dos bots (telas abertas, onde mora, manutenção e logins), depois de Máquinas.
  { id: "computador", secao: "computador", grupo: null, titulo: "Computador", frase: "Veja as telas dos bots, onde o computador mora, atualize ou saia de todos os sites", palavras: ["computador do bot", "navegador", "tela", "login", "redefinir", "atualizar", "senhas"] },
  { id: "agentes", secao: "agentes", grupo: null, titulo: "Agentes", frase: "Veja todos os seus bots e mude vários de uma vez", palavras: ["bots", "lote"] },
  { id: "rotinas", secao: "rotinas", grupo: null, titulo: "Rotinas", frase: "Veja a agenda de tudo o que roda sozinho", palavras: ["agenda", "cron", "horário"] },
  // ADR-166 (revisor): a seção Aprovações entrou junto com a busca da ADR-167 na integração.
  { id: "aprovacoes", secao: "aprovacoes", grupo: null, titulo: "Aprovações", frase: "Escolha o modo, as regras do revisor e o nível de cada app", palavras: ["revisor", "modo", "permitir", "regras", "teto", "só leitura"] },
  { id: "cofre", secao: "cofre", grupo: null, titulo: "Cofre", frase: "Veja as chaves que você guardou pelos cartões dos bots", palavras: ["chave", "token", "senha", "credencial", "segredo", "api"] },
  // Frente de comportamento (12/11/2026; "cada linha com título + descrição, busca e link próprio"): as linhas de
  // Aprovações ganham o link delas, como as de Geral (antes, só a seção inteira).
  { id: "aprovacoes-modo", secao: "aprovacoes", grupo: "Modo", titulo: "Modo de aprovação", frase: "Escolha se o bot pede tudo, se o revisor decide ou se ele faz sem perguntar", palavras: ["manual", "automático", "total", "auto-review"] },
  { id: "so-leitura", secao: "aprovacoes", grupo: "Modo", titulo: "Só leitura", frase: "Deixe o bot só ler: tudo que muda algo é barrado, sem cartão", palavras: ["somente leitura", "read only", "bloquear escrita"] },
  { id: "teto-do-time", secao: "aprovacoes", grupo: "Modo", titulo: "Teto do time", frase: "Limite o modo mais aberto que os bots do time podem usar (admin)", palavras: ["admin", "política", "limite"] },
  { id: "regras-revisor", secao: "aprovacoes", grupo: "Regras do revisor", titulo: "Regras do revisor", frase: "Ensine o revisor com frases: o que ele pode fazer sem perguntar e o que sempre pergunta", palavras: ["sempre me pergunte", "pode fazer sem perguntar", "regra"] },
  { id: "nivel-por-app", secao: "aprovacoes", grupo: "Por app", titulo: "Nível por app", frase: "Escolha para cada app se ler e mudar sempre rodam, sempre pedem, ficam bloqueados ou seguem o revisor", palavras: ["sempre permitir", "sempre pedir", "bloqueado", "ferramenta"] },
  { id: "conta", secao: "conta", grupo: null, titulo: "Conta", frase: "Gerencie seu login, seu nome e a saída", palavras: ["login", "sair", "e-mail"] },
  { id: "feedback", secao: "feedback", grupo: null, titulo: "Feedback", frase: "Conte um problema ou uma ideia para o time do nod", palavras: ["bug", "relato", "ideia"] },
];

export function ajustePorId(id: string): Ajuste | null {
  return AJUSTES.find((a) => a.id === id) ?? null;
}

/** "Configurações › Geral › Aparência" (sem o próprio título). */
export function caminhoDoAjuste(a: Ajuste): string[] {
  return ["Configurações", NOME_DA_SECAO[a.secao], ...(a.grupo ? [a.grupo] : [])];
}

/** O que a busca compara: título, frase, caminho e palavras, sem acento nem caixa. */
function textoDeBusca(a: Ajuste): string {
  return normalizarBusca([a.titulo, a.frase, ...caminhoDoAjuste(a), ...(a.palavras ?? [])].join(" "));
}

/**
 * Os ajustes que casam com o termo, os de título melhor primeiro: começa pelo termo > alguma palavra do título começa por
 * ele > o título contém > o resto (frase, caminho, palavras). Todas as palavras do termo precisam aparecer.
 */
export function buscarAjustes(termo: string, lista: readonly Ajuste[] = AJUSTES): Ajuste[] {
  const t = normalizarBusca(termo).trim();
  if (!t) return [];
  const partes = t.split(/\s+/);
  const nota = (a: Ajuste): number => {
    const titulo = normalizarBusca(a.titulo);
    if (titulo.startsWith(t)) return 0;
    if (titulo.split(/\s+/).some((p) => p.startsWith(partes[0] ?? ""))) return 1;
    if (titulo.includes(t)) return 2;
    return 3;
  };
  return lista
    .filter((a) => { const x = textoDeBusca(a); return partes.every((p) => x.includes(p)); })
    .map((a, i) => ({ a, n: nota(a), i }))
    .sort((x, y) => x.n - y.n || x.i - y.i)
    .map((x) => x.a);
}

/** O link de um ajuste: a mesma página com `#ajuste=<id>`. */
export function linkDoAjuste(base: string, id: string): string {
  return `${base.replace(/#.*$/, "")}#ajuste=${encodeURIComponent(id)}`;
}

/** O id do ajuste num hash (`#ajuste=tema`), só se ele existe no catálogo. */
export function ajusteDoHash(hash: string): Ajuste | null {
  const m = /^#ajuste=([a-z0-9-]{1,40})$/.exec(hash);
  return m?.[1] ? ajustePorId(m[1]) : null;
}
