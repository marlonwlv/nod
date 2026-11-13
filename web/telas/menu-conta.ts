import type { ContaIa } from "../../src/contracts/contas-ia.ts";
import { nesteAparelho } from "../lib/aparelho.ts";
import type { LinhaDaFolha } from "../lib/atalhos.ts";
import { esc } from "../lib/render.ts";
import { PROVEDOR } from "./cartao-ia.ts";
import { kbd } from "./config-geral.ts";
import { contaEmUso } from "./contas-lista.ts";
import { ALERTA_USO, maiorUso, pctUsado, proximaDaFila, quandoNaTela } from "./uso-da-conta.ts";

/**
 * Menu da conta (definido em 2026-09-30, canvas "Menu, sidebar e gaveta"): o avatar do rodapé abre este menu.
 * NOD-367 (protótipo v2 do Gil, aprovado em 2026-10-26): o menu fica enxuto — quem está logado (só texto), Provedores de
 * IA, Configurações, Agentes, Enviar feedback, Ajuda e, por último, Sair. Os interruptores (Modo dev, experimentos), os
 * avisos, as máquinas, o onboarding e o banco moram em Configurações. A faixa do topo só existe quando algo precisa da
 * pessoa — a IA desconectada, um conector fora do ar ou o uso do plano (ADR-029: escrito) — e é uma linha discreta.
 * Spec do item 2 (2026-11-12): sai o bloco "quem está logado" (o nome já está no rodapé); a ordem vira Provedores de IA ›,
 * Agentes, Suporte ›, Configurações (⌘,), divisória e Sair, com dois submenus que abrem à direita.
 */
export type DadosMenuConta = {
  faixa: { texto: string; botao: string } | null;
  conexao: string;
  /** NOD-367: o aviso das máquinas (o Este Mac sem disco ou ocupado, o computador do bot trabalhando), que abre Máquinas. */
  maquina?: { texto: string; tom: "atencao" | "neutro" | "ok" } | null;
  /**
   * Spec "Menu da conta" (item 2, 2026-11-12): o submenu Provedores de IA — uma linha por conta logada e o maior uso da
   * conta em uso (a meta do item). Ausente = sem dado de contas (o submenu só tem "Gerenciar provedores").
   */
  provedores?: ProvedoresDoMenu | null;
  /** As teclas mostradas na meta (do lugar do teclado, web/lib/atalhos.ts); ausente = as do Mac. */
  teclas?: { ajustes: string; atalhos: string };
  /**
   * NOD-345 (ADR-124): ausente = servidor sem contas (sem Sair). `email: null` = espaço provisório: no lugar de Sair, o
   * convite "Criar conta ou entrar" (o lembrete permanente, opção 2 do Gil).
   */
  conta?: { email: string | null; senha: boolean; legado?: boolean };
  /** NOD-406: no espaço provisório, o login de equipe pelo Google (a URL), ou "app" (a tela de conexão do app, com a
   * chave de Chaves). O clique vai por `data-conta="equipe"`. */
  equipe?: string | null;
};

/** "AN" de "Ana"; sem nome, as duas primeiras letras do e-mail. */
export function iniciaisDeQuem(nome: string | null, email: string | null): string {
  const base = (nome ?? "").trim();
  if (base) {
    const partes = base.split(/\s+/).filter(Boolean);
    return ((partes[0]?.[0] ?? "") + (partes.length > 1 ? partes[partes.length - 1]![0] ?? "" : partes[0]?.[1] ?? "")).toUpperCase();
  }
  return (email ?? "").slice(0, 2).toUpperCase();
}

/** "Gmail e ClickUp fora do ar"; com mais de três, os dois primeiros e quantos faltam. */
export function faixaDeConectores(nomes: readonly string[]): string {
  const lista = nomes.length > 3 ? [...nomes.slice(0, 2), `mais ${nomes.length - 2}`] : [...nomes];
  return `${new Intl.ListFormat("pt-BR", { style: "long", type: "conjunction" }).format(lista)} fora do ar`;
}

