import type { CredencialNoCofre } from "../../src/contracts/cofre.ts";
import type { LoginDoCofreNaTela } from "../../src/contracts/navegador-do-bot.ts";
import { grupoConfig, linhaConfig } from "../lib/linha-config.ts";
import { quandoCurto } from "../lib/relogio.ts";
import { esc } from "../lib/render.ts";

/**
 * O estado da seção Cofre (fora do reducer, como Aprovações): null antes da primeira leitura. Os logins de sites (ADR-190,
 * decisão 6) vêm juntos: `logins` null antes de ler; `filtro` = o site do "Logins deste site…" do navegador; `adicionando`
 * abre o formulário; `apagando` são os que somem já e só vão ao servidor quando o Desfazer passa. A senha NUNCA mora aqui:
 * ela vive só no campo do formulário até o POST, e o campo é limpo em seguida (web/main.ts, `cofre-guardar-login`).
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
};
export const TELA_COFRE_INICIAL: TelaCofre = { credenciais: null, carregando: false, erro: false, logins: null, erroLogins: false, filtro: null, adicionando: false, apagando: new Set(), erroNovo: null, guardando: false };

const CHAVE = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="5.5" cy="10.5" r="3"/><path d="M7.6 8.4L13.5 2.5M11.5 4.5l1.5 1.5M10 6l1.2 1.2"/></svg>';
const GLOBO = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2c1.8 1.7 2.6 3.7 2.6 6S9.8 12.3 8 14M8 2C6.2 3.7 5.4 5.7 5.4 8s.8 4.3 2.6 6"/></svg>';
const OLHO = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0"/><circle cx="12" cy="12" r="3"/></svg>';

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

/**
 * Configurações › Cofre › Logins de sites (ADR-190, decisão 6): o cofre do nod que o navegador do bot usa. A lista (site,
 * usuário mascarado, data), "Adicionar login" (site, usuário, senha com mostrar/ocultar; a senha nunca vem à tela depois)
 * e Apagar com Desfazer. O filtro do "Logins deste site…" mostra só o site e um "Ver todos".
 */
export function renderLoginsDoCofre(t: TelaCofre, agora: number, fuso: string): string {
  const filtro = t.filtro ?? null;
  const adicionar = t.adicionando ? "" : `<button type="button" class="bt cofre-add" data-act="cofre-adicionar-login">Adicionar login</button>`;
  const cab = `<div class="cofre-logins-cab"><h3 class="lc-grupo-tit" id="cofre-logins">Logins de sites</h3>${adicionar}</div>`
    + '<p class="lc-nota cofre-logins-nota">O navegador dos bots entra com eles. A senha vai do cofre direto para a página: nenhum bot a vê.</p>';
  const chip = filtro ? `<p class="cofre-filtro" role="status">Logins de <b>${esc(filtro)}</b> · <button type="button" class="gv-link" data-act="cofre-ver-todos">Ver todos</button></p>` : "";
  const form = t.adicionando ? formularioDeLogin(filtro, t) : "";
  let corpo: string;
  if (t.erroLogins && !t.logins) corpo = `<div class="lc-lista">${linhaConfig({ titulo: "Não deu para abrir os logins", status: { texto: "Erro", tom: "erro" }, controle: { tipo: "html", html: '<button type="button" class="bt" data-act="recarregar-cofre">Tentar de novo</button>' } })}</div>`;
  else if (!t.logins) corpo = '<p class="lc-nota" role="status">Abrindo os logins…</p>';
  else {
    const visiveis = t.logins.filter((l) => !t.apagando?.has(l.id) && (!filtro || casaComFiltro(l.site, filtro)));
    corpo = visiveis.length
      ? `<div class="lc-lista cofre-logins-lista">${visiveis.map((l) => linhaConfig({
        titulo: l.site,
        detalhe: l.usuario || "sem usuário",
        icone: GLOBO,
        quando: `guardado ${quandoCurto(l.criadoEm, agora, fuso)}`,
        classe: "cofre-login",
        controle: { tipo: "html", html: `<button type="button" class="gv-link cofre-apagar" data-act="cofre-apagar-login" data-id="${esc(l.id)}" aria-label="${esc(`Apagar o login de ${l.site}`)}">Apagar</button>` },
      })).join("")}</div>`
      : `<p class="lc-vazio">${filtro ? `Nenhum login de ${esc(filtro)} no cofre do nod.` : "Nenhum login guardado ainda. Guarde aqui, ou pelo aviso “Guardar no cofre?” depois de entrar num site pelo navegador do bot."}</p>`;
  }
  return `<section class="lc-grupo cofre-logins">${cab}${chip}${form}${corpo}</section>`;
}

