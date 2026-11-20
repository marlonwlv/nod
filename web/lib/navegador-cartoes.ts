import type { FonteCofre, GravacaoNavegador, OfertaGuardarLogin, OpcaoLogin, PedidoDaVistaNavegador, TarefaEnsinada, VistaNavegador } from "../../src/contracts/navegador-do-bot.ts";
import { esc } from "./escape.ts";
import { aoNome, aspasCurvas, comArtigo, deNome, dominioDe, fraseMaiuscula, rotuloDaAprovacao } from "./navegador-vista.ts";

/**
 * Os cartões do navegador do bot na conversa, em "Sua vez" e no celular (ADR-190; Paper "Navegador · login e cofre,
 * aprovações, ensinar": L, A, T; K3 e M4). Tudo puro: o HTML sai pronto e o teste lê sem navegador. Quem responde é o
 * main.ts, pelos `data-act` (nv-login, nv-decidir, nv-guardar, nv-assumir, nv-resolver) e pelo `data-form="nv-codigo"`.
 *
 * Um pedido aponta para UMA decisão: respondido num lugar (pílula, conversa, Sua vez, celular), a decisão fecha, o
 * `navegador.mudou` e o SSE da conversa reidratam, e o cartão vira linha nos outros.
 *
 * Medidas do Paper (get_jsx): cartão com borda 1 px azul a 33 %, raio 14, padding 14 e gap 10; título 14/19 semibold com o
 * ponto azul de 7 px; subtítulo 12/19 cinza; botões de 13/19 com raio 10 (o preto em 9/12, os de contorno em 8);
 * indisponível no cinza claro com o motivo de 11 px à direita.
 */

// ---- as falas do bot que abrem os pedidos (cópia das frases de src/adapters/fundo/navegadores.ts) ----------------------

/** O pedido do navegador que a fala `pedido_a_pessoa` abriu, ou null se a fala não é do navegador. */
export type PedidoNaFala = { tipo: "login"; site: string; motivo: string } | { tipo: "codigo"; motivo: string } | { tipo: "ajuda"; motivo: string };

const RE_LOGIN = /^Preciso entrar em (.+?) no meu navegador para continuar: ([\s\S]*)\. A senha vai do cofre direto para a página; ela não passa por mim\.$/u;
const RE_CODIGO = /^Preciso do código que chegou para você: ([\s\S]*)\. Digite no cartão; ele vai direto para a página, não para mim\.$/u;
const PREFIXO_AJUDA = "Preciso de você no meu navegador: ";

/**
 * Reconhece a fala de `navegador_entrar` e de `navegador_pedir_ajuda` (FALA_DO_LOGIN, FALA_DO_CODIGO, FALA_DA_AJUDA do
 * portão; tests/unit/web/navegador-cartoes.test.ts confere com as frases do servidor). A web só importa tipos de src/.
 */
export function pedidoDoNavegadorNaFala(texto: string): PedidoNaFala | null {
  const l = RE_LOGIN.exec(texto);
  if (l?.[1] && l[2] !== undefined) return { tipo: "login", site: l[1], motivo: l[2] };
  const c = RE_CODIGO.exec(texto);
  if (c?.[1] !== undefined) return { tipo: "codigo", motivo: c[1] };
  if (texto.startsWith(PREFIXO_AJUDA)) return { tipo: "ajuda", motivo: texto.slice(PREFIXO_AJUDA.length) };
  return null;
}

/**
 * A resposta que fechou um pedido do navegador (o portão a grava em nome da pessoa e o bot a lê) vira uma linha discreta:
 * "Login preenchido no itau.com.br", "Código enviado". null = não é resposta do navegador (a conversa desenha como sempre).
 */
