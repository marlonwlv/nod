/**
 * ADR-167 (tela 08 do Paper, "Jump to" do Grok Bot): ⌘K vira a paleta de tudo — bots, conversas (os trabalhos), ajustes
 * (com o caminho "Configurações › Geral › Aparência") e ações (com o atalho ao lado). Este arquivo é só o modelo: monta os
 * itens a partir de dados simples, filtra e anda pela seleção. Sem DOM nem framework; quem desenha é web/telas/paleta.ts e
 * quem liga ao documento é web/lib/paleta-na-tela.ts.
 */
import { AJUSTES, caminhoDoAjuste, type Ajuste } from "./ajustes.ts";
import { normalizarBusca } from "./linha-config.ts";

export type GrupoPaleta = "Bots" | "Conversas" | "Ajustes" | "Ações";
export const ORDEM_DOS_GRUPOS: readonly GrupoPaleta[] = ["Bots", "Conversas", "Ajustes", "Ações"];

export type DestinoPaleta =
  | { tipo: "conversa"; conversaId: string; agenteId: string }
  | { tipo: "trabalho"; id: string }
  | { tipo: "sala"; salaId: string; conversaId: string }
  | { tipo: "ajuste"; id: string }
  | { tipo: "acao"; id: IdAcaoPaleta };

export type ItemPaleta = {
  /** Único na paleta: `bot:<id>`, `trab:<id>`, `ajuste:<id>`, `acao:<id>`. */
  chave: string;
  grupo: GrupoPaleta;
  titulo: string;
  /** A linha de baixo (a prévia do bot, o bot do trabalho) ou o caminho do ajuste, já juntado com " › ". */
  sub?: string;
  /** As teclas do atalho, uma por <kbd> (⌘ 2). */
  teclas?: readonly string[];
  /** Cor e forma do avatar (bots e trabalhos); o desenho é de quem renderiza. */
  agenteId?: string;
  icone?: "conversa" | "ajuste" | "mais" | "tema" | "barra" | "sala" | "trabalhos" | "teclado" | "dev" | "escudo" | "relogio" | "raio";
  /** Paleta vazia (Paper 08): a ordem no grupo; sem ela, o item só aparece buscando quando o grupo já tem os seus. */
  vazia?: number;
  destino: DestinoPaleta;
  /** Outras palavras que acham o item. */
  palavras?: readonly string[];
};

export type IdAcaoPaleta =
  | "novo-bot" | "nova-sala" | "barra" | "ajustes" | "trabalhos" | "tarefas" | "sua-vez" | "nao-lidos" | "marketplace" | "atalhos"
  | "modo-dev" | "tema-claro" | "tema-escuro" | "tema-sistema" | "pausar-rotinas" | "quick-chat" | "design-system";

/** As ações da paleta. `teclas` é preenchido por quem monta (o modificador muda com o lugar, web/lib/atalhos.ts). */
export const ACOES_DA_PALETA: readonly { id: IdAcaoPaleta; titulo: string; icone: ItemPaleta["icone"]; tecla?: readonly string[]; palavras?: readonly string[] }[] = [
  { id: "novo-bot", titulo: "Novo bot", icone: "mais", tecla: ["N"], palavras: ["criar", "nova conversa"] },
  { id: "pausar-rotinas", titulo: "Pausar todas as rotinas", icone: "relogio", palavras: ["parar", "rotinas", "agenda"] },
  { id: "quick-chat", titulo: "Abrir o Quick Chat", icone: "raio", palavras: ["janela", "rápido", "quick"] },
  { id: "nova-sala", titulo: "Nova sala", icone: "sala", tecla: ["⇧", "N"], palavras: ["grupo", "conversa em grupo"] },
  { id: "trabalhos", titulo: "Ver os trabalhos em andamento", icone: "trabalhos", palavras: ["frentes", "aguardando"] },
  { id: "tarefas", titulo: "Ver as tarefas de todos os bots", icone: "trabalhos", palavras: ["tarefas", "quadros", "kanban"] },
  { id: "sua-vez", titulo: "Ver o que espera você", icone: "trabalhos", palavras: ["aprovações", "pedidos", "sua vez", "aguardando"] },
  { id: "nao-lidos", titulo: "Ver não lidos", icone: "conversa", palavras: ["novas", "mensagens"] },
  { id: "barra", titulo: "Mostrar só os avatares na barra", icone: "barra", tecla: ["B"], palavras: ["compacta", "recolher", "sidebar"] },
  { id: "ajustes", titulo: "Abrir as Configurações", icone: "ajuste", tecla: [","], palavras: ["preferências", "ajustes"] },
  { id: "marketplace", titulo: "Abrir o Marketplace", icone: "mais", palavras: ["apps", "conectores", "loja"] },
  { id: "atalhos", titulo: "Ver os atalhos de teclado", icone: "teclado", tecla: ["/"], palavras: ["folha", "teclas"] },
  { id: "tema-escuro", titulo: "Usar o tema escuro", icone: "tema", palavras: ["dark", "noite"] },
  { id: "tema-claro", titulo: "Usar o tema claro", icone: "tema", palavras: ["light", "dia"] },
  { id: "tema-sistema", titulo: "Seguir o tema do sistema", icone: "tema", palavras: ["automático"] },
  { id: "design-system", titulo: "Ver o design system", icone: "tema", palavras: ["tokens", "cores", "componentes", "vitrine"] },
  { id: "modo-dev", titulo: "Ligar ou desligar o modo dev", icone: "dev", tecla: ["⇧", "D"], palavras: ["custo", "tokens"] },
];

