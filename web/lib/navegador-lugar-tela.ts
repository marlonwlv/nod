import type { PayloadNavegadorLugar, PayloadNavegadorPergunta, RespostaLugarNavegador } from "../../src/contracts/navegador-do-bot.ts";
import { esc } from "./escape.ts";
import { comArtigo } from "./navegador-vista.ts";

/**
 * Onde o navegador do bot mora, na tela (ADR-190; Paper M, N, J e K): a linha "Com o Mac desligado" do painel do bot com
 * o interruptor (M1, J2, N2), a lista que abre ao tocar na frase (N3), os cartões da conversa — a pergunta "Às 3h seu Mac
 * costuma estar desligado" (M2, J1, N1), a resposta registrada (J2), o "Seu Mac está desligado" do pedido feito com o Mac
 * desligado (M3, K1, K2) — e as linhas de quando o lugar muda sozinho (N, "Quando algo muda"). Tudo puro: o HTML sai pronto
 * e o teste lê sem navegador. Quem responde é o main.ts, pelos `data-act` (nv-lugar-abrir, nv-lugar-mudar,
 * nv-mac-desligado, nv-ver-maquinas, conectar-sempre-ligada).
 *
 * Medidas do Paper (get_jsx, YR7-0): cartão de borda azul a 33 %, raio 14, padding 14, gap 10; título 14/19 semibold;
 * texto 12/19 cinza; botões 13/19, raio 10, padding 8, lado a lado e do mesmo tamanho; a frase de baixo 12/17 com o lugar em
 * semibold e "Trocar" azul à direita. A linha do painel: ☾ 16 px, título 13/18, subtítulo 12/16, interruptor 42 × 24 verde
 * do ao vivo. A lista: 300 px, raio 12, padding 6, sombra 0 8 24; itens 13/18 com o ✓ numa coluna de 14 px e o "● ligada"
 * de 12 px à direita; divisória de 1 px; o link azul 13/18 com a dica 12/16.
 */

/** O lugar escolhido agora (a mesma regra de `maquinaPreferida` do domínio): "nod" ou o id da máquina. */
export function lugarEscolhido(r: Pick<RespostaLugarNavegador, "maquinaId" | "maquinas" | "maquinaDoComputador">): string {
  if (r.maquinaId === "nod") return "nod";
  const achar = (id: string | null) => (id ? r.maquinas.find((m) => m.id === id) ?? null : null);
  return (achar(r.maquinaId) ?? achar(r.maquinaDoComputador) ?? r.maquinas[0])?.id ?? "nod";
}

/** "Na vm-sp", "No nod": o lugar como item da lista e como subtítulo da linha "Onde a Ada trabalha". */
export function nomeDoLugar(r: Pick<RespostaLugarNavegador, "maquinaId" | "maquinas" | "maquinaDoComputador">): string {
  const id = lugarEscolhido(r);
  const m = r.maquinas.find((x) => x.id === id);
  return m ? `Na ${m.nome}` : "No nod";
}

const ICONE_LUA = '<svg class="gv-ic" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 9.6A5.5 5.5 0 0 1 6.4 3a5.5 5.5 0 1 0 6.6 6.6z"/></svg>';
const ICONE_LUGAR = '<svg class="gv-ic" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="12" height="9" rx="1.5"/><path d="M6 14h4"/></svg>';
const CHEVRON = '<svg class="gv-chev" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 4l4 4-4 4"/></svg>';
const mudar = (agenteId: string, m: object) => `data-act="nv-lugar-mudar" data-id="${esc(agenteId)}" data-mudar="${esc(JSON.stringify(m))}"`;

/**
 * N3: "Com o Mac desligado, a Ada continua" — as máquinas sempre ligadas (com "● ligada"), "No nod", a divisória e o
 * caminho para mais: "Usar uma máquina sua" (sem nenhuma) ou "Ver máquinas". Sem o app no computador, o título é "Onde a
 * Ada trabalha".
 */