/** O uso do plano que segura as rotinas: o texto da faixa do menu e o resumo que entra no nome acessível do avatar. */
export type AvisoDoUso = { texto: string; resumo: string };

type IaTravada = { nome: string; apelido: string; limite: boolean; ate: number | null; pct: number; janela: "5 h" | "semana" };

/**
 * NOD-12 (definido em 2026-10-22, protótipo do Gil no PR #414): a faixa do menu da conta pelo uso do plano. Só aparece
 * quando as rotinas vão esperar: a conta em uso de alguma IA está a partir de 90% (ou no limite) e não há outra conta
 * dela pronta na fila. Com conta seguinte, nada aqui (a linha da conta já diz para onde vai). A conversa nunca é
 * segurada (ADR-099 §7), e o texto diz isso no limite.
 */
export function faixaDoUso(contas: readonly ContaIa[], agora: number): AvisoDoUso | null {
  const travadas: IaTravada[] = [];
  for (const ia of ["claude-cli", "codex-cli"] as const) {
    const nome = PROVEDOR[ia].nome;
    const logadas = contas.filter((c) => c.ia === ia && c.maquinas.some((v) => v.estado === "pronta"));
    if (logadas.length === 0) continue;
    const emUso = contaEmUso(contas, agora, { ia });
    if (!emUso) {
      // Nenhuma pronta fora do limite: a IA está no limite até a primeira voltar.
      const voltas = logadas.map((c) => c.noLimiteAte).filter((t): t is number => t !== null && t > agora);
      if (voltas.length) travadas.push({ nome, apelido: logadas[0]!.apelido, limite: true, ate: Math.min(...voltas), pct: 100, janela: "5 h" });
      continue;
    }
    const q = emUso.cota;
    const maior = maiorUso(q);
    if (!q || maior === null || maior < ALERTA_USO || proximaDaFila(emUso, contas, agora)) continue;
    const j = q.cincoHoras && q.cincoHoras.utilizacao === maior ? { j: q.cincoHoras, nome: "5 h" as const } : { j: q.semana!, nome: "semana" as const };
    travadas.push({ nome, apelido: emUso.apelido, limite: maior >= 1, ate: j.j.renovaEm, pct: pctUsado(maior), janela: j.nome });
  }
  if (travadas.length === 0) return null;
  const nomes = new Intl.ListFormat("pt-BR", { style: "long", type: "conjunction" }).format(travadas.map((t) => t.nome));
  if (travadas.length > 1) {
    const todas = travadas.every((t) => t.limite);
    return todas
      ? { texto: `${nomes} no limite. As rotinas esperam até renovar; a conversa com você segue.`, resumo: `${nomes} no limite` }
      : { texto: `${nomes} perto do limite. Sem outra conta na fila, as rotinas esperam.`, resumo: `${nomes} perto do limite` };
  }
  const t = travadas[0]!;
  if (t.limite) {
    const ate = t.ate !== null ? ` até ${quandoNaTela(t.ate, agora)}` : "";
    return { texto: `${t.nome} no limite${ate}. As rotinas esperam até ${ate ? "lá" : "renovar"}; a conversa com você segue.`, resumo: `${t.nome} no limite${ate}` };
  }
  const renova = t.ate !== null ? `, renova ${quandoNaTela(t.ate, agora).includes(" às ") ? "em " : "às "}${quandoNaTela(t.ate, agora)}` : "";
  const janela = t.janela === "5 h" ? "da janela de 5 h" : "da semana";
  return {
    texto: `${t.nome} · ${t.apelido} em ${t.pct}% ${janela}${renova}. Sem outra conta na fila, as rotinas esperam até ${renova ? "lá" : "renovar"}.`,
    resumo: `${t.nome} perto do limite`,
  };
}


/** Uma linha informativa do submenu Provedores de IA: "{IA} · {apelido}" / "{janela} · renova {quando}" e "N% usado". */
export type LinhaDoProvedor = { titulo: string; detalhe: string; pct: number | null };
export type ProvedoresDoMenu = { pct: number | null; linhas: LinhaDoProvedor[] };

