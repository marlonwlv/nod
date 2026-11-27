import type { AppDoCofre } from "../../src/contracts/apps-do-cofre.ts";
import type { ChaveDoCofreNaTela, CredencialNoCofre, DetalheDaChaveDto, UsoDaChave } from "../../src/contracts/cofre.ts";
import type { LoginDoCofreNaTela } from "../../src/contracts/navegador-do-bot.ts";
import { ICONE } from "../lib/icones.ts";
import { grupoConfig, itemMenu, linhaConfig, menuLinha, normalizarBusca } from "../lib/linha-config.ts";
import { haQuanto, quandoCurto } from "../lib/relogio.ts";
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
  /** "novo" = o menu do "Novo item"; `login:<id>` ou `chave:<id>` = o "…" daquela linha; null = nenhum. */
  menu?: string | null;
  /** ADR-195 (Entrega 3): as chaves do cofre em envelope, com quem usa (GET /cofre). */
  chaves?: readonly ChaveDoCofreNaTela[];
  /** Os apps que o Cofre conhece (o catálogo vem do servidor pelo GET /cofre). */
  apps?: readonly AppDoCofre[];
  /** A "Nova chave" aberta (Paper C3): só o que não é segredo, para o redesenho não apagar. O valor nunca mora aqui. */
  novaChave?: NovaChaveNaTela | null;
  /** A chave aberta (Paper C2). */
  aberta?: ChaveAberta | null;
};
export const TELA_COFRE_INICIAL: TelaCofre = { credenciais: null, carregando: false, erro: false, logins: null, erroLogins: false, filtro: null, adicionando: false, apagando: new Set(), erroNovo: null, guardando: false, aba: "tudo", busca: "", menu: null, novaChave: null, aberta: null };

export type NovaChaveNaTela = { appId: string; nome: string; agenteId: string; dicas: string; erro: string | null; guardando: boolean };
export type ChaveAberta = {
  id: string;
  detalhe: DetalheDaChaveDto | null;
  erro: boolean;
  /** O "Trocar" abriu o campo do valor novo na linha Valor. */
  trocando: boolean;
  erroTroca: string | null;
  guardando: boolean;
  /** O menu do "Dar a outro bot" aberto. */
  dando: boolean;
};
/** Os bots que a pessoa pode pôr em "Quem pode usar" (os da frota, sem os excluídos). */
export type BotDoCofre = { id: string; nome: string; cor: string };