export function htmlListaDoLugar(r: RespostaLugarNavegador, o: { agenteId: string; nome: string; chave: string }): string {
  const atual = lugarEscolhido(r);
  const item = (id: string, rotulo: string, ligada: boolean | null) => {
    const marcado = id === atual;
    const mudanca = id === "nod" ? { maquinaId: "nod" } : { maquinaId: id };
    const estado = ligada === null ? "" : ligada ? '<span class="nvl-ligada"><i aria-hidden="true"></i>ligada</span>' : '<span class="nvl-ligada fora">fora do ar</span>';
    return `<button type="button" class="nvl-item" role="menuitemradio" aria-checked="${marcado}" ${mudar(o.agenteId, mudanca)}><span class="nvl-check" aria-hidden="true">${marcado ? "✓" : ""}</span><span class="nvl-rotulo">${esc(rotulo)}</span>${estado}</button>`;
  };
  // N3 (Paper YTO-0, YWX-0): "Com o Mac desligado, a Ada continua"; sem o app, "Onde a Ada trabalha".
  const titulo = r.temApp ? `Com o ${esc(aparelho(r.nomeDoAparelho))} desligado, ${esc(comArtigo(o.nome))} continua` : `Onde ${esc(comArtigo(o.nome))} trabalha`;
  const itens = [...r.maquinas.map((m) => item(m.id, `Na ${m.nome}`, m.ligada)), item("nod", "No nod", null)].join("");
  const mais = r.maquinas.length === 0
    ? '<button type="button" class="nvl-mais" role="menuitem" data-act="conectar-sempre-ligada"><b>Usar uma máquina sua</b><small>Uma que fique sempre ligada</small></button>'
    : '<button type="button" class="nvl-mais" role="menuitem" data-act="nv-ver-maquinas"><b>Ver máquinas</b></button>';
  return `<div class="nvl-pop" role="menu" aria-label="${titulo}" data-chave="${esc(o.chave)}"><p class="nvl-pop-titulo">${titulo}</p>${itens}<hr class="nvl-div">${mais}</div>`;
}

const aparelho = (nome: string) => nome.replace(/^seu /, "");

/**
 * M1/J2/N2: a linha do painel do bot. Com o app no computador: ☾ "Com o Mac desligado", o subtítulo que o servidor monta
 * ("A Ada continua no nod" / "na vm-sp" / "A Ada espera o Mac ligar") e o interruptor; tocar no texto abre a lista. Sem o
 * app: "Onde a Ada trabalha · Na vm-sp ›", sem interruptor, abrindo a mesma lista. Sem o navegador no servidor: nada.
 */
export function htmlLinhaDoLugarNoPainel(r: RespostaLugarNavegador | null | undefined, o: { agenteId: string; nome: string; aberto: boolean }): string {
  if (!r || r.disponivel === false) return "";
  const chave = `painel:${o.agenteId}`;
  const lista = o.aberto ? htmlListaDoLugar(r, { agenteId: o.agenteId, nome: o.nome, chave }) : "";
  const abrir = `data-act="nv-lugar-abrir" data-chave="${esc(chave)}" aria-haspopup="menu" aria-expanded="${o.aberto}"`;
  if (!r.temApp) {
    return `<div class="nvl-linha sem-app"><button type="button" class="gv-linha nvl-abrir" ${abrir}>${ICONE_LUGAR}<span class="gv-linha-txt">Onde ${esc(comArtigo(o.nome))} trabalha<small>${esc(nomeDoLugar(r))}</small></span>${CHEVRON}</button>${lista}</div>`;
  }
  const titulo = `Com o ${aparelho(r.nomeDoAparelho)} desligado`;
  const chaveInterruptor = `<button type="button" class="nvl-chave" role="switch" aria-checked="${r.continuaSemMac}" aria-label="${esc(`${titulo}, ${comArtigo(o.nome)} continua trabalhando`)}" ${mudar(o.agenteId, { continuaSemMac: !r.continuaSemMac })} data-desfazer="${esc(JSON.stringify({ continuaSemMac: r.continuaSemMac }))}"><span aria-hidden="true"></span></button>`;
  return `<div class="nvl-linha"><button type="button" class="gv-linha nvl-abrir" ${abrir}>${ICONE_LUA}<span class="gv-linha-txt">${esc(titulo)}<small>${esc(r.subtitulo)}</small></span></button>${chaveInterruptor}${lista}</div>`;
}