function formularioDeLogin(filtro: string | null, t: TelaCofre): string {
  const erro = t.erroNovo ? `<p class="cofre-form-erro" role="alert">${esc(t.erroNovo)}</p>` : "";
  const ocupado = t.guardando ? ' disabled aria-busy="true"' : "";
  return `<form class="cofre-form" data-form="cofre-guardar-login" autocomplete="off" aria-labelledby="cofre-form-tit">`
    + '<h4 id="cofre-form-tit" class="sr-only">Adicionar login</h4>'
    + `<label class="cofre-campo"><span>Site</span><input name="site" type="text" inputmode="url" autocapitalize="off" spellcheck="false" maxlength="2000" required placeholder="itau.com.br" value="${esc(filtro ?? "")}"></label>`
    + '<label class="cofre-campo"><span>Usuário</span><input name="usuario" type="text" autocapitalize="off" spellcheck="false" maxlength="320" autocomplete="off" placeholder="voce@exemplo.com"></label>'
    + `<label class="cofre-campo"><span>Senha</span><span class="cofre-senha"><input name="senha" type="password" maxlength="4096" required autocomplete="new-password" data-privado="1"><button type="button" class="cofre-olho" data-act="cofre-mostrar-senha" aria-pressed="false" aria-label="Mostrar a senha" title="Mostrar">${OLHO}</button></span></label>`
    + `${erro}<div class="cofre-form-bts"><button type="button" class="bt" data-act="cofre-cancelar-login">Cancelar</button><button type="submit" class="bt pri"${ocupado}>${t.guardando ? "Guardando…" : "Guardar"}</button></div></form>`;
}

/**
 * Configurações › Cofre (Paper 07, rodada 2): as chaves que a pessoa guardou pelos cartões dos bots (`pedir_credencial`).
 * Só o nome, o app e quando foi guardada — o valor fica no cofre e nunca vem à tela. Embaixo, os logins de sites.
 * `fuso` é obrigatório: sem ele as horas saíam em UTC ("guardado hoje 13:35" às 10:35 em Brasília, prova real de 2026-11-20).
 */
export function renderCofre(t: TelaCofre, agora: number, fuso: string): string {
  const cab = `<h2>Cofre</h2><p class="intro">As chaves que você guardou pelos cartões dos bots e os logins que o navegador deles usa. O valor fica só no cofre: aqui aparecem o nome, o site e quando foi guardado.</p>`;
  const logins = t.logins === undefined ? "" : renderLoginsDoCofre(t, agora, fuso);
  const sec = (miolo: string) => `<section class="espaco-secao cfg-secao cfg-cofre">${cab}${t.filtro ? logins + miolo : miolo + logins}</section>`;
  if (t.erro && !t.credenciais) return sec(`<div class="lc-lista">${linhaConfig({ titulo: "Não deu para abrir o cofre", status: { texto: "Erro", tom: "erro" }, controle: { tipo: "html", html: '<button type="button" class="bt" data-act="recarregar-cofre">Tentar de novo</button>' } })}</div>`);
  if (!t.credenciais) return sec('<p class="lc-nota" role="status">Abrindo o cofre…</p>');
  if (t.credenciais.length === 0) return sec('<p class="lc-vazio">Nenhuma chave guardada ainda. Quando um bot pedir uma, ela aparece aqui.</p>');
  const linhas = t.credenciais.map((c) => linhaConfig({ titulo: c.nome, detalhe: c.app, icone: CHAVE, quando: `guardada ${quandoCurto(c.guardadaEm, agora, fuso)}`, classe: "cofre-linha" }));
  return sec(grupoConfig("Chaves guardadas", linhas, { contagem: linhas.length }).replace(/<h3 class="lc-grupo-tit">/, `<h3 class="lc-grupo-tit" title="${esc("O valor nunca sai do cofre")}">`));
}
