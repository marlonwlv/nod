import type { CorAgente, FormaAgente } from "../../src/contracts/agente.ts";
import { esc, iconeAgente } from "../lib/render.ts";
import { CORES_MASCOTE, FORMAS_MASCOTE, NOME_DA_COR, NOME_DA_FORMA, type EstadoMascote } from "../lib/mascote.ts";
import { ErroDoPreparo, subtituloDoPreparo, type EstadoPreparo, type EtapasDoPreparo } from "../lib/preparo.ts";

/**
 * ADR-174 (2026-11-12, telas 09 e 09b do Paper): o personagem do bot — seletores de forma e cor e o preparo com % (o
 * onboarding, passos 9 e 10, usa os dois). Spec do botão + (2026-11-12): o diálogo "Criar novo bot" (fim do arquivo)
 * deixou de ter o preparo: Criar → "Criando…" → a conversa do bot novo, pelo mesmo criarAgente interativo do segurar.
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

/** Os rádios de cor (bolinhas). `semPreto`: o onboarding mostra as cores sem o preto. */
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

/** O que o preparo do onboarding precisa do app: criar e vestir o bot, conferir o computador, abrir a conversa. */
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

/* ---- O diálogo "Criar novo bot" (spec do botão +, telas 1 e 2) ------------------------------------------------------
   Clique no + e ⌘N abrem este diálogo: prévia, nome, Forma (8, linhas de 5 + 3) e Cor (12, linhas de 6 + 6),
   Cancelar/Criar. Criar chama o MESMO criarAgente interativo do segurar (o que grava a fala boas_vindas), já com nome,
   forma e cor; a conversa troca para o bot novo e o diálogo fecha seco. Sem preparo com %: o preparo continua só no
   onboarding (htmlPreparo/etapasDoBot acima). */

/** A ordem das cores no diálogo: preto, marrom, vermelho, laranja, âmbar, verde / turquesa, azul, violeta, rosa, cinza, creme. */
export const ORDEM_DAS_CORES: readonly CorAgente[] = CORES_DO_SELETOR;
/** Quantas formas e cores vão em cada linha. */
export const LINHAS_DAS_FORMAS = [5, 3] as const;
export const LINHAS_DAS_CORES = [6, 6] as const;

export type Aparencia = { forma: FormaAgente; cor: CorAgente };

const sortear = <T>(lista: readonly T[], aleatorio: () => number): T => lista[Math.min(lista.length - 1, Math.max(0, Math.floor(aleatorio() * lista.length)))] as T;

/** Forma e cor sorteadas entre as do seletor. `aleatorio` devolve [0, 1) (Math.random). */
export function sortearAparencia(aleatorio: () => number = Math.random): Aparencia {
  return { forma: sortear(FORMAS_DO_SELETOR, aleatorio), cor: sortear(ORDEM_DAS_CORES, aleatorio) };
}

/**
 * A memória da forma e da cor na sessão: a 1ª abertura sorteia; fechar e reabrir mantém a última escolha (mesmo sem
 * criar). A sessão é a vida da página (o módulo), não o disco.
 */
export function criarMemoriaDaAparencia(aleatorio: () => number = Math.random): { atual(): Aparencia; lembrar(a: Aparencia): void } {
  let guardada: Aparencia | null = null;
  return {
    atual: () => (guardada ??= sortearAparencia(aleatorio)),
    lembrar: (a) => { guardada = { forma: a.forma, cor: a.cor }; },
  };
}

const memoriaDaSessao = criarMemoriaDaAparencia();

/** O nome que habilita Criar: algo além de espaços, até NOME_MAX. */
export function nomeDoBotValido(nome: string): boolean {
  const limpo = nome.trim();
  return limpo.length > 0 && limpo.length <= NOME_MAX;
}

/** Corta a lista nas linhas dadas ([5, 3] → as 5 primeiras e as 3 seguintes). */
export function emLinhas<T>(lista: readonly T[], linhas: readonly number[]): T[][] {
  let i = 0;
  return linhas.map((n) => { const linha = lista.slice(i, i + n); i += n; return linha; }).filter((l) => l.length > 0);
}

/** Os rádios de forma do diálogo, todos pintados na cor escolhida. */
export function htmlFormasDoDialogo(atual: FormaAgente, cor: CorAgente, desabilitado = false): string {
  const linhas = emLinhas(FORMAS_DO_SELETOR, LINHAS_DAS_FORMAS).map((linha) => `<div class="cnb-linha">${linha.map((forma) => {
    const sel = forma === atual;
    return `<button type="button" class="cnb-forma" role="radio" aria-checked="${sel}" tabindex="${sel ? 0 : -1}" aria-label="Forma ${NOME_DA_FORMA[forma]}" data-forma="${forma}"${desabilitado ? " disabled" : ""}>${iconeAgente({ nome: NOME_DA_FORMA[forma], cor, forma }, "sm")}</button>`;
  }).join("")}</div>`).join("");
  return `<div class="cnb-formas" role="radiogroup" aria-label="Forma do personagem">${linhas}</div>`;
}