/** N1: a frase de baixo do cartão-pergunta ("A Ada continua **na vm-sp**, onde ela já trabalha. Trocar"); tocar abre a lista. */
function fraseDeBaixo(r: RespostaLugarNavegador, chave: string, aberto: boolean): string {
  const f = r.frasePergunta;
  const abrir = `data-act="nv-lugar-abrir" data-chave="${esc(chave)}" aria-haspopup="menu" aria-expanded="${aberto}"`;
  const trocar = f.trocar ? `<button type="button" class="nvl-trocar" ${abrir}>Trocar</button>` : "";
  return `<div class="nvl-frase"><button type="button" class="nvl-frase-txt" ${abrir}>${esc(f.texto)} <b>${esc(f.lugar)}</b>${esc(f.resto)}.</button>${trocar}</div>`;
}

/**
 * M2/J1/N1 e J2: o cartão-pergunta. Sem resposta: o título, o porquê, [Continuar com o Mac desligado] [Só com o Mac
 * ligado] e a frase de onde. Respondido: a linha "✓ Você escolheu: continuar com o Mac desligado · Desfazer". Sem a leitura
 * do lugar (bot de outra pessoa, servidor de antes): só o título, como linha de sistema.
 */
export function htmlCartaoDaPergunta(p: PayloadNavegadorPergunta, r: RespostaLugarNavegador | null | undefined, o: { nome: string; mensagemId: string; texto: string; aberto: boolean }): string {
  if (p.pergunta === "mac_desligado") return htmlCartaoMacDesligado(p, r, o);
  if (!r) return `<p class="cc-sistema" role="status"><span>${esc(o.texto)}</span></p>`;
  const ap = aparelho(p.nomeDoAparelho);
  if (r.respondeu) {
    const escolha = r.continuaSemMac ? `continuar com o ${ap} desligado` : `só com o ${ap} ligado`;
    return `<div class="nvl-resposta" role="status"><span class="nvl-ok" aria-hidden="true">✓</span><span class="nvl-resposta-txt">Você escolheu: ${esc(escolha)}</span><button type="button" class="nvl-desfazer" ${mudar(p.agenteId, { continuaSemMac: !r.continuaSemMac })}>Desfazer</button></div>`;
  }
  const chave = `cartao:${o.mensagemId}`;
  const lista = o.aberto ? htmlListaDoLugar(r, { agenteId: p.agenteId, nome: o.nome, chave }) : "";
  return `<section class="nvl-cartao" aria-label="${esc(o.texto)}"><p class="nvl-titulo">${esc(o.texto)}</p><p class="nvl-texto">Para essa rotina rodar, ${esc(comArtigo(o.nome))} precisa continuar com ele desligado.</p>`
    + `<div class="nvl-bts"><button type="button" class="nvl-bt preto" ${mudar(p.agenteId, { continuaSemMac: true })}>Continuar com o ${esc(ap)} desligado</button><button type="button" class="nvl-bt" ${mudar(p.agenteId, { continuaSemMac: false })}>Só com o ${esc(ap)} ligado</button></div>`
    + `${fraseDeBaixo(r, chave, o.aberto)}${lista}</section>`;
}

