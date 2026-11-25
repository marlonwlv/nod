import type { CredencialNoCofre } from "../../src/contracts/cofre.ts";
import type { LoginDoCofreNaTela } from "../../src/contracts/navegador-do-bot.ts";
import { ICONE } from "../lib/icones.ts";
import { grupoConfig, itemMenu, linhaConfig, menuLinha, normalizarBusca } from "../lib/linha-config.ts";
import { quandoCurto } from "../lib/relogio.ts";
import { esc } from "../lib/render.ts";

/** O que a barra do Cofre mostra (Paper "Cofre · chaves e logins", C1): tudo, só as chaves ou só os logins. */
export type AbaDoCofre = "tudo" | "chaves" | "logins";

/**
 * O estado da seção Cofre (fora do reducer, como Aprovações): null antes da primeira leitura. Os logins de sites (ADR-190,
 * decisão 6) vêm juntos: `logins` null antes de ler; `filtro` = o site do "Logins deste site…" do navegador; `adicionando`
 * abre o diálogo "Novo login"; `apagando` são os que somem já e só vão ao servidor quando o Desfazer passa. A senha NUNCA
 * mora aqui: ela vive só no campo do formulário até o POST, e o campo é limpo em seguida (web/main.ts,
 * `cofre-guardar-login`). `aba`, `busca` e `menu` (qual "…" ou o "Novo item" está aberto) são só da tela.
 */
export type TelaCofre = {
  credenciais: readonly CredencialNoCofre[] | null;
  carregando: boolean;
  erro: boolean;
  logins?: readonly LoginDoCofreNaTela[] | null;
  erroLogins?: boolean;
  filtro?: string | null;
  adicionando?: boolean;
  apagando?: ReadonlySet<string>;
  /** A frase do erro do formulário (sem dado nenhum do que foi digitado). */
  erroNovo?: string | null;
  guardando?: boolean;
  aba?: AbaDoCofre;
  busca?: string;
  /** "novo" = o menu do "Novo item"; `login:<id>` = o "…" daquele login; null = nenhum. */
  menu?: string | null;
};
export const TELA_COFRE_INICIAL: TelaCofre = { credenciais: null, carregando: false, erro: false, logins: null, erroLogins: false, filtro: null, adicionando: false, apagando: new Set(), erroNovo: null, guardando: false, aba: "tudo", busca: "", menu: null };

// Os desenhos são os da navegação das Configurações (arquivo principal do Paper, "Menu das Configurações"): 16×16, traço 1.4.
const ic = (d: string): string => `<svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const CHAVE = ic('<circle cx="5.5" cy="10.5" r="3"/><path d="M7.7 8.3L13.5 2.5M11 5l2 2"/>');
const GLOBO = ic('<circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2c1.8 1.7 2.6 3.7 2.6 6S9.8 12.3 8 14M8 2C6.2 3.7 5.4 5.7 5.4 8s.8 4.3 2.6 6"/>');
const LUPA = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>';
const DESCE = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>';
const CADEADO = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 015 0v2"/></svg>';
const FECHAR = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>';

/** O host do "Logins deste site…": "https://www.itau.com.br/x" → "itau.com.br"; texto solto passa aparado. */
export function siteDoFiltro(url: string): string {
  const t = url.trim();
  if (!t) return "";
  try { return new URL(/^[a-z][a-z0-9+.-]*:/iu.test(t) ? t : `https://${t}`).hostname.replace(/^www\./u, ""); } catch { return t.toLowerCase(); }
}