export type BotDaPaleta = { id: string; nome: string; titulo?: string | null; conversaId: string; previa?: string; /** Paper 08: 0 = o bot aberto, depois os de conversa mais recente. */ recencia?: number };
export type TrabalhoDaPaleta = { id: string; titulo: string; botNome?: string; quando?: string; agenteId?: string };
/** Frente "igual ao Grok" (TELAS §2: o ⌘K acha "Bots, chats, configurações e ações"): as salas são as conversas em grupo. */
export type SalaDaPaleta = { id: string; nome: string; conversaId: string; membros?: string };

/**
 * Todos os itens, na ordem de cada grupo: bots na ordem da barra (o 1º leva ⌘1…⌘9), trabalhos do mais recente, ajustes
 * do catálogo e as ações. `mod` é o modificador do lugar ("⌘", "⌃" ou "Alt").
 */
export function itensDaPaleta(o: { bots: readonly BotDaPaleta[]; trabalhos: readonly TrabalhoDaPaleta[]; mod: string; ajustes?: readonly Ajuste[]; /** Paper 08: o modo de aprovação e o tema de agora, para os dois atalhos de ajuste da paleta vazia. */ atuais?: { modo: string; temaEscuro: boolean; quickChat?: string }; salas?: readonly SalaDaPaleta[] }): ItemPaleta[] {
  const bots: ItemPaleta[] = o.bots.map((b, i) => ({
    chave: `bot:${b.id}`,
    grupo: "Bots",
    titulo: b.titulo ? `${b.nome} · ${b.titulo}` : b.nome,
    ...(b.previa ? { sub: b.previa } : {}),
    ...(i < 9 ? { teclas: [o.mod, String(i + 1)] } : {}),
    agenteId: b.id,
    destino: { tipo: "conversa", conversaId: b.conversaId, agenteId: b.id },
    ...(b.recencia !== undefined ? { vazia: b.recencia } : {}),
  }));
  const salas: ItemPaleta[] = (o.salas ?? []).map((sa) => ({
    chave: `sala:${sa.id}`,
    grupo: "Conversas",
    titulo: sa.nome,
    ...(sa.membros ? { sub: sa.membros } : {}),
    icone: "conversa",
    destino: { tipo: "sala", salaId: sa.id, conversaId: sa.conversaId },
  }));
  const trabalhos: ItemPaleta[] = o.trabalhos.map((t) => ({
    chave: `trab:${t.id}`,
    grupo: "Conversas",
    titulo: t.titulo,
    ...(t.botNome || t.quando ? { sub: [t.botNome, t.quando].filter(Boolean).join(" · ") } : {}),
    icone: "conversa",
    destino: { tipo: "trabalho", id: t.id },
  }));
  const ajustes: ItemPaleta[] = (o.ajustes ?? AJUSTES).map((a) => ({
    chave: `ajuste:${a.id}`,
    grupo: "Ajustes",
    titulo: a.titulo,
    sub: [...caminhoDoAjuste(a)].join(" › "),
    icone: "ajuste",
    destino: { tipo: "ajuste", id: a.id },
    palavras: [a.frase, ...(a.palavras ?? [])],
  }));
  // Paper 08: com a paleta vazia, dois atalhos de ajuste com o valor de agora ("Modo de aprovação", "Tema escuro").
  const atalhosDeAjuste: ItemPaleta[] = o.atuais ? [
    { chave: "ajuste-atalho:modo", grupo: "Ajustes", titulo: "Modo de aprovação", sub: `Ajustes › Aprovações › ${o.atuais.modo}`, icone: "escudo", destino: { tipo: "ajuste", id: "aprovacoes" }, vazia: 0, palavras: ["manual", "automático", "total"] },
    o.atuais.temaEscuro
      ? { chave: "ajuste-atalho:tema", grupo: "Ajustes", titulo: "Tema claro", sub: "Ajustes › Geral › Aparência › Claro", icone: "tema", destino: { tipo: "acao", id: "tema-claro" }, vazia: 1 }
      : { chave: "ajuste-atalho:tema", grupo: "Ajustes", titulo: "Tema escuro", sub: "Ajustes › Geral › Aparência › Escuro", icone: "tema", destino: { tipo: "acao", id: "tema-escuro" }, vazia: 1 },
  ] : [];
  const VAZIAS: Partial<Record<IdAcaoPaleta, number>> = { "novo-bot": 0, "pausar-rotinas": 1, "quick-chat": 2 };
  const acoes: ItemPaleta[] = ACOES_DA_PALETA.map((a) => ({
    chave: `acao:${a.id}`,
    grupo: "Ações",
    titulo: a.titulo,
    ...(a.icone ? { icone: a.icone } : {}),
    ...(a.id === "quick-chat" && o.atuais?.quickChat ? { teclas: [o.atuais.quickChat, "Espaço"] } : a.tecla ? { teclas: [o.mod, ...a.tecla] } : {}),
    ...(VAZIAS[a.id] !== undefined ? { vazia: VAZIAS[a.id] } : {}),
    destino: { tipo: "acao", id: a.id },
    ...(a.palavras ? { palavras: a.palavras } : {}),
  }));
  return [...bots, ...salas, ...trabalhos, ...atalhosDeAjuste, ...ajustes, ...acoes];
}

