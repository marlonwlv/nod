import type { CorAgente, FormaAgente } from "../../src/contracts/agente.ts";
import { esc, iconeAgente } from "../lib/render.ts";
import { CORES_MASCOTE, FORMAS_MASCOTE, NOME_DA_COR, NOME_DA_FORMA, type EstadoMascote } from "../lib/mascote.ts";
import { ErroDoPreparo, novoPreparo, rodarPreparo, subtituloDoPreparo, tique, type EstadoPreparo, type EtapasDoPreparo } from "../lib/preparo.ts";

/**
 * ADR-174 (2026-11-12, telas 09 e 09b do Paper; o "Create new Bot" e o "Setting up your Bot… {0}%" do Grok Bot): o modal
 * "Criar novo bot" — prévia do personagem, nome, Forma (8) e Cor (12), Cancelar/Criar — e, no mesmo cartão, o preparo
 * com a porcentagem. O cartão vira o preparo (e não uma tela inteira, como no Paper) para não mexer na navegação nem na
 * barra: decisão registrada no PR. Ao chegar a 100% o personagem comemora e a conversa do bot novo abre.
 *
 * As partes de desenho (seletores, prévia, preparo) são puras e servem também ao onboarding (passos 9 e 10).
 */

export const COR_PADRAO: CorAgente = "c-blue";
export const FORMA_PADRAO: FormaAgente = "shape-pebble";
export const NOME_MAX = 40;

/**
 * Tela 09 do Paper: o seletor mostra 8 formas e 12 cores, nesta ordem. As outras continuam válidas (bots antigos, a
 * conversa com o bot): só não aparecem para escolher, salvo a que o bot já usa.
 */
export const FORMAS_DO_SELETOR: readonly FormaAgente[] = ["shape-circle", "shape-pebble", "shape-square", "shape-capsule", "shape-triangle", "shape-hex", "shape-cloud", "shape-drop"];
export const CORES_DO_SELETOR: readonly CorAgente[] = ["c-black", "c-brown", "c-red", "c-orange", "c-amber", "c-green", "c-teal", "c-blue", "c-purple", "c-pink", "c-gray", "c-cream"];
const comAtual = <T extends string>(lista: readonly T[], todas: readonly T[], atual: T): T[] => todas.filter((x) => lista.includes(x) || x === atual).sort((a, b) => (lista.indexOf(a) + 1 || 99) - (lista.indexOf(b) + 1 || 99));

/** Os rádios de forma; `acao` é o data-act (onboarding) ou vazio (o modal escuta sozinho). */
export function htmlSeletorForma(atual: FormaAgente, cor: CorAgente, acao = ""): string {
  const botoes = comAtual(FORMAS_DO_SELETOR, FORMAS_MASCOTE, atual).map((forma) => {
    const sel = forma === atual;
    return `<button type="button" class="cb-forma" role="radio" aria-checked="${sel}" tabindex="${sel ? 0 : -1}" aria-label="${NOME_DA_FORMA[forma]}" title="${NOME_DA_FORMA[forma]}"${acao ? ` data-act="${acao}"` : ""} data-forma="${forma}">${iconeAgente({ nome: NOME_DA_FORMA[forma], cor, forma }, "sm")}</button>`;
  }).join("");
  return `<div class="cb-formas" role="radiogroup" aria-label="Forma">${botoes}</div>`;
}

/** Os rádios de cor (bolinhas). `semPreto`: o onboarding mostra as cores sem o preto, como o seletor do Grok Bot. */
export function htmlSeletorCor(atual: CorAgente, acao = "", semPreto = false): string {
  const botoes = comAtual(CORES_DO_SELETOR, CORES_MASCOTE, atual).filter((c) => !semPreto || c !== "c-black").map((cor) => {
    const sel = cor === atual;
    return `<button type="button" class="cb-cor" role="radio" aria-checked="${sel}" tabindex="${sel ? 0 : -1}" aria-label="${NOME_DA_COR[cor]}" title="${NOME_DA_COR[cor]}"${acao ? ` data-act="${acao}"` : ""} data-cor="${cor}"><span class="cor-amostra ${cor}"></span></button>`;
  }).join("");
  return `<div class="cb-cores" role="radiogroup" aria-label="Cor">${botoes}</div>`;
}