/**
 * O que o menu mostra das contas de IA: uma linha por conta logada (alguma máquina pronta), na ordem da fila, e o maior uso
 * entre as contas em uso de cada IA (a meta "N% usado" do item; null = nenhuma leitura, a meta some). O detalhe diz a
 * janela de maior uso e quando renova; sem leitura, fica vazio (mostra o que existir).
 */
export function provedoresDoMenu(contas: readonly ContaIa[], agora: number): ProvedoresDoMenu {
  const logadas = contas.filter((c) => c.maquinas.some((v) => v.estado === "pronta")).sort((a, b) => a.posicao - b.posicao);
  const linhas = logadas.map((c): LinhaDoProvedor => {
    const q = c.cota;
    const maior = maiorUso(q);
    if (!q || maior === null) return { titulo: `${PROVEDOR[c.ia].nome} · ${c.apelido}`, detalhe: "", pct: null };
    const daJanela = q.cincoHoras && q.cincoHoras.utilizacao === maior ? { nome: "5 h", j: q.cincoHoras } : { nome: "Semana", j: q.semana! };
    const renova = daJanela.j.renovaEm !== null ? ` · renova ${quandoNaTela(daJanela.j.renovaEm, agora)}` : "";
    return { titulo: `${PROVEDOR[c.ia].nome} · ${c.apelido}`, detalhe: `${daJanela.nome}${renova}`, pct: pctUsado(maior) };
  });
  const usos = [...new Set(logadas.map((c) => c.ia))]
    .map((ia) => maiorUso(contaEmUso(contas, agora, { ia })?.cota))
    .filter((u): u is number => u !== null);
  return { pct: usos.length ? pctUsado(Math.max(...usos)) : null, linhas };
}

/** O id de cada item do menu principal, na ordem da tela. `inicio`/`equipe` = o espaço provisório no lugar de Sair. */
export type ItemMenuConta = "provedores" | "agentes" | "suporte" | "configuracoes" | "sair" | "inicio" | "equipe";

export function itensDoMenuConta(d: Pick<DadosMenuConta, "conta" | "equipe">): ItemMenuConta[] {
  const base: ItemMenuConta[] = ["provedores", "agentes", "suporte", "configuracoes"];
  if (!d.conta) return base;
  if (d.conta.email !== null) return [...base, "sair"];
  return [...base, "inicio", ...(d.equipe ? (["equipe"] as const) : [])];
}

/** Os itens do submenu Suporte, na ordem. */
export const ITENS_SUPORTE = ["ajuda", "atalhos", "feedback", "sobre"] as const;