/** O login casa com o filtro pelo domínio registrável (itau.com.br casa com internetpf.itau.com.br e vice-versa). */
export function casaComFiltro(site: string, filtro: string): boolean {
  const a = site.toLowerCase().replace(/^www\./u, "");
  const b = filtro.toLowerCase().replace(/^www\./u, "");
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

/** A chave do Composio é do time (ADR-041); as outras, de quem guardou. */
const donoDaChave = (c: CredencialNoCofre): string => (c.app === "Composio" ? "Do time" : "Sua");
/** O nome que o programa lê ("ORGO_API_KEY") vai no selo ao lado do app; "Token do GitHub" e afins já são o título. */
const seloDaChave = (c: CredencialNoCofre): string | undefined => (/^[A-Z][A-Z0-9_]*$/u.test(c.nome) ? c.nome : undefined);

const casaBusca = (termo: string, ...campos: string[]): boolean => !termo || campos.some((c) => normalizarBusca(c).includes(termo));

/** As linhas que a aba, a busca, o filtro do navegador e o Desfazer deixam à vista. */
export function itensVisiveis(t: TelaCofre): { chaves: readonly CredencialNoCofre[]; logins: readonly LoginDoCofreNaTela[] } {
  const termo = normalizarBusca(t.busca ?? "");
  const aba = t.aba ?? "tudo";
  const filtro = t.filtro ?? null;
  const chaves = aba === "logins" || filtro ? [] : (t.credenciais ?? []).filter((c) => casaBusca(termo, c.app, c.nome));
  const logins = aba === "chaves" ? [] : (t.logins ?? []).filter((l) => !t.apagando?.has(l.id) && (!filtro || casaComFiltro(l.site, filtro)) && casaBusca(termo, l.site, l.usuario));
  return { chaves, logins };
}

function barra(t: TelaCofre): string {
  const nChaves = t.credenciais?.length ?? 0;
  const nLogins = (t.logins ?? []).filter((l) => !t.apagando?.has(l.id)).length;
  const aba = t.aba ?? "tudo";
  const abas: { id: AbaDoCofre; rotulo: string; n: number }[] = [{ id: "tudo", rotulo: "Tudo", n: nChaves + nLogins }, { id: "chaves", rotulo: "Chaves", n: nChaves }, { id: "logins", rotulo: "Logins", n: nLogins }];
  const botoes = abas.map((a) => `<button type="button" role="tab" class="gv-aba cofre-aba" aria-selected="${a.id === aba}" data-act="cofre-aba" data-aba="${a.id}">${a.rotulo}<span class="cofre-conta">${a.n}</span></button>`).join("");
  const busca = `<label class="cofre-busca">${LUPA}<input type="search" data-cofre-busca data-manter-foco="cofre-busca" placeholder="Buscar no cofre" aria-label="Buscar no cofre" value="${esc(t.busca ?? "")}" autocomplete="off" spellcheck="false"></label>`;
  const aberto = t.menu === "novo";
  const menu = aberto
    ? `<div class="cl-menu cofre-novo-menu" role="menu" aria-label="Novo item">${itemMenu("cofre-adicionar-login", GLOBO, "Login de site", { nota: "O navegador do bot entra com ele" })}</div>`
    : "";
  const novo = `<div class="cl-mais cofre-novo"><button type="button" class="bt pri cofre-novo-bt" data-act="cofre-menu-novo" aria-haspopup="menu" aria-expanded="${aberto}">Novo item${DESCE}</button>${menu}</div>`;
  return `<div class="cofre-barra"><div class="gv-abas cofre-abas" role="tablist" aria-label="Mostrar no cofre">${botoes}</div><span class="cofre-barra-vao"></span>${busca}${novo}</div>`;
}

function linhaDaChave(c: CredencialNoCofre, agora: number, fuso: string): string {
  const selo = seloDaChave(c);
  // O nome que não é variável ("Token do GitHub") vai no detalhe, para nada do que foi guardado sumir da tela.
  const nome = !selo && c.nome !== c.app ? `${c.nome} · ` : "";
  return linhaConfig({ titulo: c.app, selo, detalhe: `${nome}guardada ${quandoCurto(c.guardadaEm, agora, fuso)}`, icone: CHAVE, quando: donoDaChave(c), classe: "cofre-linha cofre-chave" });
}

function linhaDoLogin(l: LoginDoCofreNaTela, t: TelaCofre, agora: number, fuso: string): string {
  const chave = `login:${l.id}`;
  const itens = itemMenu("cofre-apagar-login", ICONE.lixo, "Apagar", { dados: { id: l.id }, perigo: true });
  return linhaConfig({
    titulo: l.site,
    detalhe: `${l.usuario || "sem usuário"} · guardado ${quandoCurto(l.criadoEm, agora, fuso)}`,
    icone: GLOBO,
    quando: "Sua",
    classe: "cofre-linha cofre-login",
    controle: { tipo: "html", html: menuLinha({ tipo: "menu", acao: "cofre-menu-item", aberto: t.menu === chave, rotulo: `o login de ${l.site}`, itens, dados: { id: chave } }) },
  });
}

function erroComTentar(titulo: string): string {
  return `<div class="lc-lista">${linhaConfig({ titulo, status: { texto: "Erro", tom: "erro" }, controle: { tipo: "html", html: '<button type="button" class="bt" data-act="recarregar-cofre">Tentar de novo</button>' } })}</div>`;
}

/** O diálogo "Novo login" (Paper C7): site, usuário e senha com Mostrar. A senha nunca vem preenchida. */
function dialogoDoLogin(t: TelaCofre): string {
  if (!t.adicionando) return "";
  const filtro = t.filtro ?? "";
  const erro = t.erroNovo ? `<p class="cofre-form-erro" role="alert">${esc(t.erroNovo)}</p>` : "";
  const ocupado = t.guardando ? ' disabled aria-busy="true"' : "";
  return '<div class="cl-fundo" data-act="cofre-cancelar-login"></div>'
    + '<form class="cl-dialogo cofre-dialogo cofre-form" role="dialog" aria-modal="true" aria-labelledby="cofre-form-tit" data-form="cofre-guardar-login" autocomplete="off" novalidate>'
    + `<div class="cofre-dialogo-cab"><h3 id="cofre-form-tit">Novo login</h3><button type="button" class="cofre-fechar" data-act="cofre-cancelar-login" aria-label="Fechar">${FECHAR}</button></div>`
    + `<label class="cofre-campo"><span>Site</span><input name="site" type="text" inputmode="url" autocapitalize="off" spellcheck="false" maxlength="2000" required placeholder="itau.com.br" value="${esc(filtro)}"></label>`
    + '<p class="cofre-ajuda">Preenche neste site e nos subdomínios dele. Site parecido não recebe.</p>'
    + '<label class="cofre-campo"><span>Usuário ou e-mail</span><input name="usuario" type="text" autocapitalize="off" spellcheck="false" maxlength="320" autocomplete="off" placeholder="voce@exemplo.com"></label>'
    + '<label class="cofre-campo"><span>Senha</span><span class="cofre-senha"><input name="senha" type="password" maxlength="4096" required autocomplete="new-password" data-privado="1"><button type="button" class="cofre-olho" data-act="cofre-mostrar-senha" aria-pressed="false" aria-label="Mostrar a senha">Mostrar</button></span></label>'
    + `${erro}<div class="cofre-dialogo-pe"><span class="cofre-seguro">${CADEADO}Guardado, ninguém vê a senha.</span><button type="button" class="bt cofre-cancelar" data-act="cofre-cancelar-login">Cancelar</button><button type="submit" class="bt pri"${ocupado}>${t.guardando ? "Guardando…" : "Guardar login"}</button></div></form>`;
}

/**
 * Configurações › Cofre (Paper "nod · Workspace e contas", página "Cofre · chaves e logins", C1, C4 e C7): a barra com
 * Tudo/Chaves/Logins, a busca e o "Novo item"; as chaves que a pessoa guardou pelos cartões dos bots e os logins que o
 * navegador deles usa, cada grupo numa `.lc-lista`; o vazio; e o diálogo "Novo login". Só o nome, o app, o site e
 * quando foi guardado: o valor fica no cofre e nunca vem à tela. `fuso` é obrigatório: sem ele as horas saíam em UTC
 * ("guardado hoje 13:35" às 10:35 em Brasília, prova real de 2026-11-20).
 */
export function renderCofre(t: TelaCofre, agora: number, fuso: string): string {
  const cab = '<h2>Cofre</h2><p class="intro">Chaves e logins que seus bots usam sem ver.</p>';
  const sec = (miolo: string) => `<section class="espaco-secao cfg-secao cfg-cofre">${cab}${miolo}${dialogoDoLogin(t)}</section>`;
  if (t.erro && !t.credenciais) return sec(erroComTentar("Não deu para abrir o cofre"));
  if (!t.credenciais) return sec('<p class="lc-nota" role="status">Abrindo o cofre…</p>');
  const filtro = t.filtro ?? null;
  const chip = filtro ? `<p class="cofre-filtro" role="status">Logins de <b>${esc(filtro)}</b> · <button type="button" class="gv-link" data-act="cofre-ver-todos">Ver todos</button></p>` : "";
  const { chaves, logins } = itensVisiveis(t);
  const aba = t.aba ?? "tudo";
  const grupos: string[] = [];
  if (chaves.length) grupos.push(grupoConfig("Chaves", chaves.map((c) => linhaDaChave(c, agora, fuso)), { contagem: chaves.length, classe: "cofre-grupo" }));
  if (aba !== "chaves") {
    // `logins` undefined = a tela sem os logins (ADR-190 desligada); null = ainda lendo.
    if (t.logins === undefined) { /* nada */ } else if (t.erroLogins && !t.logins) grupos.push(`<section class="lc-grupo cofre-grupo"><h3 class="lc-grupo-tit">Logins de sites</h3>${erroComTentar("Não deu para abrir os logins")}</section>`);
    else if (t.logins === null) grupos.push('<p class="lc-nota" role="status">Abrindo os logins…</p>');
    else if (logins.length) grupos.push(grupoConfig("Logins de sites", logins.map((l) => linhaDoLogin(l, t, agora, fuso)), { contagem: logins.length, id: "cofre-logins", classe: "cofre-grupo" }));
  }
  const nada = (t.credenciais.length + (t.logins ?? []).length) === 0;
  const vazio = grupos.length ? ""
    : nada ? '<div class="lc-lista cofre-vazio"><p><b>Nada guardado ainda.</b>Adicione um login em Novo item. Quando um bot precisar de uma chave, ele pede pelo chat e ela aparece aqui.</p></div>'
      : `<p class="lc-vazio">${filtro ? `Nenhum login de ${esc(filtro)} no cofre do nod.` : `Nada no cofre com “${esc((t.busca ?? "").trim())}”.`}</p>`;
  const rodape = `<p class="lc-nota cofre-rodape">${CADEADO}<span>Nenhum bot vê os valores. A senha de um login vai do cofre direto para a página.</span></p>`;
  return sec(`${barra(t)}${chip}${grupos.join("")}${vazio}${rodape}`);
}