/** O personagem do preparo: trabalha enquanto roda, comemora no fim e espera a pessoa no erro. */
export function estadoDoPreparo(p: EstadoPreparo): EstadoMascote {
  // Enquanto roda, "lendo" (o corpo e os olhos do bot ficam à vista) com a órbita do CSS em volta, como na tela 09b.
  return p.pronto ? "comemorando" : p.erro ? "aguardando" : "lendo";
}

const MARCA: Record<string, string> = {
  feito: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  erro: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  falta: '<span class="cb-ponto" aria-hidden="true"></span>',
};

/**
 * O preparo: personagem, "Preparando a Lia", subtítulo, barra com %, a lista de passos e, no erro, o cartão "Se der
 * erro" com Tentar de novo / Ver o que houve. `acoes` são os atributos dos dois botões (`data-act="…"` ou `data-cb="…"`).
 */
export function htmlPreparo(p: EstadoPreparo, bot: { nome: string; cor: CorAgente; forma: FormaAgente }, acoes: { tentar: string; ver: string }): string {
  const linhas = p.passos.map((x) => {
    const marca = x.situacao === "agora" ? iconeAgente(bot, "sm", "lendo") : MARCA[x.situacao] ?? "";
    return `<li class="cb-passo" data-situacao="${x.situacao}"><span class="cb-marca">${marca}</span><span class="cb-rotulo">${esc(x.rotulo)}</span>${x.detalhe ? `<span class="cb-detalhe">${esc(x.detalhe)}</span>` : ""}</li>`;
  }).join("");
  const titulo = p.pronto ? `${p.nome} está pronto` : `Preparando ${p.nome}`;
  const erro = p.erro
    ? `<div class="cb-erro" role="alert"><p class="cb-erro-titulo">Se der erro</p><p>${esc(p.erro)}</p><div class="cb-erro-acoes"><button type="button" class="bt pri" ${acoes.tentar}>Tentar de novo</button><button type="button" class="bt" ${acoes.ver}>Ver o que houve</button></div></div>`
    : "";
  return `<div class="cb-preparo" data-fim="${p.pronto ? "pronto" : p.erro ? "erro" : ""}">
    <div class="cb-preparo-mascote ${esc(bot.cor)}${p.pronto || p.erro ? "" : " orbita"}">${iconeAgente(bot, "xl", estadoDoPreparo(p))}</div>
    <h2 class="cb-preparo-titulo" tabindex="-1">${esc(titulo)}</h2>
    <p class="cb-preparo-sub" aria-live="polite">${esc(subtituloDoPreparo(p))}</p>
    <div class="cb-barra" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p.porcento}" aria-label="Preparo de ${esc(p.nome)}"><span class="cb-barra-cheia" style="width:${p.porcento}%"></span></div><span class="cb-porcento">${p.porcento}%</span>
    <ol class="cb-passos">${linhas}</ol>${erro}</div>`;
}

/** O formulário do modal (fora o preparo). */
export function htmlFormCriarBot(f: { nome: string; forma: FormaAgente; cor: CorAgente }): string {
  return `<form class="cb-form" method="dialog">
    <header class="cb-topo"><h2 id="cb-titulo">Criar novo bot</h2><button type="button" class="cb-fechar" data-cb="cancelar" aria-label="Fechar">×</button></header>
    <div class="cb-corpo">
      <div class="cb-previa" aria-hidden="true">${iconeAgente({ nome: f.nome || "Novo bot", cor: f.cor, forma: f.forma }, "xl")}</div>
      <input class="cb-nome" name="nome" value="${esc(f.nome)}" maxlength="${NOME_MAX}" placeholder="Nome do bot" aria-label="Nome do bot" autocomplete="off" required />
      <p class="cb-rotulo-grupo">Forma</p>${htmlSeletorForma(f.forma, f.cor)}
      <p class="cb-rotulo-grupo">Cor</p>${htmlSeletorCor(f.cor)}
    </div>
    <footer class="cb-acoes"><button type="button" class="bt" data-cb="cancelar">Cancelar</button><button type="submit" class="bt pri" data-cb="criar">Criar</button></footer>
  </form>`;
}

