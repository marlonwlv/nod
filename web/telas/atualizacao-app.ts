/**
 * ADR-188 (Paper "Atualizar o nod · opções", A3 e D): o cartão "Atualizar o nod" no pé da barra e a seção
 * Configurações › Sobre o nod. O cartão é o botão: um clique e a tinta sobe sozinha de baixo para cima em 800 ms (o
 * líquido do +), o cartão vira o spinner e o app reinicia. Decisão do dono na validação de 2026-11-18: o segurar
 * confundiria; o clique é o gesto de sempre e a animação continua contando o que acontece. Com bot trabalhando, o cartão
 * pergunta (esperar ou reiniciar já); em ligação, recusa.
 */
import { esc } from "../lib/render.ts";
import { grupoConfig, linhaConfig } from "../lib/linha-config.ts";
import type { PerguntaReinicio, TelaAtualizacao } from "../lib/atualizacao-app.ts";

/** definido em 2026-11-18 (Paper A3): o tempo da tinta subindo depois do clique, antes de pedir o reinício. */
export const MS_ENCHER_ATUALIZAR = 800;
/** A entrada do cartão (o espaço abre e o cartão surge): o mesmo tempo em web/atualizacao-app.css (--ms-entrar). */
export const MS_ENTRAR_ATUALIZAR = 520;

const IC_ATUALIZAR = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v2.8h-2.8"/></svg>';
const IC_GIRANDO = '<svg class="atz-girando" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="5.5" opacity=".3"/><path d="M8 2.5a5.5 5.5 0 0 1 5.5 5.5"/></svg>';

export const TEXTOS_ATZ = {
  titulo: "Atualizar o nod",
  pronta: (v: string) => `${v} pronta · clique para reiniciar`,
  rotulo: (v: string) => `Atualizar o nod para a versão ${v}. Reinicia o app.`,
  enchendo: "Preparando…",
  reiniciando: "Reiniciando…",
  volta: "O nod volta em alguns segundos",
  esperando: "Reinicia quando os bots terminarem",
  esperandoSub: (v: string) => `A ${v} entra sozinha`,
  ocupado: (p: { turnos: number; telas: number }) => p.turnos > 1 ? `${p.turnos} bots estão trabalhando neste Mac` : p.turnos === 1 ? "Um bot está trabalhando neste Mac" : p.telas > 1 ? `Há ${p.telas} telas abertas no computador do bot` : "Há uma tela aberta no computador do bot",
  ocupadoSub: "Reiniciar agora interrompe o trabalho. O nod pode esperar e reiniciar sozinho.",
  emLigacao: "Termine a ligação para reiniciar o nod",
  atualizado: (v: string) => `nod atualizado para a ${v}`,
} as const;

function miolo(icone: string, titulo: string, sub: string, extra = ""): string {
  return `<span class="atz-miolo${extra}"><span class="atz-ic">${icone}</span><span class="atz-txt"><b>${esc(titulo)}</b><small>${esc(sub)}</small></span></span>`;
}

/** A pergunta depois do clique: no cartão da barra e em Sobre o nod. */
export function perguntaReinicio(p: PerguntaReinicio, pedindo: boolean): string {
  const des = pedindo ? " disabled" : "";
  if (p.tipo === "emLigacao") {
    return `<div class="atz-pergunta" role="alertdialog" aria-labelledby="atz-p-tit"><b id="atz-p-tit">${esc(TEXTOS_ATZ.emLigacao)}</b><div class="atz-acoes"><button type="button" class="atz-bt atz-bt-sec" data-act="atualizar-app-fechar">OK</button></div></div>`;
  }
  return `<div class="atz-pergunta" role="alertdialog" aria-labelledby="atz-p-tit" aria-describedby="atz-p-txt"><b id="atz-p-tit">${esc(TEXTOS_ATZ.ocupado(p))}</b><p id="atz-p-txt">${esc(TEXTOS_ATZ.ocupadoSub)}</p><div class="atz-acoes"><button type="button" class="atz-bt atz-bt-pri" data-act="atualizar-app-quando-livre"${des}>Reiniciar quando terminar</button><button type="button" class="atz-bt atz-bt-sec" data-act="atualizar-app-forcar"${des}>Reiniciar agora</button><button type="button" class="atz-bt atz-bt-link" data-act="atualizar-app-fechar">Cancelar</button></div></div>`;
}

/**
 * O cartão do pé da barra ("" quando não há versão pronta). `compacta`: a barra só com avatares (um redondo).
 * Enchendo, a tinta é uma animação com atraso negativo (o tempo desde o clique): a barra regravada no meio (um frame do
 * SSE) desenha um nó novo, e ele continua de onde a tinta estava em vez de recomeçar vazio.
 */