export function linhaDaRespostaDoNavegador(texto: string): string | null {
  const preenchido = /^Login preenchido no (.+?) \(a senha não passa por você\)\./u.exec(texto);
  if (preenchido?.[1]) return `Login preenchido no ${preenchido[1]}`;
  const usuario = /^Preenchi só o usuário no (.+?): a página não mostra o campo de senha ainda\./u.exec(texto);
  if (usuario?.[1]) return `Usuário preenchido no ${usuario[1]}`;
  if (texto.startsWith("Código enviado. A pessoa pôs o código no campo da página")) return "Código enviado";
  const chrome = /^Trouxe do Chrome da pessoa a sessão de (.+?) \(\d+ cookies\)/u.exec(texto);
  if (chrome?.[1]) return `Sessão de ${chrome[1]} trazida do seu Chrome`;
  if (texto.startsWith("Resolvi o que você pediu no navegador.")) return "Você resolveu no navegador";
  if (texto.startsWith("Terminei no navegador e devolvi o controle.")) return "Você devolveu o navegador";
  return null;
}

// ---- nomes ---------------------------------------------------------------------------------------------------------------

/** "itau.com.br" → "Itau"; "Itaú" fica "Itaú". O que o bot disse vale mais que o domínio (ele sabe o acento). */
export function nomeDoSite(site: string): string {
  const t = site.trim();
  if (!t) return "o site";
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/iu.test(t)) return t;
  const partes = t.toLowerCase().replace(/^www\./u, "").split(".");
  const raiz = partes[0] ?? t;
  return raiz.charAt(0).toUpperCase() + raiz.slice(1);
}

/** "no Itaú", "na TAP": sigla e nome que termina em "a" pedem "na". definido em 2026-11-20: heurística, sem lista de sites. */
export function noOuNa(nome: string): string {
  const sigla = /^[A-Z0-9]{2,5}$/u.test(nome);
  return sigla || /a$/u.test(nome) ? "na" : "no";
}

/** O nome de cada cofre como a pessoa o conhece. */
export const NOME_DA_FONTE: Readonly<Record<FonteCofre, string>> = { nod: "o cofre do nod", "1password": "o 1Password", bitwarden: "o Bitwarden" };

// ---- L1, L2: o cartão de login ----------------------------------------------------------------------------------------------

type PedidoLogin = Extract<PedidoDaVistaNavegador, { tipo: "login" }>;

/** Um botão do cartão de login, na ordem em que aparece. `principal` = o preto (só um). */
export type BotaoDoLogin =
  | { tipo: "cofre"; opcao: OpcaoLogin; principal: boolean }
  | { tipo: "eu_mesmo"; principal: boolean }
  | { tipo: "chrome"; principal: false };

/**
 * L1 / M4 / K3: as opções na ordem do servidor (o cofre que casa primeiro); o primeiro item DISPONÍVEL é o botão preto; os
 * indisponíveis ficam cinza com o motivo. Depois "Entrar eu mesmo" e, só com o app do Mac, "Trazer do meu Chrome". Sem
 * nenhum item disponível, o preto vira "Entrar eu mesmo".
 */
export function botoesDoLogin(p: Pick<PedidoLogin, "opcoes" | "podeTrazerDoChrome">): BotaoDoLogin[] {
  const primeiro = p.opcoes.findIndex((o) => o.disponivel);
  const bts: BotaoDoLogin[] = p.opcoes.map((opcao, i) => ({ tipo: "cofre", opcao, principal: i === primeiro }));
  bts.push({ tipo: "eu_mesmo", principal: primeiro < 0 });
  if (p.podeTrazerDoChrome) bts.push({ tipo: "chrome", principal: false });
  return bts;
}

const ROTULO_DA_FONTE: Readonly<Record<FonteCofre, string>> = { nod: "Usar o cofre do nod", "1password": "Usar o 1Password", bitwarden: "Usar o Bitwarden" };

const ICONE_GIRO = '<span class="nvc-giro" aria-hidden="true"></span>';

/**
 * O cartão "● A Ada precisa entrar no Itaú / Para baixar a fatura de novembro · itau.com.br" (L1). Na etapa
 * `confirme_no_mac`, "Confirme no seu Mac" no lugar das opções (L2, também no celular). `eu_mesmo` não chega aqui: a
 * conversa desenha a linha e a pílula assume o pedido (D4, D).
 */