/** O que o modal precisa do app: criar e vestir o bot, conferir o computador, abrir a conversa. */
export type DepsCriarBot = {
  criar: (nome: string) => Promise<{ agenteId: string; conversaId: string }>;
  vestir: (agenteId: string, forma: FormaAgente, cor: CorAgente) => Promise<void>;
  /** O computador do bot responde? false = fora do ar (o passo para no erro). */
  computadorPronto: (agenteId: string) => Promise<boolean>;
  abrirConversa: (conversaId: string, agenteId: string) => void;
  /** "Ver o que houve": a página do computador do bot (ou a conversa, se não houver). */
  verOQueHouve: (conversaId: string, agenteId: string) => void;
  invalidar: () => void;
};

/** Quanto o personagem comemora antes de a conversa abrir. */
export const COMEMORA_MS = 1_400;

/** As etapas de verdade do preparo de um bot (o modal e o onboarding usam as mesmas). */
export function etapasDoBot(ctx: { nome: string; forma: FormaAgente; cor: CorAgente; criado: { agenteId: string; conversaId: string } | null }, deps: Pick<DepsCriarBot, "criar" | "vestir" | "computadorPronto">, extra: { apps?: (agenteId: string) => Promise<void>; instrucoes?: (conversaId: string) => Promise<void> } = {}): EtapasDoPreparo {
  const id = (): { agenteId: string; conversaId: string } => {
    if (!ctx.criado) throw new ErroDoPreparo(`${ctx.nome} ainda não foi criado.`);
    return ctx.criado;
  };
  return {
    criado: async () => { if (!ctx.criado) ctx.criado = await deps.criar(ctx.nome); },
    apps: async () => {
      const { agenteId } = id();
      await deps.vestir(agenteId, ctx.forma, ctx.cor);
      if (extra.apps) await extra.apps(agenteId);
    },
    computador: async () => {
      if (!(await deps.computadorPronto(id().agenteId))) throw new ErroDoPreparo(`${ctx.nome} não terminou de se preparar.`);
    },
    instrucoes: async () => {
      if (extra.instrucoes) await extra.instrucoes(id().conversaId);
      else await new Promise((r) => setTimeout(r, 700));
    },
  };
}