/**
 * M3/K1/K2: "Seu Mac está desligado" com [Fazer agora] [Quando o Mac ligar]. Respondido: "✓ Agora a Ada continua com o Mac
 * desligado · Desfazer" (K2), ou "Faço quando o Mac ligar · Fazer agora". Com o Mac de volta e nada escolhido, a linha
 * discreta "Seu Mac ligou".
 */
function htmlCartaoMacDesligado(p: PayloadNavegadorPergunta, r: RespostaLugarNavegador | null | undefined, o: { nome: string; texto: string }): string {
  const ap = aparelho(p.nomeDoAparelho);
  if (!r) return `<p class="cc-sistema" role="status"><span>${esc(o.texto)}</span></p>`;
  if (r.continuaSemMac) {
    return `<div class="nvl-resposta" role="status"><span class="nvl-ok" aria-hidden="true">✓</span><span class="nvl-resposta-txt">Agora ${esc(comArtigo(o.nome))} continua com o ${esc(ap)} desligado</span><button type="button" class="nvl-desfazer" ${mudar(p.agenteId, { continuaSemMac: false })}>Desfazer</button></div>`;
  }
  const turno = esc(p.turnoId ?? "");
  const responder = (resposta: string) => `data-act="nv-mac-desligado" data-id="${esc(p.agenteId)}" data-turno="${turno}" data-resposta="${resposta}"`;
  if (p.turnoId && r.retomarTurnoId === p.turnoId) {
    return `<div class="nvl-resposta" role="status"><span class="nvl-resposta-txt">Faço quando o ${esc(ap)} ligar</span><button type="button" class="nvl-desfazer" ${responder("agora")}>Fazer agora</button></div>`;
  }
  if (r.agora !== null) return `<p class="cc-sistema" role="status"><span>${esc(`${o.texto}. Ele já ligou.`)}</span></p>`;
  return `<section class="nvl-cartao mac" aria-label="${esc(o.texto)}"><p class="nvl-titulo">${esc(o.texto)}</p><p class="nvl-texto">Eu uso o navegador nele. Faço assim que ele ligar, ou agora, se eu puder continuar com ele desligado.</p>`
    + `<div class="nvl-bts"><button type="button" class="nvl-bt preto" ${responder("agora")}>Fazer agora</button><button type="button" class="nvl-bt" ${responder("ao_ligar")}>Quando o ${esc(ap)} ligar</button></div></section>`;
}

/**
 * N, "Quando algo muda": a linha da conversa quando o lugar muda sozinho, num cartão claro (raio 12): o texto e a ação à
 * direita (Desfazer, "Ver máquinas"); "fora do ar" traz a trava embaixo, em cinza ("Só na vm-sp, mesmo que atrase"). Só a
 * dona do bot vê os botões.
 */
export function htmlLinhaDoLugarDoNavegador(p: PayloadNavegadorLugar, texto: string, dono: boolean): string {
  const botao = (rotulo: string, attrs: string, classe = "nvl-desfazer") => `<button type="button" class="${classe}" ${attrs}>${esc(rotulo)}</button>`;
  if (p.aviso === "fez_no_nod") {
    const trava = p.acao && dono ? botao(p.acao.rotulo, `data-act="navegador-lugar" data-id="${esc(p.agenteId)}" data-mudar="${esc(JSON.stringify(p.acao.mudar))}"`, "nvl-trava") : "";
    return `<div class="nvl-aviso empilhado" role="status"><span class="nvl-aviso-txt">${esc(texto)}</span>${trava}</div>`;
  }
  const acao = !dono ? ""
    : p.acao ? botao(p.acao.rotulo, `data-act="navegador-lugar" data-id="${esc(p.agenteId)}" data-mudar="${esc(JSON.stringify(p.acao.mudar))}"`)
    : p.aviso === "maquina_saiu" ? botao("Ver máquinas", 'data-act="nv-ver-maquinas"') : "";
  return `<div class="nvl-aviso" role="status"><span class="nvl-aviso-txt">${esc(texto)}</span>${acao}</div>`;
}