export function htmlCartaoLogin(p: PedidoLogin, o: { nome: string; agenteId: string; url?: string; fonte?: FonteCofre | null }): string {
  const site = nomeDoSite(p.site);
  const host = (o.url ? dominioDe(o.url) : "") || (/\./u.test(p.site) ? p.site.replace(/^www\./u, "") : "");
  const titulo = `${o.nome} precisa entrar ${noOuNa(site)} ${site}`;
  const sub = [p.motivo.trim().replace(/\.$/u, ""), host].filter(Boolean).join(" · ");
  const dados = `data-agente="${esc(o.agenteId)}" data-decisao="${esc(p.decisaoId)}"`;
  const cab = `<p class="nvc-tit"><i class="nvc-ponto" aria-hidden="true"></i><span>${esc(titulo)}</span></p>${sub ? `<p class="nvc-sub">${esc(sub)}</p>` : ""}`;
  const erro = p.erro ? `<p class="nvc-erro" role="alert">${esc(p.erro)}</p>` : "";
  if (p.etapa === "confirme_no_mac") {
    const com = o.fonte ? ` · entrando com ${NOME_DA_FONTE[o.fonte]}` : "";
    return `<div class="nvc nvc-login" role="group" aria-label="${esc(titulo)}" ${dados} data-etapa="confirme_no_mac">${cab}<p class="nvc-mac" role="status">${ICONE_GIRO}<span><b>Confirme no seu Mac</b>${esc(com)}</span></p><p class="nvc-nota">O seu Mac pede o Touch ID ou a senha do Keychain. A senha vai direto para a página.</p></div>`;
  }
  const bts = botoesDoLogin(p);
  const linha = (b: BotaoDoLogin): string => {
    if (b.tipo === "cofre") {
      const op = b.opcao;
      const rotulo = ROTULO_DA_FONTE[op.fonte];
      if (!op.disponivel) {
        return `<button type="button" class="nvc-op nvc-op-indisponivel" disabled aria-disabled="true"><span>${esc(rotulo)}</span><small>${esc(op.motivoIndisponivel ?? "indisponível agora")}</small></button>`;
      }
      return `<button type="button" class="nvc-op${b.principal ? " nvc-op-principal" : " nvc-op-contorno"}" data-act="nv-login" ${dados} data-escolha="cofre" data-fonte="${esc(op.fonte)}" data-ref="${esc(op.ref)}"><span>${esc(rotulo)}</span><small>${esc(op.rotulo)}</small></button>`;
    }
    if (b.tipo === "eu_mesmo") return `<button type="button" class="nvc-op${b.principal ? " nvc-op-principal" : " nvc-op-contorno"} nvc-op-centro" data-act="nv-login" ${dados} data-escolha="eu_mesmo">Entrar eu mesmo</button>`;
    return `<button type="button" class="nvc-op nvc-op-contorno nvc-op-centro" data-act="nv-login" ${dados} data-escolha="chrome">Trazer do meu Chrome</button>`;
  };
  const cofres = bts.filter((b) => b.tipo === "cofre").map(linha).join("");
  const resto = bts.filter((b) => b.tipo !== "cofre");
  // L1: "Entrar eu mesmo" e "Trazer do meu Chrome" lado a lado quando há os dois; sozinho, ocupa a largura (K3, M4).
  const fim = resto.length > 1 ? `<div class="nvc-par">${resto.map(linha).join("")}</div>` : resto.map(linha).join("");
  return `<div class="nvc nvc-login" role="group" aria-label="${esc(titulo)}" ${dados} data-etapa="escolher">${cab}${erro}<div class="nvc-ops">${cofres}${fim}</div></div>`;
}

/** D4, D: a pessoa escolheu "Entrar eu mesmo" — o cartão fecha e a pílula assume. Na conversa fica esta linha. */
export function htmlLinhaEntrandoEuMesmo(p: Pick<PedidoLogin, "site">, o: { agenteId: string }): string {
  const site = nomeDoSite(p.site);
  return `<div class="msg-sistema nvc-linha" role="status">Você está entrando ${esc(noOuNa(site))} ${esc(site)} no navegador · <button type="button" class="nvc-link" data-act="navegador-ver" data-agente="${esc(o.agenteId)}">Abrir</button></div>`;
}