/** Abre o modal; resolve quando ele fecha. */
export function abrirCriarBot(deps: DepsCriarBot, inicial: { nome?: string } = {}, doc: Document = document): Promise<void> {
  doc.getElementById("criar-bot")?.remove();
  const dlg = doc.createElement("dialog");
  dlg.id = "criar-bot";
  dlg.className = "criar-bot";
  dlg.setAttribute("aria-labelledby", "cb-titulo");
  const f = { nome: (inicial.nome ?? "").slice(0, NOME_MAX), forma: FORMA_PADRAO, cor: COR_PADRAO };
  let preparo: EstadoPreparo | null = null;
  let relogio = 0;
  const ctx = { nome: "", forma: f.forma, cor: f.cor, criado: null as { agenteId: string; conversaId: string } | null };

  const desenharForm = (): void => {
    dlg.innerHTML = htmlFormCriarBot(f);
    const nome = dlg.querySelector<HTMLInputElement>(".cb-nome");
    nome?.addEventListener("input", () => { f.nome = nome.value; atualizarCriar(); });
    atualizarCriar();
  };
  const atualizarCriar = (): void => {
    const criar = dlg.querySelector<HTMLButtonElement>('[data-cb="criar"]');
    if (criar) criar.disabled = !f.nome.trim();
  };
  const trocar = (forma: FormaAgente | null, cor: CorAgente | null): void => {
    if (forma) f.forma = forma;
    if (cor) f.cor = cor;
    const foco = (doc.activeElement as HTMLElement | null)?.dataset;
    const nome = dlg.querySelector<HTMLInputElement>(".cb-nome")?.value ?? f.nome;
    f.nome = nome;
    desenharForm();
    // o foco volta ao rádio que a pessoa escolheu (o formulário é regravado)
    const sel = foco?.forma ? `[data-forma="${f.forma}"]` : foco?.cor ? `[data-cor="${f.cor}"]` : null;
    if (sel) dlg.querySelector<HTMLElement>(sel)?.focus();
  };
  const desenharPreparo = (): void => {
    if (!preparo) return;
    dlg.innerHTML = `<div class="cb-form preparando">${htmlPreparo(preparo, { nome: ctx.nome, cor: ctx.cor, forma: ctx.forma }, { tentar: 'data-cb="tentar"', ver: 'data-cb="ver"' })}</div>`;
  };
  const parar = (): void => { if (relogio) clearInterval(relogio); relogio = 0; };
  const rodar = async (): Promise<void> => {
    if (!preparo) return;
    parar();
    relogio = window.setInterval(() => { if (preparo) { preparo = tique(preparo); atualizarBarra(); } }, 120);
    const fim = await rodarPreparo(preparo, etapasDoBot(ctx, deps), (p) => { preparo = p; desenharPreparo(); });
    parar();
    deps.invalidar();
    if (fim.pronto && ctx.criado) {
      const { conversaId, agenteId } = ctx.criado;
      window.setTimeout(() => { fechar(); deps.abrirConversa(conversaId, agenteId); }, COMEMORA_MS);
    } else dlg.querySelector<HTMLElement>('[data-cb="tentar"]')?.focus();
  };
  // Só a barra e o número mudam a cada tique: regravar o cartão inteiro reiniciaria o personagem.
  const atualizarBarra = (): void => {
    if (!preparo) return;
    const cheia = dlg.querySelector<HTMLElement>(".cb-barra-cheia");
    if (cheia) cheia.style.width = `${preparo.porcento}%`;
    dlg.querySelector(".cb-barra")?.setAttribute("aria-valuenow", String(preparo.porcento));
    const n = dlg.querySelector(".cb-porcento");
    if (n) n.textContent = `${preparo.porcento}%`;
  };
  let resolver: () => void = () => undefined;
  const fechar = (): void => {
    parar();
    if (dlg.open) dlg.close();
    dlg.remove();
    resolver();
  };

  dlg.addEventListener("click", (ev) => {
    const alvo = ev.target instanceof Element ? ev.target : null;
    if (!alvo) return;
    if (alvo === dlg && !preparo) { fechar(); return; }
    const forma = alvo.closest<HTMLElement>("[data-forma]")?.dataset.forma as FormaAgente | undefined;
    const cor = alvo.closest<HTMLElement>("[data-cor]")?.dataset.cor as CorAgente | undefined;
    if (forma || cor) { trocar(forma ?? null, cor ?? null); return; }
    const cb = alvo.closest<HTMLElement>("[data-cb]")?.dataset.cb;
    if (cb === "cancelar") fechar();
    else if (cb === "tentar") void rodar();
    else if (cb === "ver" && ctx.criado) { const { conversaId, agenteId } = ctx.criado; fechar(); deps.verOQueHouve(conversaId, agenteId); }
  });
  // Setas andam pelos rádios (forma e cor), como no popover do perfil.
  dlg.addEventListener("keydown", (ev) => {
    const alvo = ev.target instanceof HTMLElement ? ev.target : null;
    if (!alvo || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(ev.key)) return;
    const grupo = alvo.closest('[role="radiogroup"]');
    if (!grupo) return;
    const todos = [...grupo.querySelectorAll<HTMLElement>('[role="radio"]')];
    const i = todos.indexOf(alvo);
    const passo = ev.key === "ArrowLeft" || ev.key === "ArrowUp" ? -1 : 1;
    const prox = todos[(i + passo + todos.length) % todos.length];
    if (!prox) return;
    ev.preventDefault();
    prox.focus();
    trocar((prox.dataset.forma as FormaAgente | undefined) ?? null, (prox.dataset.cor as CorAgente | undefined) ?? null);
  });
  dlg.addEventListener("submit", (ev) => {
    ev.preventDefault();
    if (!f.nome.trim() || preparo) return;
    ctx.nome = f.nome.trim();
    ctx.forma = f.forma;
    ctx.cor = f.cor;
    preparo = novoPreparo(ctx.nome);
    desenharPreparo();
    dlg.querySelector<HTMLElement>(".cb-preparo-titulo")?.focus();
    void rodar();
  });
  // Esc durante o preparo não fecha: o bot já está sendo criado (o X e Cancelar somem com o formulário).
  dlg.addEventListener("cancel", (ev) => { if (preparo && !preparo.erro) ev.preventDefault(); else { ev.preventDefault(); fechar(); } });

  desenharForm();
  doc.body.append(dlg);
  dlg.showModal();
  dlg.querySelector<HTMLInputElement>(".cb-nome")?.focus();
  return new Promise((r) => { resolver = r; });
}