/** Os rádios de cor do diálogo (bolinhas de 24 em botões de 32). */
export function htmlCoresDoDialogo(atual: CorAgente, desabilitado = false): string {
  const linhas = emLinhas(ORDEM_DAS_CORES, LINHAS_DAS_CORES).map((linha) => `<div class="cnb-linha">${linha.map((cor) => {
    const sel = cor === atual;
    return `<button type="button" class="cnb-cor" role="radio" aria-checked="${sel}" tabindex="${sel ? 0 : -1}" aria-label="Cor ${NOME_DA_COR[cor]}" data-cor="${cor}"${desabilitado ? " disabled" : ""}><span class="cor-amostra cnb-bolinha ${cor}"></span></button>`;
  }).join("")}</div>`).join("");
  return `<div class="cnb-cores" role="radiogroup" aria-label="Cor do personagem">${linhas}</div>`;
}

const IC_FECHAR = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M3.5 3.5l7 7M10.5 3.5l-7 7"/></svg>';

/** O conteúdo do diálogo. `criando`: Criar vira "Criando…" e todos os controles ficam desabilitados (tela 2). */
export function htmlDialogoCriarBot(f: { nome: string; forma: FormaAgente; cor: CorAgente; criando?: boolean; erro?: string | null }): string {
  const criando = f.criando === true;
  const off = criando ? " disabled" : "";
  const podeCriar = nomeDoBotValido(f.nome) && !criando;
  return `<form class="cnb" method="dialog" novalidate>
    <header class="cnb-topo"><h2 id="cnb-titulo">Criar novo bot</h2><button type="button" class="cnb-fechar" data-cb="cancelar" aria-label="Fechar caixa de diálogo"${off}>${IC_FECHAR}</button></header>
    <div class="cnb-corpo">
      <div class="cnb-previa" aria-hidden="true">${iconeAgente({ nome: f.nome.trim() || "Novo bot", cor: f.cor, forma: f.forma }, "xl")}</div>
      <input class="cnb-nome" name="nome" value="${esc(f.nome)}" maxlength="${NOME_MAX}" placeholder="Dê um nome ao seu bot" aria-label="Nome do bot" autocomplete="off" spellcheck="false"${off} />
      ${htmlFormasDoDialogo(f.forma, f.cor, criando)}
      ${htmlCoresDoDialogo(f.cor, criando)}
      ${f.erro ? `<p class="cnb-erro" role="alert">${esc(f.erro)}</p>` : ""}
    </div>
    <footer class="cnb-rodape"><button type="button" class="cnb-bt cnb-cancelar" data-cb="cancelar"${off}>Cancelar</button><button type="submit" class="cnb-bt cnb-criar" data-cb="criar"${podeCriar ? "" : " disabled"}${criando ? ' aria-busy="true"' : ""}>${criando ? "Criando…" : "Criar"}</button></footer>
  </form>`;
}

/** O pedido que sai do diálogo: o mesmo criarAgente interativo do segurar, com nome, forma e cor. */
export type PedidoCriarBot = { nome: string; forma: FormaAgente; cor: CorAgente };

/** O que o diálogo pede ao app. */
export type DepsDialogoCriarBot = {
  criar: (p: PedidoCriarBot) => Promise<{ agenteId: string; conversaId: string }>;
  /** Clicou em Criar: a barra mostra a linha provisória (tela 3). */
  aoComecar?: (p: PedidoCriarBot) => void;
  /** A API devolveu: a conversa por trás troca para o bot novo (o diálogo fecha no quadro seguinte). */
  aoCriar: (criado: { agenteId: string; conversaId: string }, p: PedidoCriarBot) => void;
  /** Deu erro: some a linha provisória (o diálogo volta a deixar editar). */
  aoFalhar?: (p: PedidoCriarBot) => void;
  /** Depois de fechar por ter criado: o foco vai ao campo da conversa. */
  depoisDeCriar?: (criado: { agenteId: string; conversaId: string }) => void;
};

export const ERRO_AO_CRIAR = "Não deu para criar o bot. Tente de novo.";