// Ícones de 14 px (o quadro de 18 é do CSS), traço na cor do texto. Só deste menu.
const ic = (d: string, tamanho = 14): string =>
  `<svg class="mc-ic" width="${tamanho}" height="${tamanho}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const ICONES_MENU_CONTA = {
  velocimetro: ic('<path d="M4 17a8 8 0 1 1 16 0"/><path d="M12 17l4-5"/><path d="M4 20h16"/>'),
  pessoas: ic('<circle cx="9" cy="8" r="3.2"/><path d="M3 20c.6-3.4 3-5.3 6-5.3s5.4 1.9 6 5.3"/><path d="M16 4.9a3.2 3.2 0 0 1 0 6.2"/><path d="M18 14.9c1.6.7 2.7 2.4 3 5.1"/>'),
  livro: ic('<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/>'),
  engrenagem: ic('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  sair: ic('<path d="M14 4h5v16h-5"/><path d="M10 8l-4 4 4 4M6 12h10"/>'),
  pessoa: ic('<circle cx="12" cy="8" r="3.6"/><path d="M5 20c.9-3.6 3.7-5.6 7-5.6s6.1 2 7 5.6"/>'),
  ajuda: ic('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.2a2.6 2.6 0 0 1 5 .8c0 1.8-2.5 2.2-2.5 3.8M12 17h.01"/>'),
  teclado: ic('<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>'),
  envelope: ic('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6.5 8.5 6.5 8.5-6.5"/>'),
  info: ic('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'),
  chevron: ic('<path d="M9.5 6l6 6-6 6"/>').replace('class="mc-ic"', 'class="mc-chevron"'),
};

/**
 * O HTML do menu da conta. `folha` = o celular (a folha de baixo, NOD-379): sem submenus nem teclas — Provedores de IA abre
 * a seção direto e o Suporte vira Ajuda e Enviar feedback soltos, como antes.
 */
export function htmlMenuConta(d: DadosMenuConta, folha = false): string {
  const I = ICONES_MENU_CONTA;
  const teclas = d.teclas ?? { ajustes: "⌘,", atalhos: "⌘/" };
  const meta = (m: string) => (m ? `<span class="mc-meta">${esc(m)}</span>` : "");
  const item = (attrs: string, icone: string, nome: string, m = "") => `<button type="button" role="menuitem" ${attrs}>${icone}<span class="mc-nome">${esc(nome)}</span>${meta(m)}</button>`;
  const comSub = (sub: string, icone: string, nome: string, m = "") => `<button type="button" role="menuitem" data-sub="${sub}" aria-haspopup="menu" aria-expanded="false" aria-controls="mc-sub-${sub}">${icone}<span class="mc-nome">${esc(nome)}</span>${meta(m)}${I.chevron}</button>`;
  // As faixas ficam fora do role=menu (um status não é item de menu); as setas do diálogo passam pelos botões delas.
  const faixa = d.faixa ? `<div class="mc-faixa" role="status"><i aria-hidden="true"></i><span>${esc(d.faixa.texto)}</span><button type="button" data-secao="conexao">${esc(d.faixa.botao)}</button></div>` : "";
  const maquina = d.maquina ? `<div class="mc-faixa mc-faixa-${d.maquina.tom}" role="status"><i aria-hidden="true"></i><span>${esc(d.maquina.texto)}</span><button type="button" data-secao="maquinas">Ver</button></div>` : "";
  const pct = d.provedores?.pct ?? null;
  const usado = pct !== null ? `${pct}% usado` : "";
  const html: Record<ItemMenuConta, string> = {
    provedores: folha ? item('data-secao="conexao"', I.velocimetro, "Provedores de IA", usado || d.conexao) : comSub("provedores", I.velocimetro, "Provedores de IA", usado),
    agentes: item('data-secao="agentes"', I.pessoas, "Agentes"),
    suporte: folha ? item('data-secao="ajuda"', I.ajuda, "Ajuda") + item('data-secao="feedback"', I.envelope, "Enviar feedback") : comSub("suporte", I.livro, "Suporte"),
    configuracoes: item('data-secao="geral"', I.engrenagem, "Configurações", folha ? "" : teclas.ajustes),
    // Sair por último; no espaço provisório (sem conta ainda), o convite fica no lugar dele.
    sair: item('data-conta="sair"', I.sair, "Sair"),
    inicio: item('data-conta="inicio"', I.pessoa, "Criar conta ou entrar", `Seu espaço está só ${nesteAparelho()}`),
    equipe: item('data-conta="equipe"', I.pessoa, d.equipe === "app" ? "Sou da equipe: conectar com a chave" : "Sou da equipe: entrar com Google"),
  };
  const ids = itensDoMenuConta(d);
  const corpo = ids.map((id, i) => (i > 0 && ["sair", "inicio"].includes(id) ? "<hr>" : "") + html[id]).join("");
  const menu = `<div role="menu" aria-label="Conta" class="mc-menu" tabindex="-1">${corpo}</div>`;
  if (folha) return `${faixa}${maquina}${menu}`;
  const linhas = (d.provedores?.linhas ?? []).map((l) => `<div role="menuitem" aria-disabled="true" class="mc-info"><span class="mc-info-txt"><span class="mc-info-titulo">${esc(l.titulo)}</span>${l.detalhe ? `<span class="mc-info-detalhe">${esc(l.detalhe)}</span>` : ""}</span>${l.pct !== null ? `<span class="mc-meta">${l.pct}% usado</span>` : ""}</div>`).join("<hr>");
  const subProvedores = `<div role="menu" aria-label="Provedores de IA" class="mc-sub" id="mc-sub-provedores" data-sub-de="provedores" tabindex="-1" hidden>${linhas}${linhas ? "<hr>" : ""}${item('data-secao="conexao"', I.velocimetro, "Gerenciar provedores")}</div>`;
  const subSuporte = `<div role="menu" aria-label="Suporte" class="mc-sub" id="mc-sub-suporte" data-sub-de="suporte" tabindex="-1" hidden>${item('data-secao="ajuda"', I.ajuda, "Ajuda")}${item('data-acao="atalhos"', I.teclado, "Atalhos de teclado", teclas.atalhos)}${item('data-secao="feedback"', I.envelope, "Enviar feedback")}${item('data-acao="sobre"', I.info, "Sobre o nod")}</div>`;
  return `${faixa}${maquina}${menu}${subProvedores}${subSuporte}`;
}

/** Onde está o foco no menu, para a tecla decidir o próximo passo (sem DOM). `indice` -1 = nenhum item focado. */
export type PosicaoNoMenu = { indice: number; total: number; noSubmenu: boolean; temSubmenu: boolean };
export type AcaoDaTecla =
  | { tipo: "focar"; indice: number }
  | { tipo: "abrir-submenu" }
  | { tipo: "fechar-submenu" }
  | { tipo: "fechar-menu" };

/**
 * O teclado do menu da conta (spec do item 2): ↓ foca o 1º item (sem foco) ou o próximo; ↑ o anterior (ambos dão a volta);
 * Home/End as pontas; → abre o submenu do item; ← fecha o submenu; Esc fecha o submenu ou, no menu, o menu inteiro (o
 * foco volta à pílula). Qualquer outra tecla: null (o navegador segue, ex.: Enter clica o item).
 */
export function teclaDoMenuConta(tecla: string, p: PosicaoNoMenu): AcaoDaTecla | null {
  if (tecla === "Escape") return p.noSubmenu ? { tipo: "fechar-submenu" } : { tipo: "fechar-menu" };
  if (tecla === "ArrowLeft") return p.noSubmenu ? { tipo: "fechar-submenu" } : null;
  if (tecla === "ArrowRight") return !p.noSubmenu && p.temSubmenu ? { tipo: "abrir-submenu" } : null;
  if (p.total <= 0) return null;
  if (tecla === "Home") return { tipo: "focar", indice: 0 };
  if (tecla === "End") return { tipo: "focar", indice: p.total - 1 };
  if (tecla === "ArrowDown") return { tipo: "focar", indice: p.indice < 0 ? 0 : (p.indice + 1) % p.total };
  if (tecla === "ArrowUp") return { tipo: "focar", indice: p.indice < 0 ? p.total - 1 : (p.indice - 1 + p.total) % p.total };
  return null;
}

/** O que "Copiar informações da versão" leva à área de transferência. */
/**
 * COP-12 (spec do item 2): Suporte › Atalhos de teclado, ⌘/ e "?" abrem este diálogo, só com as teclas do lugar
 * (web/lib/atalhos.ts, linhasDaFolha). A Ajuda é outro lugar: o bloco Ajuda de Configurações (o onboarding).
 */
export function htmlFolhaDeAtalhos(linhas: readonly LinhaDaFolha[]): string {
  const itens = linhas.map((l) => `<div class="mc-atalho"><dt>${esc(l.titulo)}</dt><dd>${kbd(l.combinacoes)}<span class="sr-only">${esc(l.falado)}</span></dd></div>`).join("");
  return `<div class="mc-atalhos"><h2>Atalhos de teclado</h2><dl class="mc-atalhos-lista">${itens}</dl><div class="acoes"><button class="bt" type="button" data-fechar>Fechar</button></div></div>`;
}

export function informacoesDaVersao(versao: string, navegador: string): string {
  return [`nod ${versao}`, navegador ? `Navegador: ${navegador}` : ""].filter(Boolean).join("\n");
}