export function cartaoAtualizacao(t: TelaAtualizacao | null, compacta: boolean, agora = Date.now()): string {
  if (!t || t.estado.fase !== "pronta") return "";
  const v = t.estado.versaoNova ?? "nova";
  const enchendo = t.enchendoDesde !== null && !t.pedindo && !t.pergunta && !t.estado.reiniciando;
  const atraso = enchendo ? ` style="--atz-atraso:-${Math.max(0, Math.min(MS_ENCHER_ATUALIZAR, Math.round(agora - (t.enchendoDesde ?? agora))))}ms"` : "";
  const liquido = '<span class="atz-liquido" aria-hidden="true"><span class="atz-tinta"><span class="atz-onda"></span></span></span>';
  // A entrada toca uma vez: a barra é regravada a cada frame do SSE, e o atraso negativo (o tempo desde que ficou pronta)
  // faz o nó novo continuar a animação, ou já nascer no fim dela, em vez de entrar de novo.
  const desdePronta = t.prontaDesde === null ? Infinity : agora - t.prontaDesde;
  const entra = desdePronta < MS_ENTRAR_ATUALIZAR + 200 ? ` atz-entra" style="--atz-entrada:-${Math.max(0, Math.round(desdePronta))}ms` : "";
  if (compacta) {
    // Na barra recolhida não cabe a pergunta: o redondo enche igual; perguntando ou esperando, abre Sobre o nod.
    if (t.pergunta || t.estado.esperandoLivre || t.estado.reiniciando) {
      return `<div class="atz atz-compacta"><button type="button" class="atz-redondo" data-act="secao-espaco" data-secao="sobre" aria-label="${esc(t.estado.reiniciando ? TEXTOS_ATZ.reiniciando : t.estado.esperandoLivre ? TEXTOS_ATZ.esperando : "Atualizar o nod: ver a pergunta")}" data-etiqueta="Atualizar o nod">${t.estado.reiniciando ? IC_GIRANDO : IC_ATUALIZAR}<span class="atz-ponto" aria-hidden="true"></span></button></div>`;
    }
    if (t.pedindo) return `<div class="atz atz-compacta"><span class="atz-redondo atz-cheio" role="status" aria-label="${esc(TEXTOS_ATZ.reiniciando)}">${IC_GIRANDO}</span></div>`;
    return `<div class="atz atz-compacta${entra}"><button type="button" class="atz-redondo${enchendo ? " enchendo" : ""}" data-act="atualizar-app"${atraso} aria-label="${esc(enchendo ? TEXTOS_ATZ.enchendo : TEXTOS_ATZ.rotulo(v))}" data-etiqueta="Atualizar o nod"${enchendo ? ' aria-disabled="true"' : ""}>${liquido}<span class="atz-ic-redondo">${IC_ATUALIZAR}</span><span class="atz-ponto" aria-hidden="true"></span></button></div>`;
  }
  if (t.estado.reiniciando) {
    return `<div class="atz"><div class="atz-cartao atz-cheio" role="status">${miolo(IC_GIRANDO, TEXTOS_ATZ.reiniciando, TEXTOS_ATZ.volta)}</div></div>`;
  }
  if (t.pergunta) return `<div class="atz">${perguntaReinicio(t.pergunta, t.pedindo)}</div>`;
  if (t.estado.esperandoLivre) {
    return `<div class="atz"><div class="atz-cartao atz-esperando" role="status">${miolo(IC_ATUALIZAR, TEXTOS_ATZ.esperando, TEXTOS_ATZ.esperandoSub(v))}<button type="button" class="atz-bt atz-bt-link atz-cancelar" data-act="atualizar-app-cancelar-espera">Cancelar</button></div></div>`;
  }
  // A tinta encheu e o pedido saiu: o cartão fica cheio, com o spinner, até a resposta — "Reiniciando…" ou a pergunta.
  if (t.pedindo) return `<div class="atz"><div class="atz-cartao atz-cheio" role="status">${miolo(IC_GIRANDO, TEXTOS_ATZ.titulo, "Um instante…")}</div></div>`;
  // O miolo escuro e o claro são o mesmo desenho: o claro fica por cima, recortado na altura da tinta (o texto vira branco
  // onde o líquido passa). Só o escuro é lido; o claro é aria-hidden.
  return `<div class="atz${entra}"><button type="button" class="atz-cartao${enchendo ? " enchendo" : ""}" data-act="atualizar-app"${atraso} aria-label="${esc(enchendo ? TEXTOS_ATZ.enchendo : TEXTOS_ATZ.rotulo(v))}"${enchendo ? ' aria-disabled="true"' : ""}>${miolo(IC_ATUALIZAR, TEXTOS_ATZ.titulo, TEXTOS_ATZ.pronta(v))}${liquido}<span class="atz-claro" aria-hidden="true">${miolo(IC_ATUALIZAR, TEXTOS_ATZ.titulo, TEXTOS_ATZ.enchendo)}</span></button></div>`;
}