/** Abre o diálogo "Criar novo bot"; resolve quando ele fecha (true = criou). */
export function abrirCriarBot(deps: DepsDialogoCriarBot, inicial: { nome?: string } = {}, doc: Document = document, memoria = memoriaDaSessao): Promise<boolean> {
  doc.getElementById("criar-bot")?.remove();
  const dlg = doc.createElement("dialog");
  dlg.id = "criar-bot";
  dlg.className = "criar-bot";
  dlg.setAttribute("role", "dialog");
  dlg.setAttribute("aria-modal", "true");
  dlg.setAttribute("aria-labelledby", "cnb-titulo");
  const f = { nome: (inicial.nome ?? "").slice(0, NOME_MAX), ...memoria.atual(), criando: false, erro: null as string | null };
  let criou = false;
  let resolver: (criou: boolean) => void = () => undefined;

  const campo = (): HTMLInputElement | null => dlg.querySelector<HTMLInputElement>(".cnb-nome");
  const desenhar = (): void => { dlg.innerHTML = htmlDialogoCriarBot(f); };
  const atualizarCriar = (): void => {
    const criar = dlg.querySelector<HTMLButtonElement>(".cnb-criar");
    if (criar) criar.disabled = f.criando || !nomeDoBotValido(f.nome);
  };
  // Trocar forma ou cor regrava só a prévia e os dois grupos (o campo de nome fica, com o cursor onde estava).
  const trocar = (forma: FormaAgente | null, cor: CorAgente | null, focar: "forma" | "cor" | null): void => {
    if (forma) f.forma = forma;
    if (cor) f.cor = cor;
    memoria.lembrar(f);
    const previa = dlg.querySelector(".cnb-previa");
    if (previa) previa.innerHTML = iconeAgente({ nome: f.nome.trim() || "Novo bot", cor: f.cor, forma: f.forma }, "xl");
    dlg.querySelector(".cnb-formas")?.replaceWith(paraNo(htmlFormasDoDialogo(f.forma, f.cor)));
    dlg.querySelector(".cnb-cores")?.replaceWith(paraNo(htmlCoresDoDialogo(f.cor)));
    if (focar === "forma") dlg.querySelector<HTMLElement>(`[data-forma="${f.forma}"]`)?.focus();
    if (focar === "cor") dlg.querySelector<HTMLElement>(`[data-cor="${f.cor}"]`)?.focus();
  };
  const paraNo = (html: string): Element => {
    const t = doc.createElement("template");
    t.innerHTML = html;
    return t.content.firstElementChild ?? doc.createElement("div");
  };
  const fechar = (): void => {
    if (dlg.open) dlg.close();
    dlg.remove();
    resolver(criou);
  };
  const enviar = async (): Promise<void> => {
    if (f.criando || !nomeDoBotValido(f.nome)) return;
    const pedido: PedidoCriarBot = { nome: f.nome.trim(), forma: f.forma, cor: f.cor };
    f.criando = true;
    f.erro = null;
    desenhar();
    dlg.classList.add("criando");
    deps.aoComecar?.(pedido);
    try {
      const criado = await deps.criar(pedido);
      criou = true;
      deps.aoCriar(criado, pedido);
      // A conversa já trocou por trás; o diálogo fecha seco no quadro seguinte.
      (doc.defaultView ?? window).requestAnimationFrame(() => { fechar(); deps.depoisDeCriar?.(criado); });
    } catch {
      f.criando = false;
      f.erro = ERRO_AO_CRIAR;
      dlg.classList.remove("criando");
      deps.aoFalhar?.(pedido);
      desenhar();
      campo()?.focus();
    }
  };

  dlg.addEventListener("input", (ev) => {
    if (ev.target !== campo()) return;
    f.nome = campo()?.value ?? "";
    atualizarCriar();
    const previa = dlg.querySelector(".cnb-previa");
    if (previa) previa.innerHTML = iconeAgente({ nome: f.nome.trim() || "Novo bot", cor: f.cor, forma: f.forma }, "xl");
  });
  dlg.addEventListener("click", (ev) => {
    const alvo = ev.target instanceof Element ? ev.target : null;
    if (!alvo || f.criando) return;
    // O scrim (o próprio <dialog> fora da caixa) fecha sem criar.
    if (alvo === dlg) { fechar(); return; }
    const forma = alvo.closest<HTMLElement>("[data-forma]")?.dataset.forma as FormaAgente | undefined;
    const cor = alvo.closest<HTMLElement>("[data-cor]")?.dataset.cor as CorAgente | undefined;
    if (forma || cor) { trocar(forma ?? null, cor ?? null, forma ? "forma" : "cor"); return; }
    if (alvo.closest<HTMLElement>("[data-cb]")?.dataset.cb === "cancelar") fechar();
  });
  // Setas andam pelos rádios (forma e cor), em volta.
  dlg.addEventListener("keydown", (ev) => {
    const alvo = ev.target instanceof HTMLElement ? ev.target : null;
    if (!alvo || f.criando || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(ev.key)) return;
    const grupo = alvo.closest('[role="radiogroup"]');
    if (!grupo) return;
    const todos = [...grupo.querySelectorAll<HTMLElement>('[role="radio"]')];
    const passo = ev.key === "ArrowLeft" || ev.key === "ArrowUp" ? -1 : 1;
    const prox = todos[(todos.indexOf(alvo) + passo + todos.length) % todos.length];
    if (!prox) return;
    ev.preventDefault();
    const forma = (prox.dataset.forma as FormaAgente | undefined) ?? null;
    trocar(forma, (prox.dataset.cor as CorAgente | undefined) ?? null, forma ? "forma" : "cor");
  });
  // Enter no nome = Criar (o submit do formulário).
  dlg.addEventListener("submit", (ev) => { ev.preventDefault(); void enviar(); });
  // Esc fecha sem criar; enquanto cria, não (o bot já está sendo criado).
  dlg.addEventListener("cancel", (ev) => { ev.preventDefault(); if (!f.criando) fechar(); });

  desenhar();
  doc.body.append(dlg);
  dlg.showModal();
  campo()?.focus();
  return new Promise((r) => { resolver = r; });
}