/** definido em 2026-11-12: o que cabe na paleta de 640×600 sem rolar muito; buscando, o grupo mostra até 6. */
export const POR_GRUPO_VAZIA: Record<GrupoPaleta, number> = { Bots: 3, Conversas: 1, Ajustes: 2, Ações: 3 };
export const POR_GRUPO_BUSCANDO = 6;

/**
 * O que a paleta mostra para o termo, por grupo e na ordem dos grupos. Vazia: os primeiros bots, os trabalhos recentes e
 * as ações principais. Com termo: toda palavra do termo precisa aparecer (título, linha de baixo ou palavras), e o título
 * que começa pelo termo vem antes.
 */
export function filtrarPaleta(itens: readonly ItemPaleta[], termo: string): ItemPaleta[] {
  const t = normalizarBusca(termo).trim();
  const porGrupo = new Map<GrupoPaleta, ItemPaleta[]>();
  if (!t) {
    // Paper 08: no grupo, primeiro os marcados para a paleta vazia (na ordem deles); depois os outros, na ordem de sempre.
    const ordenados = [...itens].map((i, n) => ({ i, n })).sort((a, b) => (a.i.grupo === b.i.grupo ? (a.i.vazia ?? 1e6) - (b.i.vazia ?? 1e6) || a.n - b.n : a.n - b.n)).map(({ i }) => i);
    for (const i of ordenados) {
      if (i.grupo !== "Bots" && i.grupo !== "Conversas" && i.vazia === undefined) continue;
      const lista = porGrupo.get(i.grupo) ?? [];
      if (lista.length < POR_GRUPO_VAZIA[i.grupo]) lista.push(i);
      porGrupo.set(i.grupo, lista);
    }
  } else {
    const partes = t.split(/\s+/);
    const nota = (i: ItemPaleta): number => {
      const titulo = normalizarBusca(i.titulo);
      if (titulo.startsWith(t)) return 0;
      if (titulo.split(/[\s·]+/).some((p) => p.startsWith(partes[0] ?? ""))) return 1;
      if (titulo.includes(t)) return 2;
      return 3;
    };
    const casam = itens
      .map((i, n) => ({ i, n, x: normalizarBusca([i.titulo, i.sub ?? "", ...(i.palavras ?? [])].join(" ")) }))
      .filter(({ x }) => partes.every((p) => x.includes(p)))
      .map(({ i, n }) => ({ i, n, nota: nota(i) }))
      .sort((a, b) => a.nota - b.nota || a.n - b.n);
    for (const { i } of casam) {
      const lista = porGrupo.get(i.grupo) ?? [];
      if (lista.length < POR_GRUPO_BUSCANDO) lista.push(i);
      porGrupo.set(i.grupo, lista);
    }
  }
  return ORDEM_DOS_GRUPOS.flatMap((g) => porGrupo.get(g) ?? []);
}

/** ↑ ↓ andam dando a volta; Home/End vão às pontas; nada = null (a tecla não é da lista). */
export function moverNaPaleta(atual: number, total: number, tecla: string): number | null {
  if (total <= 0) return null;
  if (tecla === "ArrowDown") return (atual + 1) % total;
  if (tecla === "ArrowUp") return (atual - 1 + total) % total;
  if (tecla === "Home") return 0;
  if (tecla === "End") return total - 1;
  return null;
}