// Os desenhos são os da navegação das Configurações (arquivo principal do Paper, "Menu das Configurações"): 16×16, traço 1.4.
const ic = (d: string): string => `<svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const CHAVE = ic('<circle cx="5.5" cy="10.5" r="3"/><path d="M7.7 8.3L13.5 2.5M11 5l2 2"/>');
const GLOBO = ic('<circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2c1.8 1.7 2.6 3.7 2.6 6S9.8 12.3 8 14M8 2C6.2 3.7 5.4 5.7 5.4 8s.8 4.3 2.6 6"/>');
const LUPA = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>';
const DESCE = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>';
const CADEADO = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 015 0v2"/></svg>';
const MAIS = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>';
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
export function itensVisiveis(t: TelaCofre): { cofreChaves: readonly ChaveDoCofreNaTela[]; chaves: readonly CredencialNoCofre[]; logins: readonly LoginDoCofreNaTela[] } {
  const termo = normalizarBusca(t.busca ?? "");
  const aba = t.aba ?? "tudo";
  const filtro = t.filtro ?? null;
  const semChaves = aba === "logins" || filtro;
  const cofreChaves = semChaves ? [] : (t.chaves ?? []).filter((c) => !t.apagando?.has(`chave:${c.id}`) && casaBusca(termo, c.app ?? "", c.nome, ...c.quem.map((q) => q.nome)));
  const chaves = semChaves ? [] : (t.credenciais ?? []).filter((c) => casaBusca(termo, c.app, c.nome));
  const logins = aba === "chaves" ? [] : (t.logins ?? []).filter((l) => !t.apagando?.has(l.id) && (!filtro || casaComFiltro(l.site, filtro)) && casaBusca(termo, l.site, l.usuario));
  return { cofreChaves, chaves, logins };
}

/** Quantas chaves a aba conta: as do cofre (menos as que estão saindo) e as dos cartões antigos. */
function totalDeChaves(t: TelaCofre): number {
  return (t.chaves ?? []).filter((c) => !t.apagando?.has(`chave:${c.id}`)).length + (t.credenciais?.length ?? 0);
}

function barra(t: TelaCofre): string {
  const nChaves = totalDeChaves(t);
  const nLogins = (t.logins ?? []).filter((l) => !t.apagando?.has(l.id)).length;
  const aba = t.aba ?? "tudo";
  const abas: { id: AbaDoCofre; rotulo: string; n: number }[] = [{ id: "tudo", rotulo: "Tudo", n: nChaves + nLogins }, { id: "chaves", rotulo: "Chaves", n: nChaves }, { id: "logins", rotulo: "Logins", n: nLogins }];
  const botoes = abas.map((a) => `<button type="button" role="tab" class="gv-aba cofre-aba" aria-selected="${a.id === aba}" data-act="cofre-aba" data-aba="${a.id}">${a.rotulo}<span class="cofre-conta">${a.n}</span></button>`).join("");
  const busca = `<label class="cofre-busca">${LUPA}<input type="search" data-cofre-busca data-manter-foco="cofre-busca" placeholder="Buscar no cofre" aria-label="Buscar no cofre" value="${esc(t.busca ?? "")}" autocomplete="off" spellcheck="false"></label>`;
  const aberto = t.menu === "novo";
  const menu = aberto
    ? `<div class="cl-menu cofre-novo-menu" role="menu" aria-label="Novo item">${itemMenu("cofre-nova-chave", CHAVE, "Chave", { nota: "De um app, para os bots usarem" })}${itemMenu("cofre-adicionar-login", GLOBO, "Login de site", { nota: "O navegador do bot entra com ele" })}</div>`
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

/** "Chico usa sempre", "Dante pergunta antes", "Chico e Dante usam", "Chico e mais 2 usam" (Paper C1). */
export function quemUsaATexto(c: Pick<ChaveDoCofreNaTela, "quem">): string {
  const [a, b] = c.quem;
  if (!a) return "Nenhum bot usa ainda";
  if (!b) return `${a.nome} ${a.modo === "sempre" ? "usa sempre" : "pergunta antes"}`;
  return c.quem.length === 2 ? `${a.nome} e ${b.nome} usam` : `${a.nome} e mais ${c.quem.length - 1} usam`;
}

/** "usada há 3 min" (Paper C1); sem uso, quando foi guardada. */
function usoNaLinha(c: ChaveDoCofreNaTela, agora: number, fuso: string): string {
  return c.ultimoUsoEm !== null ? `usada ${haQuanto(agora - c.ultimoUsoEm)}` : `guardada ${quandoCurto(c.guardadaEm, agora, fuso)}`;
}

/** Uma chave do cofre (Paper C1): o app com a variável no selo, quem usa e o último uso, de quem é e o "…". */
function linhaDaChaveDoCofre(c: ChaveDoCofreNaTela, t: TelaCofre, agora: number, fuso: string): string {
  const chave = `chave:${c.id}`;
  const itens = itemMenu("cofre-abrir-chave", ICONE.abrir, "Abrir", { dados: { id: c.id } })
    + (c.sua ? itemMenu("cofre-abrir-chave", ICONE.lapis, "Trocar", { dados: { id: c.id, trocar: "1" } }) + itemMenu("cofre-remover-chave", ICONE.lixo, "Remover chave", { dados: { id: c.id }, perigo: true }) : "");
  return linhaConfig({
    titulo: c.app ?? c.nome,
    ...(c.app ? { selo: c.nome } : {}),
    detalhe: `${quemUsaATexto(c)} · ${usoNaLinha(c, agora, fuso)}`,
    icone: CHAVE,
    quando: c.dono === "time" ? "Do time" : "Sua",
    classe: "cofre-linha cofre-chave-viva",
    controle: { tipo: "html", html: menuLinha({ tipo: "menu", acao: "cofre-menu-item", aberto: t.menu === chave, rotulo: `a chave ${c.nome}`, itens, dados: { id: chave } }) },
  });
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

const ICONE_CHAVE_TILE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 8.7-8.7M17 6l2.5 2.5M14.5 8.5 16.5 10.5"/></svg>';

/** A inicial do bot no quadradinho com a cor dele (Paper C2, "Quem pode usar"). */
function avatarDoBot(nome: string, cor: string | undefined): string {
  const inicial = Array.from(nome.trim())[0]?.toUpperCase() ?? "?";
  return `<span class="cofre-bot-av ${esc(cor ?? "")}" aria-hidden="true">${esc(inicial)}</span>`;
}

/** O texto de uma linha do "Uso recente" (Paper C2): "Chico usou no computador da Orgo", "Dante pediu · você negou". */
export function textoDoUso(u: UsoDaChave): string {
  const bot = u.agente ?? "Um bot";
  switch (u.tipo) {
    case "entregue": return u.agente ? `${u.agente} usou${u.onde ? ` ${u.onde}` : ""}` : `Usada${u.onde ? ` ${u.onde}` : ""}`;
    case "guardado": return u.peloCartaoDe ? `Você guardou pelo cartão de ${u.peloCartaoDe}` : "Você guardou";
    case "trocado": return "Você trocou o valor";
    case "pedido": return `${bot} pediu`;
    case "aprovado": return `${bot} pediu · você permitiu`;
    case "negado": return `${bot} pediu · você negou`;
    case "revogado": return "Você removeu a chave";
  }
}

/** O subtítulo da chave aberta: "Chave sua · guardada pelo cartão de Chico" (Paper C2; "de" serve para qualquer nome). */
function subtituloDaChave(c: ChaveDoCofreNaTela, agora: number, fuso: string): string {
  const de = c.dono === "time" ? "Chave do time" : c.sua ? "Chave sua" : "Chave de outra pessoa";
  return `${de} · ${c.pedidaPor ? `guardada pelo cartão de ${c.pedidaPor}` : `guardada ${quandoCurto(c.guardadaEm, agora, fuso)}`}`;
}

const MODOS_DE_USO: readonly { id: "sempre" | "perguntar"; rotulo: string }[] = [{ id: "sempre", rotulo: "Sempre" }, { id: "perguntar", rotulo: "Perguntar antes" }];

/** A linha do valor: "Guardado, oculto · testada hoje 22:20" e Trocar; trocando, o campo do valor novo (Paper C2b). */
function linhaDoValor(c: ChaveDoCofreNaTela, a: ChaveAberta, agora: number, fuso: string): string {
  if (a.trocando && c.sua) {
    const erro = a.erroTroca ? `<p class="cofre-form-erro cofre-troca-erro" role="alert">${esc(a.erroTroca)}</p>` : "";
    const ocupado = a.guardando ? ' disabled aria-busy="true"' : "";
    return `<form class="cofre-tabela-linha cofre-troca" data-form="cofre-guardar-troca" data-id="${esc(c.id)}" autocomplete="off" novalidate>`
      + `<span class="cofre-tabela-rot">Valor</span>`
      + `<span class="cofre-senha cofre-troca-campo"><input name="valor" type="password" maxlength="4096" autocomplete="off" data-1p-ignore data-lpignore="true" data-bwignore autocapitalize="off" spellcheck="false" aria-label="Valor novo de ${esc(c.nome)}" placeholder="Valor novo"${a.guardando ? " readonly" : ""}${a.erroTroca ? ' aria-invalid="true"' : ""}><button type="button" class="cofre-olho" data-act="cofre-mostrar-senha" aria-pressed="false" aria-label="Mostrar o valor">Mostrar</button></span>`
      + `<span class="cofre-troca-acoes"><button type="button" class="cofre-pilula-bt cofre-troca-cancelar" data-act="cofre-cancelar-troca">Cancelar</button><button type="submit" class="bt pri cofre-troca-ok"${ocupado}>${a.guardando ? (c.appId ? "Testando…" : "Guardando…") : "Guardar"}</button></span></form>${erro}`;
  }
  const testada = c.testadaEm !== null ? `<span class="cofre-testada">· testada ${esc(quandoCurto(c.testadaEm, agora, fuso))}</span>` : "";
  const trocar = c.sua ? `<span class="cofre-vao"></span><button type="button" class="cofre-pilula-bt" data-act="cofre-trocar-chave">Trocar</button>` : "";
  return `<div class="cofre-tabela-linha"><span class="cofre-tabela-rot">Valor</span><span class="cofre-oculto">Guardado, oculto</span>${testada}${trocar}</div>`;
}

/** A chave aberta (Paper C2): variável, valor oculto com Trocar, quem pode usar, uso recente, Remover chave e Pronto. */
function dialogoDaChave(t: TelaCofre, bots: readonly BotDoCofre[], agora: number, fuso: string): string {
  const a = t.aberta;
  if (!a) return "";
  const fundo = '<div class="cl-fundo" data-act="cofre-fechar-chave"></div>';
  const casca = (miolo: string, rotulo: string) => `${fundo}<div class="cl-dialogo cofre-dialogo cofre-chave-aberta" role="dialog" aria-modal="true" aria-label="${esc(rotulo)}">${miolo}</div>`;
  const fechar = `<button type="button" class="cofre-fechar" data-act="cofre-fechar-chave" aria-label="Fechar">${FECHAR}</button>`;
  if (!a.detalhe) {
    const corpo = a.erro
      ? `<p class="cofre-ajuda" role="alert">Não deu para abrir a chave.</p><div class="cofre-dialogo-pe"><button type="button" class="bt" data-act="cofre-fechar-chave">Fechar</button><button type="button" class="bt pri" data-act="cofre-abrir-chave" data-id="${esc(a.id)}">Tentar de novo</button></div>`
      : '<p class="cofre-ajuda" role="status">Abrindo a chave…</p>';
    return casca(`<div class="cofre-dialogo-cab"><h3>Chave</h3>${fechar}</div>${corpo}`, "Chave");
  }
  const c = a.detalhe.chave;
  const titulo = c.app ?? c.nome;
  const cab = `<div class="cofre-dialogo-cab cofre-chave-cab"><span class="cofre-tile" aria-hidden="true">${ICONE_CHAVE_TILE}</span><span class="cofre-chave-tit"><h3 id="cofre-chave-tit">${esc(titulo)}</h3><span class="cofre-chave-sub">${esc(subtituloDaChave(c, agora, fuso))}</span></span>${fechar}</div>`;
  const tabela = `<div class="cofre-tabela"><div class="cofre-tabela-linha"><span class="cofre-tabela-rot">Variável</span><code class="cofre-variavel">${esc(c.nome)}</code></div>${linhaDoValor(c, a, agora, fuso)}</div>`;
  const cores = new Map(bots.map((b) => [b.id, b.cor]));
  const quem = c.quem.map((q) => {
    const opcoes = MODOS_DE_USO.map((m) => `<option value="${m.id}"${m.id === q.modo ? " selected" : ""}>${m.rotulo}</option>`).join("") + '<option value="tirar">Tirar o acesso</option>';
    const modo = c.sua
      ? `<label class="cofre-modo"><span class="cofre-modo-txt">${q.modo === "sempre" ? "Sempre" : "Perguntar antes"}</span>${DESCE}<select data-act-change="cofre-modo-acesso" data-id="${esc(c.id)}" data-agente="${esc(q.agenteId)}" aria-label="Como ${esc(q.nome)} usa a chave">${opcoes}</select></label>`
      : `<span class="cofre-modo cofre-modo-so-ler">${q.modo === "sempre" ? "Sempre" : "Perguntar antes"}</span>`;
    return `<div class="cofre-quem-linha">${avatarDoBot(q.nome, cores.get(q.agenteId))}<span class="cofre-quem-nome">${esc(q.nome)}</span><span class="cofre-vao"></span>${modo}</div>`;
  }).join("");
  const livres = bots.filter((b) => !c.quem.some((q) => q.agenteId === b.id));
  const menuDar = a.dando && livres.length
    ? `<div class="cl-menu cofre-dar-menu" role="menu" aria-label="Dar a outro bot">${livres.map((b) => `<button type="button" role="menuitem" data-act="cofre-dar-acesso" data-id="${esc(c.id)}" data-agente="${esc(b.id)}">${avatarDoBot(b.nome, b.cor)}<span>${esc(b.nome)}</span></button>`).join("")}</div>`
    : "";
  const dar = c.sua && livres.length
    ? `<div class="cl-mais cofre-dar"><button type="button" class="cofre-dar-bt" data-act="cofre-menu-dar" aria-haspopup="menu" aria-expanded="${a.dando}">${MAIS}Dar a outro bot</button>${menuDar}</div>`
    : "";
  const vazioQuem = c.quem.length ? "" : '<p class="cofre-quem-vazio">Nenhum bot usa ainda. Quem pedir, pede pelo chat.</p>';
  const usos = a.detalhe.uso.length
    ? a.detalhe.uso.map((u) => `<div class="cofre-uso-linha"><span>${esc(textoDoUso(u))}</span><span class="cofre-vao"></span><span class="cofre-uso-quando">${esc(quandoCurto(u.quando, agora, fuso))}</span></div>`).join("")
    : '<p class="cofre-quem-vazio">Nenhum uso ainda.</p>';
  const pe = `<div class="cofre-dialogo-pe cofre-chave-pe">${c.sua ? `<button type="button" class="cofre-remover" data-act="cofre-remover-chave" data-id="${esc(c.id)}">Remover chave</button>` : ""}<span class="cofre-vao"></span><button type="button" class="bt pri" data-act="cofre-fechar-chave">Pronto</button></div>`;
  return casca(`${cab}${tabela}<div class="cofre-secao"><p class="cofre-secao-tit">Quem pode usar</p>${quem}${vazioQuem}${dar}</div><div class="cofre-secao cofre-uso"><p class="cofre-secao-tit">Uso recente</p>${usos}</div>${pe}`, titulo);
}

/** A "Nova chave" (Paper C3): app, nome da variável, valor com Mostrar, quem pode usar e dicas. O valor nunca vem preenchido. */
function dialogoDaNovaChave(t: TelaCofre, bots: readonly BotDoCofre[]): string {
  const n = t.novaChave;
  if (!n) return "";
  const apps = t.apps ?? [];
  const app = apps.find((a) => a.id === n.appId) ?? null;
  const opcoesApp = apps.map((a) => `<option value="${esc(a.id)}"${a.id === n.appId ? " selected" : ""}>${esc(a.nome)}</option>`).join("") + `<option value=""${app ? "" : " selected"}>Outro app</option>`;
  const inicial = app ? Array.from(app.nome)[0] ?? "" : "";
  const tileApp = app ? `<span class="cofre-app-tile" aria-hidden="true">${esc(inicial)}</span>` : "";
  const opcoesBot = `<option value=""${n.agenteId ? "" : " selected"}>Nenhum bot por enquanto</option>` + bots.map((b) => `<option value="${esc(b.id)}"${b.id === n.agenteId ? " selected" : ""}>${esc(b.nome)}</option>`).join("");
  const erro = n.erro ? `<p class="cofre-form-erro" role="alert">${esc(n.erro)}</p>` : "";
  const ocupado = n.guardando ? ' disabled aria-busy="true"' : "";
  return '<div class="cl-fundo" data-act="cofre-cancelar-chave"></div>'
    + '<form class="cl-dialogo cofre-dialogo cofre-form cofre-nova-chave" role="dialog" aria-modal="true" aria-labelledby="cofre-chave-form-tit" data-form="cofre-guardar-chave" autocomplete="off" novalidate>'
    + `<div class="cofre-dialogo-cab"><h3 id="cofre-chave-form-tit">Nova chave</h3><button type="button" class="cofre-fechar" data-act="cofre-cancelar-chave" aria-label="Fechar">${FECHAR}</button></div>`
    + `<label class="cofre-campo"><span>App</span><span class="cofre-escolha${app ? " com-tile" : ""}">${tileApp}<select name="app" data-act-change="cofre-app-da-chave">${opcoesApp}</select>${DESCE}</span></label>`
    + `<p class="cofre-ajuda">${app ? "Com um app conhecido, testamos a chave antes de guardar." : "Sem um app conhecido, a chave é guardada sem teste."}</p>`
    + `<label class="cofre-campo"><span>Nome da variável</span><input name="nome" type="text" class="cofre-mono" autocapitalize="characters" spellcheck="false" maxlength="128" required placeholder="EXEMPLO_API_KEY" value="${esc(n.nome)}"></label>`
    + '<p class="cofre-ajuda">É o único que o bot vê. O programa lê a chave por este nome.</p>'
    + `<label class="cofre-campo"><span>Valor</span><span class="cofre-senha"><input name="valor" type="password" class="cofre-mono" maxlength="4096" required autocomplete="off" data-1p-ignore data-lpignore="true" data-bwignore autocapitalize="off" spellcheck="false" placeholder="${esc(app?.dica ?? "")}"${n.guardando ? " readonly" : ""}><button type="button" class="cofre-olho" data-act="cofre-mostrar-senha" aria-pressed="false" aria-label="Mostrar o valor">Mostrar</button></span></label>`
    + `<label class="cofre-campo"><span>Quem pode usar</span><span class="cofre-escolha">${'<select name="agente">' + opcoesBot + "</select>"}<span class="cofre-escolha-nota">Sempre</span>${DESCE}</span></label>`
    + '<p class="cofre-ajuda">Os outros bots pedem antes de usar e você decide no chat.</p>'
    + `<label class="cofre-campo"><span>Dicas <i>(opcional)</i></span><input name="dicas" type="text" maxlength="200" spellcheck="true" placeholder="Ex.: só para o computador de testes" value="${esc(n.dicas)}"></label>`
    + '<p class="cofre-ajuda">Diga ao bot quando usar esta chave.</p>'
    + `${erro}<div class="cofre-dialogo-pe"><span class="cofre-seguro">${CADEADO}Guardada, ninguém vê o valor.</span><button type="button" class="bt cofre-cancelar" data-act="cofre-cancelar-chave">Cancelar</button><button type="submit" class="bt pri"${ocupado}>${n.guardando ? (app ? "Testando…" : "Guardando…") : "Guardar chave"}</button></div></form>`;
}

/**
 * Configurações › Cofre (Paper "nod · Workspace e contas", página "Cofre · chaves e logins", C1, C4 e C7): a barra com
 * Tudo/Chaves/Logins, a busca e o "Novo item"; as chaves que a pessoa guardou pelos cartões dos bots e os logins que o
 * navegador deles usa, cada grupo numa `.lc-lista`; o vazio; e o diálogo "Novo login". Só o nome, o app, o site e
 * quando foi guardado: o valor fica no cofre e nunca vem à tela. `fuso` é obrigatório: sem ele as horas saíam em UTC
 * ("guardado hoje 13:35" às 10:35 em Brasília, prova real de 2026-11-20).
 */
export function renderCofre(t: TelaCofre, agora: number, fuso: string, bots: readonly BotDoCofre[] = []): string {
  const cab = '<h2>Cofre</h2><p class="intro">Chaves e logins que seus bots usam sem ver.</p>';
  const sec = (miolo: string) => `<section class="espaco-secao cfg-secao cfg-cofre">${cab}${miolo}${dialogoDoLogin(t)}${dialogoDaNovaChave(t, bots)}${dialogoDaChave(t, bots, agora, fuso)}</section>`;
  if (t.erro && !t.credenciais) return sec(erroComTentar("Não deu para abrir o cofre"));
  if (!t.credenciais) return sec('<p class="lc-nota" role="status">Abrindo o cofre…</p>');
  const filtro = t.filtro ?? null;
  const chip = filtro ? `<p class="cofre-filtro" role="status">Logins de <b>${esc(filtro)}</b> · <button type="button" class="gv-link" data-act="cofre-ver-todos">Ver todos</button></p>` : "";
  const { cofreChaves, chaves, logins } = itensVisiveis(t);
  const aba = t.aba ?? "tudo";
  const grupos: string[] = [];
  const nChaves = cofreChaves.length + chaves.length;
  if (nChaves) grupos.push(grupoConfig("Chaves", [...cofreChaves.map((c) => linhaDaChaveDoCofre(c, t, agora, fuso)), ...chaves.map((c) => linhaDaChave(c, agora, fuso))], { contagem: nChaves, classe: "cofre-grupo" }));
  if (aba !== "chaves") {
    // `logins` undefined = a tela sem os logins (ADR-190 desligada); null = ainda lendo.
    if (t.logins === undefined) { /* nada */ } else if (t.erroLogins && !t.logins) grupos.push(`<section class="lc-grupo cofre-grupo"><h3 class="lc-grupo-tit">Logins de sites</h3>${erroComTentar("Não deu para abrir os logins")}</section>`);
    else if (t.logins === null) grupos.push('<p class="lc-nota" role="status">Abrindo os logins…</p>');
    else if (logins.length) grupos.push(grupoConfig("Logins de sites", logins.map((l) => linhaDoLogin(l, t, agora, fuso)), { contagem: logins.length, id: "cofre-logins", classe: "cofre-grupo" }));
  }
  const nada = (totalDeChaves(t) + (t.logins ?? []).length) === 0;
  const vazio = grupos.length ? ""
    : nada ? '<div class="lc-lista cofre-vazio"><p><b>Nada guardado ainda.</b>Adicione uma chave ou um login em Novo item. Quando um bot precisar de uma chave, ele pede pelo chat e ela aparece aqui.</p></div>'
      : `<p class="lc-vazio">${filtro ? `Nenhum login de ${esc(filtro)} no cofre do nod.` : `Nada no cofre com “${esc((t.busca ?? "").trim())}”.`}</p>`;
  const rodape = `<p class="lc-nota cofre-rodape">${CADEADO}<span>Nenhum bot vê os valores. A senha de um login vai do cofre direto para a página.</span></p>`;
  return sec(`${barra(t)}${chip}${grupos.join("")}${vazio}${rodape}`);
}