function horaDaProcura(ms: number, agora: number): string {
  const d = new Date(ms);
  const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return new Date(agora).toDateString() === d.toDateString() ? `hoje, ${hora}` : `${d.toLocaleDateString("pt-BR", { day: "numeric", month: "short" })}, ${hora}`;
}

/** O topo de Sobre o nod: o que está acontecendo com a versão, e o botão quando há o que fazer. */
function destaque(t: TelaAtualizacao): string {
  const e = t.estado;
  const caixa = (titulo: string, sub: string, acao = "", classe = "") => `<div class="atz-destaque${classe}"><span class="atz-marca" aria-hidden="true">nod</span><span class="atz-txt"><b>${esc(titulo)}</b><small>${esc(sub)}</small></span>${acao}</div>`;
  if (e.fase === "pronta") {
    const v = e.versaoNova ?? "nova";
    if (e.reiniciando) return caixa(TEXTOS_ATZ.reiniciando, TEXTOS_ATZ.volta, "", " atz-destaque-cheio");
    if (t.pergunta) return caixa(`A versão ${v} está pronta`, `Você usa a ${e.versaoAtual}.`) + perguntaReinicio(t.pergunta, t.pedindo);
    if (e.esperandoLivre) return caixa(TEXTOS_ATZ.esperando, TEXTOS_ATZ.esperandoSub(v), '<button type="button" class="bt sm" data-act="atualizar-app-cancelar-espera">Cancelar</button>');
    return caixa(`A versão ${v} está pronta`, `Você usa a ${e.versaoAtual}. Reiniciar leva uns segundos e as conversas voltam onde estavam.`, `<button type="button" class="bt pri sm" data-act="atualizar-app-agora"${t.pedindo ? " disabled" : ""}>Reiniciar agora</button>`);
  }
  if (e.fase === "baixando") return caixa("Baixando a versão nova…", `Você usa a ${e.versaoAtual}. Quando terminar, é só reiniciar.`);
  if (e.fase === "procurando") return caixa("Procurando atualização…", `Você usa a ${e.versaoAtual}.`);
  if (e.fase === "erro") return caixa("Não deu para atualizar agora", e.motivo ?? "Tente de novo mais tarde.");
  if (e.fase === "desligada") return caixa(`nod ${e.versaoAtual}`, e.motivo ?? "A atualização automática está desligada neste app.");
  return caixa("O nod está atualizado", `Você usa a ${e.versaoAtual}.`);
}

/** Configurações › Sobre o nod. `t` null com ponte = carregando; sem ponte = a web no navegador. */
export function renderSobre(t: TelaAtualizacao | null, temPonte: boolean, agora: number): string {
  const topo = `<h2>Sobre o nod</h2><p class="intro">A versão do nod neste computador e como ele se atualiza. O nod baixa as versões novas sozinho; reiniciar é o único passo.</p>`;
  if (!temPonte) {
    return `<section class="espaco-secao cfg-secao cfg-sobre"><h2>Sobre o nod</h2><p class="intro">No navegador, o nod já está sempre na versão mais nova: ela entra quando a página recarrega. O app do Mac e do Windows mostra aqui a versão dele e como ele se atualiza.</p></section>`;
  }
  if (!t) return `<section class="espaco-secao cfg-secao cfg-sobre">${topo}<p class="lc-nota">Carregando…</p></section>`;
  const e = t.estado;
  const desligada = e.fase === "desligada";
  const ultima = e.procuradaEm ? `Última procura: ${horaDaProcura(e.procuradaEm, agora)}.` : "";
  const podeProcurar = e.fase === "ociosa" || e.fase === "erro";
  const grupo = desligada ? "" : grupoConfig("Atualizações", [
    ...(e.sozinho === null ? [] : [linhaConfig({
      titulo: "Reiniciar sozinho quando você sair",
      ajuste: "reiniciar-sozinho",
      detalhe: "Com uma versão pronta, o nod reinicia depois de 15 minutos sem teclado e mouse, se nenhum bot estiver trabalhando e não houver ligação.",
      controle: { tipo: "switch", ligado: e.sozinho, acao: "atualizar-app-sozinho" },
    })]),
    linhaConfig({
      titulo: "Procurar atualizações",
      ajuste: "procurar-atualizacoes",
      detalhe: `O nod procura a cada 4 horas. ${ultima}`.trim(),
      controle: { tipo: "html", html: `<button type="button" class="bt sm" data-act="atualizar-app-procurar"${podeProcurar ? "" : " disabled"}>${e.fase === "procurando" ? "Procurando…" : "Procurar agora"}</button>` },
    }),
  ]);
  return `<section class="espaco-secao cfg-secao cfg-sobre">${topo}${destaque(t)}${grupo}<p class="atz-rodape">nod ${esc(e.versaoAtual)}</p></section>`;
}