// ---- L4: o código --------------------------------------------------------------------------------------------------------

/** O motivo em frase com maiúscula e sem ponto final ("O Itaú mandou um código por SMS"). */
function frase(t: string): string {
  const s = t.trim().replace(/[.\s]+$/u, "");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * L4: "● O Itaú mandou um código por SMS" com o campo privado e [Enviar]. O valor mora só no campo (nem estado, nem
 * storage, nem conversa): `autocomplete="one-time-code"` deixa o sistema sugerir o SMS, e o resto desliga corretor,
 * histórico e maiúscula. `enviado` = a resposta chegou e a decisão ainda não fechou: "Código enviado".
 */
export function htmlCartaoCodigo(o: { decisaoId: string; agenteId: string; motivo: string; nome: string; enviando?: boolean; erro?: string | null }): string {
  const titulo = frase(o.motivo) || "A página pediu um código";
  const dados = `data-agente="${esc(o.agenteId)}" data-decisao="${esc(o.decisaoId)}"`;
  const erro = o.erro ? `<p class="nvc-erro" role="alert">${esc(o.erro)}</p>` : "";
  return `<form class="nvc nvc-codigo" data-form="nv-codigo" ${dados} autocomplete="off" aria-label="${esc(titulo)}">`
    + `<p class="nvc-tit"><i class="nvc-ponto" aria-hidden="true"></i><span>${esc(titulo)}</span></p>${erro}`
    + `<div class="nvc-codigo-linha"><input class="nvc-codigo-campo" name="codigo" type="text" inputmode="text" autocomplete="one-time-code" autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="64" required aria-label="Código" data-privado="1"${o.enviando ? " disabled" : ""}>`
    + `<button type="submit" class="nvc-op nvc-op-principal nvc-enviar"${o.enviando ? ' disabled aria-busy="true"' : ""}>${o.enviando ? "Enviando…" : "Enviar"}</button></div>`
    + `<p class="nvc-nota">Vai direto para a página. Não fica na conversa nem chega ${esc(aoNome(o.nome))}.</p></form>`;
}

/** O pedido de ajuda sem código (CAPTCHA, confirmação no app do banco): assumir o controle ou dizer que já resolveu. */
export function htmlCartaoAjudaNavegador(o: { decisaoId: string; agenteId: string; motivo: string; nome: string }): string {
  const titulo = frase(o.motivo) || `${o.nome} precisa de você no navegador`;
  const dados = `data-agente="${esc(o.agenteId)}" data-decisao="${esc(o.decisaoId)}"`;
  return `<div class="nvc nvc-ajuda" role="group" aria-label="${esc(`${o.nome} precisa de você no navegador`)}" ${dados}>`
    + `<p class="nvc-tit"><i class="nvc-ponto" aria-hidden="true"></i><span>${esc(titulo)}</span></p>`
    + `<p class="nvc-sub">Assuma o navegador ${esc(deNome(o.nome))}, faça esse passo e devolva. ${esc(fraseMaiuscula(comArtigo(o.nome)))} não vê o que você digita.</p>`
    + `<div class="nvc-par"><button type="button" class="nvc-op nvc-op-contorno nvc-op-centro" data-act="nv-resolver" ${dados}>Já resolvi</button><button type="button" class="nvc-op nvc-op-principal nvc-op-centro" data-act="nv-assumir" ${dados}>Assumir o controle</button></div></div>`;
}

/** O pedido aberto sem a vista à mão (a vista ainda não chegou, ou é de outro aparelho): o título e o caminho até ela. */
export function htmlCartaoPedidoSemVista(p: PedidoNaFala, o: { decisaoId: string; agenteId: string; nome: string }): string {
  const titulo = p.tipo === "login" ? `${o.nome} precisa entrar ${noOuNa(nomeDoSite(p.site))} ${nomeDoSite(p.site)}` : frase(p.motivo);
  return `<div class="nvc nvc-espera" role="group" aria-label="${esc(titulo)}" data-agente="${esc(o.agenteId)}" data-decisao="${esc(o.decisaoId)}">`
    + `<p class="nvc-tit"><i class="nvc-ponto" aria-hidden="true"></i><span>${esc(titulo)}</span></p>${p.tipo === "login" && p.motivo ? `<p class="nvc-sub">${esc(frase(p.motivo))}</p>` : ""}`
    + `<button type="button" class="nvc-op nvc-op-principal nvc-op-centro" data-act="navegador-ver" data-agente="${esc(o.agenteId)}">Abrir o navegador ${esc(deNome(o.nome))}</button></div>`;
}

// ---- L3: o selo do login embaixo da vista ----------------------------------------------------------------------------------

/**
 * A fonte que a pessoa escolheu por último em cada bot: o selo da L3 diz "Entrando com o 1Password…" enquanto o Mac
 * confirma e depois, com o segredo na página. Nunca guarda segredo, só o nome do cofre; fica na memória e no
 * sessionStorage da aba (recarregar no meio do "Confirme no seu Mac" não perde o nome), e sem storage vale só na memória.
 */
const fontes = new Map<string, FonteCofre>();
const CHAVE_FONTE = "nod:navegador:fonte:";
export function lembrarFonteDoLogin(agenteId: string, fonte: FonteCofre | null): void {
  if (fonte) fontes.set(agenteId, fonte);
  else fontes.delete(agenteId);
  try {
    if (fonte) globalThis.sessionStorage?.setItem(CHAVE_FONTE + agenteId, fonte);
    else globalThis.sessionStorage?.removeItem(CHAVE_FONTE + agenteId);
  } catch { /* sem storage: só a memória */ }
}
export function fonteDoLogin(agenteId: string): FonteCofre | null {
  const daMemoria = fontes.get(agenteId);
  if (daMemoria) return daMemoria;
  try {
    const guardada = globalThis.sessionStorage?.getItem(CHAVE_FONTE + agenteId);
    return guardada === "nod" || guardada === "1password" || guardada === "bitwarden" ? guardada : null;
  } catch { return null; }
}

/** L3: "Entrando com o 1Password…" na faixa de baixo, enquanto o Mac confirma ou o segredo está na página. "" = sem selo. */
export function htmlSeloDoLogin(v: Pick<VistaNavegador, "pedido" | "segredoNaPagina"> | null, fonte: FonteCofre | null): string {
  if (!v) return "";
  const confirmando = v.pedido?.tipo === "login" && v.pedido.etapa === "confirme_no_mac";
  if (!confirmando && !v.segredoNaPagina) return "";
  const texto = fonte ? `Entrando com ${NOME_DA_FONTE[fonte]}…` : "Campo protegido";
  return `<span class="nv-selo-login" role="status">${confirmando ? ICONE_GIRO : ""}<span>${esc(texto)}</span></span>`;
}

// ---- L5: guardar no cofre ---------------------------------------------------------------------------------------------------

/** L5: "Você entrou no Bradesco digitando. Guardar no cofre? Guardar | Não", com o destino quando há mais de um. */
export function htmlLinhaGuardar(o: { oferta: OfertaGuardarLogin; agenteId: string; agora: number }): string {
  const { oferta } = o;
  if (oferta.ate <= o.agora || oferta.destinos.length === 0) return "";
  const site = nomeDoSite(oferta.site);
  const dados = `data-agente="${esc(o.agenteId)}"`;
  const destino = oferta.destinos.length > 1
    ? `<label class="nvc-destino-rotulo"><span class="sr-only">Guardar em</span><select class="nvc-destino" name="destino" aria-label="Guardar em">${oferta.destinos.map((d) => `<option value="${esc(d)}">${esc(NOME_DA_FONTE[d].replace(/^o /u, ""))}</option>`).join("")}</select></label>`
    : `<input type="hidden" class="nvc-destino" value="${esc(oferta.destinos[0] ?? "nod")}">`;
  return `<div class="nvc-guardar" role="group" aria-label="Guardar o login no cofre" ${dados}><span class="nvc-guardar-txt">Você entrou ${esc(noOuNa(site))} ${esc(site)} digitando. Guardar no cofre?</span>${destino}<button type="button" class="nvc-guardar-sim" data-act="nv-guardar" ${dados} data-guardar="1">Guardar</button><button type="button" class="nvc-guardar-nao" data-act="nv-guardar" ${dados} data-guardar="0">Não</button></div>`;
}

// ---- A1, A2, A3: as aprovações -------------------------------------------------------------------------------------------

type PedidoAprovacao = Extract<PedidoDaVistaNavegador, { tipo: "aprovacao" }>;
type PedidoCombinar = Extract<PedidoDaVistaNavegador, { tipo: "combinar" }>;

const verATela = (agenteId: string, dono: boolean): string => (dono ? `<button type="button" class="nvc-link nvc-ver" data-act="navegador-ver" data-agente="${esc(agenteId)}">Ver a tela</button>` : "");

/**
 * A1 e A3 na conversa (o mesmo pedido da pílula): "Pagar R$ 3.780 na TAP?" [Não] [Pagar com Touch ID]; no envio, a
 * citação e "☑ Não perguntar de novo para o Pedro" já marcado (o `sempre` da decisão). Sem o Mac, o botão comum e o aviso.
 */
export function htmlCartaoAprovacao(p: PedidoAprovacao, o: { agenteId: string; nome: string; dono: boolean }): string {
  const dados = `data-agente="${esc(o.agenteId)}" data-decisao="${esc(p.decisaoId)}"`;
  const citacao = p.citacao ? `<blockquote class="nvc-citacao">“${esc(p.citacao)}”</blockquote>` : "";
  const lembrar = p.lembrar ? `<label class="nvc-lembrar"><input type="checkbox" class="nvc-lembrar-caixa" name="sempre"${p.lembrar.padrao ? " checked" : ""}><span>${esc(p.lembrar.texto)}</span></label>` : "";
  const aviso = p.avisoTouchId ? `<p class="nvc-nota">${esc(p.avisoTouchId)}</p>` : p.touchId ? '<p class="nvc-nota">O seu Mac pede o Touch ID na hora de pagar.</p>' : "";
  const sim = rotuloDaAprovacao(p);
  return `<div class="nvc nvc-aprovacao" role="group" aria-label="${esc(`Pedido de ${o.nome} no navegador`)}" ${dados} data-classe="${esc(p.classe)}">`
    + `<div class="nvc-cab"><p class="nvc-tit"><span>${esc(p.pergunta)}</span></p>${verATela(o.agenteId, o.dono)}</div>${citacao}${lembrar}${aviso}`
    + `<div class="nvc-par"><button type="button" class="nvc-op nvc-op-contorno nvc-op-centro" data-act="nv-decidir" ${dados} data-aprovar="0">Não</button><button type="button" class="nvc-op nvc-op-principal nvc-op-centro" data-act="nv-decidir" ${dados} data-aprovar="1">${esc(sim)}</button></div></div>`;
}

/** A2: o combinado de antemão. "Vou comprar na TAP: 1 passagem, até R$ 4.000" [Pode, até R$ 4.000] [Me pergunte antes de pagar]. */
export function htmlCartaoCombinar(p: PedidoCombinar, o: { agenteId: string; nome: string; dono: boolean }): string {
  const dados = `data-agente="${esc(o.agenteId)}" data-decisao="${esc(p.decisaoId)}"`;
  const nota = p.touchId ? '<p class="nvc-nota">O seu Mac pede o Touch ID para guardar o limite.</p>' : "";
  return `<div class="nvc nvc-combinar" role="group" aria-label="${esc(`Combinado com ${o.nome} no navegador`)}" ${dados}>`
    + `<div class="nvc-cab"><p class="nvc-tit"><span>${esc(p.titulo)}</span></p>${verATela(o.agenteId, o.dono)}</div><p class="nvc-sub">${esc(p.texto)}</p>${nota}`
    + `<div class="nvc-par"><button type="button" class="nvc-op nvc-op-principal nvc-op-centro" data-act="nv-decidir" ${dados} data-aprovar="1">${esc(p.sim)}</button><button type="button" class="nvc-op nvc-op-contorno nvc-op-centro" data-act="nv-decidir" ${dados} data-aprovar="0">${esc(p.nao)}</button></div></div>`;
}

/** A aprovação do navegador sem a vista à mão (outro aparelho, a vista ainda não chegou): a pergunta do item e Não | Sim. */
export function htmlCartaoAprovacaoSemVista(o: { decisaoId: string; agenteId: string; pergunta: string; nome: string; dono: boolean }): string {
  const dados = `data-agente="${esc(o.agenteId)}" data-decisao="${esc(o.decisaoId)}"`;
  return `<div class="nvc nvc-aprovacao" role="group" aria-label="${esc(`Pedido de ${o.nome} no navegador`)}" ${dados}>`
    + `<div class="nvc-cab"><p class="nvc-tit"><span>${esc(o.pergunta)}</span></p>${verATela(o.agenteId, o.dono)}</div>`
    + `<div class="nvc-par"><button type="button" class="nvc-op nvc-op-contorno nvc-op-centro" data-act="nv-decidir" ${dados} data-aprovar="0">Não</button><button type="button" class="nvc-op nvc-op-principal nvc-op-centro" data-act="nv-decidir" ${dados} data-aprovar="1">Sim</button></div></div>`;
}

// ---- T: ensinar uma tarefa ------------------------------------------------------------------------------------------------

/** "0:42 · 4 passos" da barra de gravação (T2), no relógio de quem vê. */
export function rotuloDaGravacao(g: Pick<GravacaoNavegador, "desde" | "passos">, agora: number): string {
  const s = Math.max(0, Math.floor((agora - g.desde) / 1000));
  const n = g.passos.length;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} · ${n} ${n === 1 ? "passo" : "passos"}`;
}

/** O nome pronto para "Salvar e ensinar" (T2): o último clique e o site ("Faturas em itau.com.br"); o servidor tem o mesmo. */
export function nomeSugeridoDosPassos(passos: readonly string[]): string {
  const site = passos.map((p) => /^Abriu (.+)$/u.exec(p)?.[1]).find(Boolean) ?? "";
  const clique = [...passos].reverse().map((p) => /^Clicou em "(.+)"$/u.exec(p)?.[1]).find(Boolean) ?? "";
  if (clique && site) return `${clique} em ${site}`;
  return clique || site || "Tarefa ensinada";
}

/**
 * T2: a barra no topo da tela cheia — "● Ensinando a Ada · 0:42 · 4 passos" [Descartar] [Salvar e ensinar]. Parou no teto
 * (200 passos ou 10 min): o rótulo diz e a gravação não cresce mais. `nomeando` = o campo pequeno do nome no lugar dos
 * botões.
 */
export function htmlBarraDeGravacao(o: { nome: string; gravacao: GravacaoNavegador; agora: number; nomeando: boolean }): string {
  const g = o.gravacao;
  const parou = g.parou === "passos" ? " · chegou a 200 passos" : g.parou === "tempo" ? " · chegou a 10 minutos" : "";
  const acoes = o.nomeando
    ? `<form class="nv-grav-nome" data-nv-form="nomear"><label class="sr-only" for="nv-grav-nome">Nome da tarefa</label><input id="nv-grav-nome" class="nv-grav-nome-campo" name="nome" maxlength="120" autocomplete="off" value="${esc(nomeSugeridoDosPassos(g.passos))}"><button type="button" class="nv-grav-bt" data-nv-p="nomear-cancelar">Cancelar</button><button type="submit" class="nv-grav-bt nv-grav-salvar">Salvar</button></form>`
    : `<button type="button" class="nv-grav-bt" data-nv-p="descartar-gravacao">Descartar</button><button type="button" class="nv-grav-bt nv-grav-salvar" data-nv-p="salvar-gravacao"${g.passos.length === 0 ? ' disabled aria-disabled="true" title="Faça ao menos um passo"' : ""}>Salvar e ensinar</button>`;
  return `<div class="nv-grav-barra"><span class="nv-grav-estado"><i class="nv-grav-ponto" aria-hidden="true"></i><span>Ensinando ${esc(comArtigo(o.nome))} · <span class="nv-grav-relogio">${esc(rotuloDaGravacao(g, o.agora))}</span>${esc(parou)}</span></span><span class="nv-grav-acoes">${acoes}</span></div>`;
}


/** T2: o painel lateral escuro "PASSOS GRAVADOS" com os passos em linguagem simples (o último em destaque). */
export function htmlPassosGravados(passos: readonly string[]): string {
  const itens = passos.length
    ? passos.map((p, i) => `<li${i === passos.length - 1 ? ' class="nv-grav-ultimo"' : ""}>${i + 1} · ${esc(aspasCurvas(p))}</li>`).join("")
    : '<li class="nv-grav-vazio">Mexa na página: cada página aberta, clique e campo vira um passo aqui. O que você digita e as senhas não são gravados.</li>';
  return `<aside class="nv-grav-passos" aria-label="Passos gravados"><h2>Passos gravados</h2><ol aria-live="polite">${itens}</ol></aside>`;
}

// ---- T3: as habilidades em Ajustes do bot ----------------------------------------------------------------------------------

/** O estado da seção Habilidades de um bot (fora do reducer): null antes da 1ª leitura. */
export type TelaHabilidades = { tarefas: readonly TarefaEnsinada[] | null; erro: boolean; abertas: ReadonlySet<string>; apagando: ReadonlySet<string> };

/** Ajustes do bot › Habilidades: as tarefas ensinadas (nome, quantos passos, Ver e Apagar com Desfazer). "" = nada a mostrar. */
export function htmlHabilidades(t: TelaHabilidades | null, o: { agenteId: string; nome: string; temNavegador: boolean }): string {
  const lista = t?.tarefas?.filter((x) => !t.apagando.has(x.id)) ?? null;
  if (!o.temNavegador && !lista?.length) return "";
  const cab = '<h3>Habilidades</h3>';
  if (!t || (t.tarefas === null && !t.erro)) return `<section class="gv-secao nvh">${cab}<p class="mudo" role="status">Carregando…</p></section>`;
  if (t.erro && t.tarefas === null) return `<section class="gv-secao nvh">${cab}<p class="mudo">Não deu para ler as habilidades. <button type="button" class="gv-link" data-act="nv-habilidades-reler" data-agente="${esc(o.agenteId)}">Tentar de novo</button></p></section>`;
  if (!lista?.length) return `<section class="gv-secao nvh">${cab}<p class="mudo">Nenhuma tarefa ensinada ainda. Use “Ensinar uma tarefa” no + do campo e mostre no navegador ${esc(deNome(o.nome))}.</p></section>`;
  const linhas = lista.map((x) => {
    const aberta = t.abertas.has(x.id);
    const n = x.passos.length;
    const passos = aberta ? `<ol class="nvh-passos">${x.passos.map((p) => `<li>${esc(aspasCurvas(p))}</li>`).join("")}</ol>` : "";
    return `<li class="nvh-item" data-tarefa="${esc(x.id)}"><div class="gv-linha nvh-linha"><span class="gv-linha-txt">${esc(x.nome)}<small>${n} ${n === 1 ? "passo" : "passos"}</small></span><button type="button" class="gv-link" data-act="nv-habilidade-ver" data-agente="${esc(o.agenteId)}" data-tarefa="${esc(x.id)}" aria-expanded="${aberta}">${aberta ? "Fechar" : "Ver"}</button><button type="button" class="gv-link nvh-apagar" data-act="nv-habilidade-apagar" data-agente="${esc(o.agenteId)}" data-tarefa="${esc(x.id)}" aria-label="${esc(`Apagar ${x.nome}`)}">Apagar</button></div>${passos}</li>`;
  }).join("");
  return `<section class="gv-secao nvh">${cab}<ul class="gv-cartao nvh-lista">${linhas}</ul></section>`;
}
