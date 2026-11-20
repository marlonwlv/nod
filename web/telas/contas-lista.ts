import type { ContaIa, ContasIaDto, FrenteAtivaDaConta, IaComConta, LoginNaMaquina } from "../../src/contracts/contas-ia.ts";
import type { DetalheDaConta, DetalhesDasContas } from "../../src/contracts/desktop.ts";
import type { CausaFalhaLogin, ResultadoColarCodigo } from "../../src/contracts/estado-ia.ts";
import type { MaquinaDto } from "../../src/contracts/maquina.ts";
import { ICONE } from "../lib/icones.ts";
import { campoDeNome } from "../lib/nome-editavel.ts";
import { esc } from "../lib/render.ts";
import { haQuanto } from "../lib/relogio.ts";
import { rotuloDoMac } from "../lib/aparelho.ts";
import { VIVO } from "../lib/copiar.ts";
import { comandoDoTerminal, fraseDaAtualizacao } from "../lib/atualizacao-ia.ts";
import { logoDaIa, PROVEDOR } from "./cartao-ia.ts";
import { planoNaTela } from "./contas-ia.ts";
import { quandoNaTela, usoCompacto, usoDaConta } from "./uso-da-conta.ts";

/**
 * Seu espaço › Provedores de IA, a lista única (definido em 2026-10-13, ADR-102; protótipos G1 e CM1-A aprovados pelo
 * Marlon). Uma linha por conta, sem agrupar por provedor, na ordem de uso (arrasta-se pela alça; a ordem vai a
 * `PUT contas-ia/ordem`). Cada linha: o logo, "Claude · apelido", o plano, o selo Corporativa, o e-mail e a organização
 * (do servidor desde 2026-10-15, ADR-105, em qualquer máquina) e uma pílula por máquina: logada, ou "Entrar na
 * <máquina>" tracejada. A conta abre numa tela própria (Paper G2) com Renomear, Sair de cada máquina e Remover. Os cliques
 * (`data-act="cl-…"`) são de web/lib/contas-da-pessoa.ts; o render não guarda nada.
 * ADR-108 (2026-10-16, canvas Main): a lista é a FILA. Cada linha tem o liga/desliga "na fila" (o opt-in de antes, que
 * era só da corporativa, agora vale para toda conta) e o "Perguntar antes / Trocar sozinho" saiu: no lugar, as três
 * linhas que dizem como o Nod age quando uma conta acaba.
 */

/**
 * NOD-293 C11 (definido em 2026-10-20): `frentes` = o que roda agora com a conta (na máquina, ou em todas na remoção);
 * null = a busca falhou (a tela pergunta se sai mesmo assim); ausente ou vazia = nada roda, o texto de sempre.
 */
export type ConfirmacaoContas =
  | { tipo: "sair"; contaId: string; maquinaId: string; frentes?: FrenteAtivaDaConta[] | null }
  | { tipo: "remover"; contaId: string; frentes?: FrenteAtivaDaConta[] | null };

/** O login de uma conta numa máquina aberto na tela: o da VM (pela API) ou o do Mac (pela ponte do app). */
export type LoginNaTela =
  | { onde: "vm"; login: LoginNaMaquina; codigo: string; enviando: boolean; erroEnvio: string | null }
  | { onde: "mac"; id: string; maquinaId: string; ia: IaComConta; contaId: string | null; apelido: string | null; desde: number; antes: string[] };

export type UiContas = {
  menu: string | null;
  detalhe: string | null;
  /** "Adicionar conta" aberto. */
  nova: { ia: IaComConta; apelido: string; maquinas: string[]; /** Rodada 3: depois do "Entrar", o login de cada máquina aparece nela. */ entrando?: boolean } | null;
  confirmar: ConfirmacaoContas | null;
  /** Provedores filtrado por máquina (vindo de Máquinas › Gerenciar contas). */
  filtro: string | null;
  logins: LoginNaTela[];
  /** O login cujo "Prefere o terminal?" está aberto. */
  terminal: string | null;
  nota: string | null;
  /** Seu espaço › Máquinas (G2): o ⋯ da máquina, o renomear e o "Desconectar" com "sair das contas". */
  maquinaMenu: string | null;
  maquinaRenomear: string | null;
  desconectar: { maquinaId: string; sair: boolean } | null;
  /** Dentro do app do Mac sem a ponte `contas.detalhes` (anterior a 2026-10-13): a tela de antes, com a faixa. */
  appAntigo: boolean;
  /** Jornadas da IA (Paper G2): a conta aberta na tela própria (uso, máquinas e ações); null = a lista. */
  aberta?: string | null;
  /** Paper A3 → G1: a conta que acabou de entrar pela Nova conta ganha o selo "Nova" na lista. */
  recente?: string | null;
  /** Jornadas da IA (Paper G1): a lista só com as contas que precisam da pessoa. */
  pendentes?: boolean;
};

export const UI_CONTAS_INICIAL: UiContas = { menu: null, detalhe: null, nova: null, confirmar: null, filtro: null, logins: [], terminal: null, nota: null, maquinaMenu: null, maquinaRenomear: null, desconectar: null, appAntigo: false, aberta: null, pendentes: false, recente: null };

export type ContextoContas = {
  contas: ContasIaDto;
  maquinas: readonly MaquinaDto[];
  detalhes: DetalhesDasContas | null;
  ui: UiContas;
  agora: number;
  /** Dentro do app do Mac com a ponte nova (sabe qual máquina é este Mac e faz o login nele). */
  noApp: boolean;
  /** Os bots que trabalham em cada máquina (o aviso do "Sair"). */
  botsNaMaquina: (maquinaId: string) => string[];
  /** O cartão da IA do Mac com os passos do login dele (web/telas/cartao-ia.ts), para o login "Entrar no Mac". */
  cartaoDoMac: (ia: IaComConta) => string;
  /** NOD-12: modo simulação (executor catcher): a lista não mostra o uso do plano (nenhum trabalho real o mede). */
  simulacao?: boolean;
  /** Paper A2: os três passos do app do Mac (instalar, entrar, testar) como marcas da trilha; null = sem o app. */
  passosDoMac?: (ia: IaComConta) => [MarcaDoPasso, MarcaDoPasso, MarcaDoPasso] | null;
  /** Paper A1: os nomes dos harnesses ainda não integrados (vêm da API, `executor.harnesses`). */
  emBreve?: readonly string[];
};

/**
 * "Claude · Lumen". Rodada 3 (tela 19 do Paper): o apelido que já começa pelo fornecedor ("Claude · Lumen", "Claude
 * Pessoal") não ganha o prefixo de novo ("Claude · Claude · Lumen").
 */
export const nomeDaContaNaTela = (c: Pick<ContaIa, "ia" | "apelido">): string => {
  const prov = PROVEDOR[c.ia].nome;
  const a = c.apelido.trim();
  return !a ? prov : a.toLocaleLowerCase("pt-BR").startsWith(prov.toLocaleLowerCase("pt-BR")) ? a : `${prov} · ${a}`;
};

/** O nome curto da máquina na pílula: "Mac" quando a pessoa tem um Mac só; senão o nome que ela anunciou. */
export function nomeCurto(m: MaquinaDto, maquinas: readonly MaquinaDto[]): string {
  return m.plataforma === "darwin" && maquinas.filter((x) => x.plataforma === "darwin").length === 1 ? "Mac" : m.nome;
}

const ehEsteMac = (m: MaquinaDto, x: ContextoContas) => x.noApp && x.detalhes?.maquinaId === m.id;
const noLimite = (c: ContaIa, agora: number) => c.noLimiteAte !== null && c.noLimiteAte > agora;
const prontaEm = (c: ContaIa, maquinaId: string) => c.maquinas.some((v) => v.maquinaId === maquinaId && v.estado === "pronta");

/**
 * O e-mail e a organização da conta. ADR-105: vêm do servidor, que guarda o último que alguma máquina anunciou; o app do
 * Mac que conhece a conta tem o que o CLI disse agora (pela impressão) e ganha, por ser o mais novo.
 */
function identidadeDe(c: ContaIa, x: ContextoContas): { email: string | null; organizacao: string | null } {
  const d: DetalheDaConta | undefined = x.detalhes?.contas.find((y) => y.impressao === c.impressao && y.ia === c.ia);
  return d ? { email: d.email, organizacao: d.organizacao } : { email: c.email, organizacao: c.organizacao };
}

/**
 * A conta que os bots usam agora: a primeira da fila fora do limite (na máquina do filtro, se há filtro). ADR-108 (E4):
 * sem nenhuma conta na fila, a primeira da lista.
 */
function emUso(x: ContextoContas): string | null {
  return contaEmUso(x.contas.contas, x.agora, { filtro: x.ui.filtro })?.id ?? null;
}

/**
 * A conta em uso, pura (extraída em 2026-10-16 para o seletor de IA do campo, plano "tela limpa", T6): por IA, a primeira
 * da fila fora do limite e logada em alguma máquina (na do filtro, se há filtro); sem conta da IA na fila, a primeira dela
 * (ADR-108, E4). Com `ia`, só entre as contas daquela IA.
 * QA do PR #306 (ISSUE-008): só conta logada em alguma máquina está "em uso".
 */
export function contaEmUso(contas: readonly ContaIa[], agora: number, p: { filtro?: string | null; ia?: ContaIa["ia"] } = {}): ContaIa | null {
  const logadas = contas.filter((c) => (p.ia === undefined || c.ia === p.ia) && (p.filtro ? prontaEm(c, p.filtro) : c.maquinas.some((v) => v.estado === "pronta"))).sort((a, b) => a.posicao - b.posicao);
  // NOD-390 (revisão): a mesma regra de `contaEmUsoDaIa` (src/domain/contas-da-pessoa.ts), por IA: a primeira da fila
  // livre; sem conta da IA na fila, a PRIMEIRA dela, só se livre (a segunda livre não entra sem a pessoa escolher).
  const daIa = (ia: ContaIa["ia"]): ContaIa | null => {
    const lista = logadas.filter((c) => c.ia === ia);
    const daFila = lista.find((c) => c.entraNaTrocaAutomatica && !noLimite(c, agora));
    if (daFila) return daFila;
    const [primeira] = lista;
    return primeira && !lista.some((c) => c.entraNaTrocaAutomatica) && !noLimite(primeira, agora) ? primeira : null;
  };
  return logadas.find((c) => daIa(c.ia) === c) ?? null;
}


/**
 * NOD-8 J5 (passo 11): na VM, a IA da conta abaixo do piso (o alvo pendente que a máquina anunciou em `iasDetalhe`) ganha
 * "Atualizar" na linha da conta — só com a máquina conectada e que atende o pedido remoto (`atualizaIas`). "Há versão nova"
 * (latest) fica fora. O Mac fica de fora: o cartão da IA do #498 já mostra o estado e o botão dele.
 */
function alvoPendente(c: ContaIa, m: MaquinaDto): string {
  if (m.plataforma === "darwin" || !m.conectada || m.atualizaIas !== true) return "";
  const d = m.iasDetalhe?.[c.ia];
  if (d?.causa !== "cli_antigo" || !d.minima) return "";
  const { cli } = PROVEDOR[c.ia];
  return `<button type="button" class="cl-pil tracejada" data-act="cl-atualizar-maquina" data-maquina="${esc(m.id)}" data-ia="${esc(c.ia)}" title="${esc(`${cli} ${d.versao ?? ""} na ${m.nome}; o nod precisa da ${d.minima} ou mais nova`)}">${esc(`Atualizar o ${cli}`)}</button>`;
}

export const maquinaDoLogin = (l: LoginNaTela): string => (l.onde === "vm" ? l.login.maquinaId : l.maquinaId);
export const contaDoLogin = (l: LoginNaTela): string | null => (l.onde === "vm" ? l.login.contaId : l.contaId);
export const idDoLogin = (l: LoginNaTela): string => (l.onde === "vm" ? l.login.id : l.id);

/** Revisão do PR #306: os códigos que o motor manda de verdade (motor/contas.ts, CausaFalhaLogin, ResultadoColarCodigo). */
const ERROS_LOGIN: Partial<Record<CausaFalhaLogin | Exclude<ResultadoColarCodigo, { ok: true }>["motivo"] | "tempo_esgotado" | "codigo_ilegivel" | "contas_demais" | "preparo_falhou", string>> = {
  tempo_esgotado: "O login demorou demais e foi cancelado. Tente de novo.",
  codigo_ilegivel: "A máquina não conseguiu ler o código. Gere outro na página e cole de novo.",
  contas_demais: "Essa máquina já tem contas demais dessa IA. Saia de uma antes.",
  nao_confirmou: "O login terminou, mas a máquina não confirmou a conta. Tente de novo.",
  recusou_antes_do_link: "A IA dessa máquina fechou com erro antes de abrir o login. Ela pode ter sido trocada ou estar com defeito: o motivo fica no log do motor dessa máquina.",
  nao_instalada: "A IA não está instalada nessa máquina. Rode a instalação do motor de novo.",
  codigo_invalido: "A página não aceitou o código. Gere outro e cole de novo.",
  login_por_codigo_bloqueado: "A conta não permite entrar por código. Entre pelo terminal da máquina.",
  sem_link: "A máquina não conseguiu abrir o login. Tente de novo.",
  link_nao_oficial: "O login abriu um endereço que não é o oficial e foi cancelado por segurança.",
  config_invalida: "A configuração da IA nessa máquina está com problema. Rode a instalação do motor de novo.",
  sem_login_aberto: "O login dessa máquina já tinha terminado. Tente de novo.",
  ja_enviado: "O código já foi enviado. Espere a máquina conferir.",
  // NOD-8: o passo 1 (instalar ou atualizar a IA antes do login) não terminou; com o motivo, a frase é a da atualização.
  preparo_falhou: "Não deu para preparar a IA nessa máquina. Tente de novo.",
};
const erroDoLogin = (e: string | null): string => (e ? (ERROS_LOGIN as Record<string, string | undefined>)[e] : undefined) ?? "O login não terminou. Tente de novo.";
/**
 * `cli_antigo` (devolução do #501, 2026-10-23): o comando é o da IA do login (`codex` para o Codex) e o "Clique em
 * Atualizar" só aparece quando a máquina anunciou que atende o pedido remoto (`atualizaIas`).
 */
export function erroDeCliAntigo(ia: "claude-cli" | "codex-cli", comBotao: boolean): string {
  const cmd = `nod-motor atualizar-ia ${ia === "codex-cli" ? "codex" : "claude"}`;
  return comBotao
    ? `A IA dessa máquina está desatualizada. Clique em Atualizar, ou rode ${cmd} no terminal dela.`
    : `A IA dessa máquina está desatualizada. Rode ${cmd} no terminal dela.`;
}

/** O bloco de um login aberto (G1-P3): os passos da VM, ou o cartão do Mac com os passos do app. */
function blocoDoLogin(l: LoginNaTela, x: ContextoContas, conta: ContaIa | null): string {
  const m = x.maquinas.find((y) => y.id === maquinaDoLogin(l));
  const nome = m ? nomeCurto(m, x.maquinas) : "máquina";
  const ic = m?.plataforma === "darwin" ? ICONE.laptop : ICONE.servidor;
  const id = esc(idDoLogin(l));
  const cab = (direita: string) => `<div class="cl-login-cab">${ic}<b>${m?.plataforma === "darwin" ? rotuloDoMac() : esc(nome)}</b><span>${direita}</span></div>`;
  if (l.onde === "mac") {
    return `<div class="cl-login" data-login="${id}">${cab(`<button type="button" class="ob-link" data-act="cl-login-fechar" data-login="${id}">Fechar</button>`)}<div class="cl-login-mac">${x.cartaoDoMac(l.ia)}</div></div>`;
  }
  const g = l.login;
  const empresa = PROVEDOR[g.ia].empresa;
  const cancelar = `<button type="button" class="ob-link" data-act="cl-login-cancelar" data-login="${id}">Cancelar</button>`;
  if (g.fase === "pronto") {
    const pronto = g.preparo ? `✓ ${PROVEDOR[g.ia].nome} pronto na ${nome}${versaoNova(g, m) ? ` · ${PROVEDOR[g.ia].cli} ${versaoNova(g, m)}` : ""}` : "✓ Entrou";
    const outra = g.contaId && g.contaFinalId && g.contaFinalId !== g.contaId;
    // QA do PR #306 (ISSUE-003): a "conta nova" era uma conta que já estava na lista — a tela diz qual, em vez de só sumir.
    const jaNaLista = !g.contaId && g.contaFinalId ? x.contas.contas.find((c) => c.id === g.contaFinalId) : undefined;
    const aviso = outra
      ? `<p class="cl-aviso">Você entrou com outra conta, não a ${esc(conta ? nomeDaContaNaTela(conta) : "pedida")}. Ela entrou na lista como uma conta nova.</p>`
      : jaNaLista ? `<p class="cl-aviso">Essa conta já estava na lista: <b>${esc(nomeDaContaNaTela(jaNaLista))}</b>. A ${esc(nome)} ficou com ela. <button type="button" class="ob-link" data-act="cl-login-fechar" data-login="${id}">Fechar</button></p>` : "";
    return `<div class="cl-login ok" data-login="${id}">${cab(`<span class="cl-ok">${esc(pronto)}</span>`)}${aviso}</div>`;
  }
  if (g.fase === "falhou" || g.fase === "cancelado") {
    // NOD-9 PR4: com a IA abaixo do piso, o "Atualizar" pede à máquina que atualize (POST .../ias/:ia/atualizar).
    const antiga = g.fase === "falhou" && g.erro === "cli_antigo";
    // O botão só com a máquina conectada e que atende o pedido remoto: senão o pedido ficaria guardado para ninguém.
    const podeAtualizar = antiga && m?.conectada === true && m.atualizaIas === true;
    const atualizar = podeAtualizar ? `<button type="button" class="bt pri sm" data-act="cl-atualizar-ia" data-login="${id}"${l.enviando ? " disabled" : ""}>Atualizar</button>` : "";
    // Paper A, desvio 6: depois de o código renovar sozinho e vencer de novo, o nod para e devolve as duas saídas.
    const venceu = g.fase === "falhou" && g.erro === "tempo_esgotado";
    const tentar = venceu
      ? `<button type="button" class="bt pri sm" data-act="cl-login-de-novo" data-login="${id}">Recomeçar o login</button><button type="button" class="bt sm" data-act="cl-login-fechar" data-login="${id}">Pular esta máquina</button>`
      : `${atualizar}<button type="button" class="bt sm" data-act="cl-login-de-novo" data-login="${id}">Tentar de novo</button><button type="button" class="ob-link" data-act="cl-login-fechar" data-login="${id}">Fechar</button>`;
    const nota = antiga && l.erroEnvio ? `<p class="mudo">${esc(l.erroEnvio)}</p>` : "";
    // NOD-8 passo 11: o preparo que falhou diz o motivo (sem internet, sem espaço…) e, só agora, o terminal — recolhido
    // atrás de "Prefere o terminal?", como no resto do login (protótipo v2.2: "o terminal escondido").
    const preparo = g.fase === "falhou" && g.erro === "preparo_falhou" ? fraseDaAtualizacao(g.preparo?.atualizacao, PROVEDOR[g.ia].cli, g.preparo?.acao === "instalar" ? "instalar" : "atualizar") : null;
    const cmd = g.fase === "falhou" && g.erro === "preparo_falhou" ? comandoDoTerminal("vm", g.ia) : null;
    const terminal = !cmd ? ""
      : x.ui.terminal === g.id
        ? `<p class="cl-terminal">No terminal da ${esc(nome)}: <code>${esc(cmd)}</code> <button type="button" class="ob-link" data-act="copiar-texto" data-texto="${esc(cmd)}" ${VIVO}>Copiar</button></p>`
        : `<button type="button" class="cl-terminal-link" data-act="cl-terminal" data-login="${id}">Prefere o terminal?</button>`;
    return `<div class="cl-login erro" data-login="${id}" role="alert">${cab("")}<p class="cl-erro">${esc(g.fase === "cancelado" ? "Login cancelado." : venceu ? "Os códigos venceram sem login, e o nod parou de gerar novos para não deixar um login aberto sem ninguém olhando." : antiga ? erroDeCliAntigo(g.ia, podeAtualizar) : preparo ?? erroDoLogin(g.erro))}</p>${nota}${terminal}<div class="cl-login-acoes">${tentar}</div></div>`;
  }
  if (g.fase === "preparando") return blocoDoPreparo(g, nome, id, cab(cancelar));
  if (g.fase === "pedido" || g.fase === "abrindo" || !g.url) {
    return `<div class="cl-login" data-login="${id}" role="status">${cab(cancelar)}<p class="cl-passo-txt"><span class="ob-gira" aria-hidden="true"></span>Abrindo o login na ${esc(nome)}…${m && !m.conectada ? " A máquina está sem contato; o login começa quando ela voltar." : ""}</p></div>`;
  }
  const conferindo = g.fase === "conferindo" || g.codigoEnviado;
  // Jornadas da IA (Paper A2/C2, 2026-11-19): a página oficial abre sozinha no navegador (web/lib/contas-da-pessoa.ts);
  // o bloco diz isso e deixa só o que falta — colar o código (Claude) ou digitar o código lá (Codex) — e o "Abrir de novo".
  const com = conta ? ` com a conta ${esc(conta.apelido)}` : "";
  const reabrir = `A página não abriu? <a class="cl-link" href="${esc(g.url)}" target="_blank" rel="noopener noreferrer">Abrir de novo ↗</a>`;
  let corpo: string;
  if (g.codigoDispositivo) {
    corpo = `<p class="cl-passo-txt">Abrimos a página da ${esc(empresa)} no seu navegador. Entre${com} e digite lá este código:</p>
      <div class="ia-codigo"><code>${esc(g.codigoDispositivo)}</code><button type="button" class="bt sm" data-act="copiar-texto" data-texto="${esc(g.codigoDispositivo)}" ${VIVO}>Copiar</button></div>
      <p class="cl-reabrir mudo">Nada para colar de volta: a ${esc(nome)} percebe quando você confirmar. ${reabrir}</p>`;
  } else if (g.pedeCodigo) {
    corpo = `<p class="cl-passo-txt">Abrimos a página da ${esc(empresa)} no seu navegador. Entre${com} e cole aqui o código que ela mostrar.</p>
      ${conferindo
        ? `<p class="cl-passo-txt"><span class="ob-gira" aria-hidden="true"></span>Conferindo a conta na ${esc(nome)}…</p>`
        : `<form class="cl-codigo" data-form="cl-codigo" data-login="${id}"><input name="codigo" autocomplete="off" spellcheck="false" maxlength="2048" placeholder="Código de autorização" value="${esc(l.codigo)}" data-cl-codigo="${id}" data-manter-foco="cl-codigo-${id}" aria-label="Código da página da ${esc(empresa)}"><button type="submit" class="bt"${l.enviando ? " disabled" : ""}>Enviar</button></form>${l.erroEnvio ? `<p class="cl-erro">${esc(l.erroEnvio)}</p>` : ""}`}
      <p class="cl-reabrir mudo">${reabrir} · o código renova sozinho se vencer</p>
      <p class="cl-cadeado">${ICONE.cadeado}O código vai cifrado direto para a ${esc(nome)}. O servidor do nod só repassa e não consegue ler.</p>`;
  } else {
    corpo = `<p class="cl-passo-txt">Abrimos a página da ${esc(empresa)} no seu navegador. Entre${com}; a ${esc(nome)} percebe sozinha quando terminar.</p><p class="cl-reabrir mudo">${reabrir}</p>`;
  }
  // ADR-102 (2A): o caminho do terminal fica escondido, uma linha só, para quem prefere.
  const terminal = g.ia === "claude-cli"
    ? x.ui.terminal === g.id
      ? `<p class="cl-terminal">No terminal da ${esc(nome)}: <code>nod-motor entrar claude</code> <button type="button" class="ob-link" data-act="copiar-texto" data-texto="nod-motor entrar claude" ${VIVO}>Copiar</button></p>`
      : `<button type="button" class="cl-terminal-link" data-act="cl-terminal" data-login="${id}">Prefere o terminal?</button>`
    : "";
  return `<div class="cl-login" data-login="${id}">${cab(cancelar)}<div class="cl-login-corpo">${corpo}</div>${terminal}</div>`;
}

/** A versão que a máquina ficou depois do passo 1: a do preparo ou, sem ela, a que a máquina anunciou (`iasDetalhe`). */
const versaoNova = (g: LoginNaMaquina, m: MaquinaDto | undefined): string | null => g.preparo?.depois ?? m?.iasDetalhe?.[g.ia]?.versao ?? null;

/**
 * NOD-8 (definido em 2026-10-22, protótipo v2.2): o passo 1 do login, quando a máquina instala ou atualiza a IA antes de
 * abrir a página (a fase `preparando`). O 2 espera e começa sozinho; o Cancelar para o preparo.
 */
function blocoDoPreparo(g: LoginNaMaquina, nome: string, id: string, cab: string): string {
  const { nome: ia, cli, empresa } = PROVEDOR[g.ia];
  const p = g.preparo;
  const atualizar = p?.acao === "atualizar";
  const titulo = atualizar ? `Atualizar o ${cli} na ${nome}` : `Preparar o ${ia} na ${nome}`;
  const versoes = atualizar && p.antes && p.depois ? `${p.antes} → ${p.depois}` : null;
  const linha = p?.linha || versoes || (p ? (atualizar ? `Atualizando o ${cli}` : `Instalando o ${cli}`) : "Preparando…");
  const passo1 = `<li><span class="cl-n" aria-hidden="true">1</span><div><b>${esc(titulo)}</b><p class="cl-passo-txt"><span class="ob-gira" aria-hidden="true"></span>${esc(p ? `${linha} · leva até 2 minutos` : linha)}</p></div></li>`;
  const passo2 = `<li class="mudo"><span class="cl-n" aria-hidden="true">2</span><div><b>Entrar na conta da ${esc(empresa)}</b><small class="mudo">Começa sozinho quando a ${atualizar ? "atualização" : "instalação"} terminar.</small></div></li>`;
  return `<div class="cl-login" data-login="${id}" role="status">${cab}<ol class="cl-passos">${passo1}${passo2}</ol></div>`;
}

/** NOD-12 (protótipo do Gil, quadro 16): de onde vem o número das barras, nos detalhes para não ocupar a linha. */
const DE_ONDE_VEM_O_USO: Record<ContaIa["ia"], string> = {
  "claude-cli": "O próprio Claude Code informa o uso a cada trabalho. O nod só lê esse número; não pergunta ao provedor nem gasta cota.",
  "codex-cli": "O próprio Codex informa o uso no fim de cada conversa. O nod só lê esse número; não pergunta ao provedor nem gasta cota.",
};

/**
 * definido em 2026-11-17: "Em uso" sem filtro fazia a pessoa achar que a conta servia a todos os bots, e o bot da VM onde
 * o login dela venceu parava com "nenhuma IA está pronta". Pronta em todas as máquinas conectadas: "Em uso". Senão diz
 * onde ("Em uso na nod-motor-teste", "Em uso no Mac e mais 1").
 */
export function emUsoOnde(c: ContaIa, x: Pick<ContextoContas, "maquinas">): string {
  const conectadas = x.maquinas.filter((m) => m.conectada && m.papel !== "computador");
  const onde = conectadas.filter((m) => prontaEm(c, m.id));
  if (onde.length === 0 || onde.length === conectadas.length) return "Em uso";
  const [primeira, ...resto] = onde.map((m) => nomeCurto(m, x.maquinas));
  return `Em uso na ${primeira}${resto.length ? ` e mais ${resto.length}` : ""}`;
}

/**
 * Jornadas da IA (Paper G1, 2026-11-19): a conta precisa da pessoa quando está na fila e alguma máquina dela não está
 * pronta (login vencido, sem acesso) ou quando ainda não entrou em máquina nenhuma.
 */
export function precisaDeVoce(c: ContaIa): boolean {
  return c.entraNaTrocaAutomatica && (c.maquinas.length === 0 || c.maquinas.some((v) => v.estado !== "pronta"));
}

/**
 * Um estado por conta (Paper G1): o limite com a hora; sem acesso ou login vencido em todas as máquinas; quantas faltam
 * entrar; em uso; disponível; fora da fila. A classe dá a cor do chip.
 */
export function estadoDaConta(c: ContaIa, x: Pick<ContextoContas, "agora" | "maquinas" | "ui">, usada: string | null): [classe: string, texto: string] {
  if (noLimite(c, x.agora)) return ["e-limite", `No limite até ${quandoNaTela(c.noLimiteAte!, x.agora)}`];
  const v = c.maquinas;
  if (v.length && v.every((m) => m.estado === "sem_acesso")) return ["e-erro", "Sem acesso"];
  if (v.length && v.every((m) => m.estado === "sem_login")) return ["e-erro", "Login venceu"];
  const faltam = v.filter((m) => m.estado !== "pronta").length;
  if (faltam && c.entraNaTrocaAutomatica) return ["e-aviso", `Falta entrar em ${faltam}`];
  if (c.id === usada) return ["e-uso", x.ui.filtro ? `Em uso na ${nomeCurto(x.maquinas.find((m) => m.id === x.ui.filtro)!, x.maquinas)}` : emUsoOnde(c, x)];
  return c.entraNaTrocaAutomatica ? ["e-disp", "Disponível"] : ["e-fora", "Fora da fila"];
}

/** "Leapy · 2 máquinas", "Pessoal · 2 de 3 máquinas": a organização (quando há) e o resumo das máquinas. */
function metaDaConta(c: ContaIa, d: { organizacao: string | null }): string {
  const total = c.maquinas.length;
  const prontas = c.maquinas.filter((v) => v.estado === "pronta").length;
  const maqs = total === 0 ? "nenhuma máquina ainda" : total === 1 ? c.maquinas[0]!.nome : prontas === total ? `${total} máquinas` : `${prontas} de ${total} máquinas`;
  return [d.organizacao, maqs].filter(Boolean).join(" · ");
}

/**
 * Paper G1: "Login venceu" com o "Entrar" ali na linha, na primeira máquina onde dá para entrar de novo. Só nele: o "Falta
 * entrar em N" não leva o link (no Paper também não) — a conta ainda funciona, e entrar nas outras máquinas é na conta aberta.
 */
function entrarDeNovo(c: ContaIa, x: ContextoContas): string {
  const m = c.maquinas.filter((v) => v.estado === "sem_login").map((v) => x.maquinas.find((y) => y.id === v.maquinaId)).find((y) => y?.conectada && (y.plataforma !== "darwin" || ehEsteMac(y, x)));
  return m ? `<button type="button" class="ob-link cl-entrar-link" data-act="cl-entrar" data-id="${esc(c.id)}" data-maquina="${esc(m.id)}">Entrar</button>` : "";
}

function linha(c: ContaIa, pos: number, x: ContextoContas, usada: string | null): string {
  const filtro = x.ui.filtro;
  const fora = filtro !== null && !prontaEm(c, filtro);
  const d = identidadeDe(c, x);
  const nome = nomeDaContaNaTela(c);
  const [classe, estado] = estadoDaConta(c, x, usada);
  // Paper G1b: o login nunca abre dentro da linha; ela só diz onde está entrando e leva à conta (G2c).
  const loginDaConta = x.ui.logins.find((l) => contaDoLogin(l) === c.id);
  const ondeEntra = loginDaConta ? x.maquinas.find((m) => m.id === maquinaDoLogin(loginDaConta)) : undefined;
  // No filtro, a conta que não está na máquina vira um botão grande (G2-M2).
  const direita = fora && x.maquinas.find((m) => m.id === filtro)?.conectada && !loginDaConta
    ? `<button type="button" class="bt sm" data-act="cl-entrar" data-id="${esc(c.id)}" data-maquina="${esc(filtro!)}">Entrar na ${esc(nomeCurto(x.maquinas.find((m) => m.id === filtro)!, x.maquinas))}</button>`
    : `${loginDaConta ? estadoDoLoginNaConta(loginDaConta, ondeEntra ? nomeCurto(ondeEntra, x.maquinas) : undefined) : `<span class="contas-estado ${classe}">${esc(estado)}</span>${estado === "Login venceu" ? entrarDeNovo(c, x) : ""}`}${chaveDaFila(c)}`;
  return `<li class="cl-linha cl-linha-g1${fora ? " fora" : ""}${loginDaConta ? " entrando" : ""}" data-ordem-item="${esc(c.id)}">
      <button type="button" class="cl-alca" data-alca-ordem aria-label="Mover ${esc(nome)} (setas para cima e para baixo)">${ICONE.alca}</button>
      <span class="cl-pos" aria-hidden="true">${pos}</span>
      ${logoDaIa(c.ia, "cl-logo")}
      <div class="cl-corpo">
        <div class="cl-nome"><button type="button" class="cl-nome-bt" data-act="cl-abrir" data-id="${esc(c.id)}"${c.corporativa ? ' title="Conta corporativa"' : ""}><b>${esc(nome)}</b></button>${c.plano ? `<span class="cl-plano">${esc(planoNaTela(c.plano))}</span>` : ""}${x.ui.recente === c.id ? '<span class="selo selo-nova">Nova</span>' : ""}</div>
        <div class="cl-ident"><span>${esc(metaDaConta(c, d))}</span></div>
      </div>
      <div class="cl-uso-col">${x.simulacao ? "" : usoCompacto(c)}</div>
      <div class="cl-dir">${direita}</div>
      <div class="cl-mais"><button type="button" class="cl-abrir-bt" data-act="cl-abrir" data-id="${esc(c.id)}" aria-label="Abrir ${esc(nome)}">${ICONE.seta}</button></div>
    </li>`;
}

/**
 * Jornadas da IA (Paper G2, 2026-11-19): a conta aberta numa tela própria, sem dropdown — identidade e o "na fila", o uso
 * com cada limite e quando renova, as máquinas (uma linha cada, com o estado e a ação ali mesmo) e as ações da conta.
 * O que antes morava no ⋯ (Renomear, Detalhes, Sair de cada máquina, Remover) vem para cá; o nome se edita no lugar.
 */
function linhaDaMaquina(c: ContaIa, m: MaquinaDto, x: ContextoContas): string {
  const v = c.maquinas.find((y) => y.maquinaId === m.id);
  const nome = nomeCurto(m, x.maquinas);
  const ic = m.plataforma === "darwin" ? ICONE.laptop : ICONE.servidor;
  const login = x.ui.logins.find((l) => maquinaDoLogin(l) === m.id && contaDoLogin(l) === c.id);
  const podeEntrar = m.plataforma !== "darwin" || ehEsteMac(m, x);
  const sair = v && v.estado !== "sem_acesso" ? `<button type="button" class="ob-link cl-maq-sair" data-act="cl-sair" data-id="${esc(c.id)}" data-maquina="${esc(m.id)}">Sair</button>` : "";
  let estado = "";
  let acao = "";
  if (login) estado = estadoDoLoginNaConta(login);
  else if (v?.estado === "pronta") estado = `<span class="contas-estado ${m.conectada ? "e-uso" : "e-fora"}">${m.conectada ? "✓ Pronta" : "Fora do ar"}</span>`;
  else if (v?.estado === "sem_acesso") estado = '<span class="contas-estado e-erro">Sem acesso</span>';
  else if (!m.conectada) estado = '<span class="contas-estado e-fora">Fora do ar</span>';
  else if (!podeEntrar) estado = `<span class="cl-maq-dica">Entre pelo app do nod no ${esc(nome)}</span>`;
  else acao = `<button type="button" class="bt pri sm" data-act="cl-entrar" data-id="${esc(c.id)}" data-maquina="${esc(m.id)}">${v?.estado === "sem_login" ? "Entrar de novo" : "Entrar"}</button>`;
  const sub = login ? `${m.iasDetalhe?.[c.ia]?.versao ? `${PROVEDOR[c.ia].cli} ${m.iasDetalhe[c.ia]!.versao} · ` : ""}${v ? "entrando de novo" : "entrando"}` : v?.estado === "sem_login" ? "O login saiu desta máquina" : v?.estado === "sem_acesso" ? "A organização desligou o acesso desta conta" : v?.estado === "pronta" ? (m.conectada ? (m.iasDetalhe?.[c.ia]?.versao ? `${PROVEDOR[c.ia].cli} ${m.iasDetalhe[c.ia]!.versao}` : "Logada") : `${m.nome} fora do ar`) : "Ainda não entrou nesta máquina";
  // Paper G2c: o login mora embaixo da máquina dele, no mesmo bloco da Nova conta (sem repetir o nome da máquina).
  const bloco = login ? `<li class="cl-maq-login">${blocoDoLogin(login, x, c)}</li>` : "";
  return `<li class="cl-maq-linha">${ic}<div class="cl-maq-txt"><b>${esc(m.nome)}</b><small>${esc(sub)}</small></div>${alvoPendente(c, m)}${estado}${acao}${login ? "" : sair}</li>${bloco}`;
}

/** O estado do login na linha da máquina (Paper G2c) e na linha da lista (G1b). */
function estadoDoLoginNaConta(l: LoginNaTela, onde?: string): string {
  const em = onde ? ` na ${onde}` : "";
  if (l.onde === "mac") return `<span class="contas-estado e-aviso">Entrando${esc(em)}</span>`;
  const g = l.login;
  if (g.fase === "pronto") return '<span class="contas-estado e-uso">✓ Pronta</span>';
  if (g.fase === "falhou" || g.fase === "cancelado") return `<span class="contas-estado e-erro">Não entrou${esc(em)}</span>`;
  if (onde) return `<span class="contas-estado e-aviso">Entrando${esc(em)}</span>`;
  if (g.fase === "preparando") return `<span class="contas-estado e-disp">${g.preparo?.acao === "atualizar" ? "Atualizando…" : "Instalando…"}</span>`;
  if (g.fase === "conferindo" || g.codigoEnviado) return '<span class="contas-estado e-disp">Testando a conta…</span>';
  if (g.fase === "aguardando_pessoa" && g.url) return '<span class="contas-estado e-aviso">Esperando você no navegador</span>';
  return '<span class="contas-estado e-disp">Abrindo o login…</span>';
}

export function renderContaAberta(c: ContaIa, x: ContextoContas, usada: string | null): string {
  const d = identidadeDe(c, x);
  const nome = nomeDaContaNaTela(c);
  const [classe, estado] = estadoDaConta(c, x, usada);
  const posicao = x.contas.contas.findIndex((y) => y.id === c.id) + 1;
  const ident = [d.email, d.organizacao, `${posicao}ª da fila`, `pelo ${PROVEDOR[c.ia].cli}`].filter(Boolean).join(" · ");
  const maquinas = x.maquinas.filter((m) => m.conectada || c.maquinas.some((v) => v.maquinaId === m.id));
  // Só o login de máquina que não está na lista (a linha de cada máquina já leva o dela, Paper G2c).
  const logins = x.ui.logins.filter((l) => contaDoLogin(l) === c.id && !maquinas.some((m) => m.id === maquinaDoLogin(l))).map((l) => blocoDoLogin(l, x, c)).join("");
  // Paper A, desvio 7: a organização desligou o acesso — diz quem, para qual e-mail, e as duas saídas ali mesmo.
  const semAcesso = c.maquinas.some((v) => v.estado === "sem_acesso")
    ? `<div class="cl-conta-limite cl-conta-sem-acesso" role="status"><span class="contas-estado e-erro">Sem acesso</span><span class="mudo">${esc(`${d.organizacao ?? "A organização"} desligou o ${PROVEDOR[c.ia].nome} por assinatura${d.email ? ` para ${d.email}` : ""}. Os bots já pulam esta conta.`)}</span><span class="cl-conta-acoes-linha"><button type="button" class="bt pri sm" data-act="cl-nova-da-conta" data-id="${esc(c.id)}">Entrar com outra conta</button>${c.entraNaTrocaAutomatica ? `<button type="button" class="bt sm" data-act="cl-fila" data-id="${esc(c.id)}">Tirar da fila</button>` : ""}</span></div>`
    : "";
  const limite = classe === "e-limite"
    ? `<div class="cl-conta-limite"><span class="contas-estado e-limite">${esc(estado)}</span><span class="mudo">Se a conta voltou antes, tente de novo.</span><button type="button" class="bt sm" data-act="cl-tentar-de-novo" data-id="${esc(c.id)}">Tentar de novo</button></div>`
    : "";
  // Paper G2: "medido há 8 h no nod-motor-teste" ao lado do título.
  const ondeMediu = c.cota?.maquinaId ? x.maquinas.find((m) => m.id === c.cota!.maquinaId) : undefined;
  const medido = c.cota && !x.simulacao ? `medido ${haQuanto(x.agora - c.cota.medidoEm)}${ondeMediu ? ` no ${nomeCurto(ondeMediu, x.maquinas)}` : ""}` : "";
  const uso = x.simulacao ? "" : usoDaConta(c, { agora: x.agora, contas: x.contas.contas, nomeDaMaquina: (id) => { const m = x.maquinas.find((y) => y.id === id); return m ? nomeCurto(m, x.maquinas) : null; } });
  // Revisão de 2026-11-20: o nome se edita no lugar, com o mesmo componente do nome do bot (web/lib/nome-editavel.ts).
  // O apelido é o que se edita; o fornecedor fica fixo na frente quando o apelido não começa por ele ("Claude ·").
  const apelido = c.apelido.trim();
  const prov = PROVEDOR[c.ia].nome;
  const prefixo = !apelido ? prov : nome === apelido ? "" : `${prov} ·`;
  const titulo = `${prefixo ? `<span class="cl-nome-prov">${esc(prefixo)}</span>` : ""}${campoDeNome({ dono: "conta", campo: "apelido", id: c.id, valor: c.apelido, rotulo: `Nome da conta ${nome}`, maxlength: 40, inputId: "cl-conta-nome", classe: "cl-nome-campo", placeholder: "Dar um nome", extra: 'data-manter-foco="cl-conta-nome"' })}`;
  return `<div class="cl-conta-pag" data-pagina="cl-conta" data-id="${esc(c.id)}">
      <div class="cl-np-cab"><button type="button" class="cl-np-voltar" data-act="cl-fechar-conta" aria-label="Voltar para Provedores de IA">${ICONE_VOLTAR}</button><span class="cl-np-mig">Provedores de IA</span><span class="cl-np-sep" aria-hidden="true">/</span><h2 class="cl-nova-tit">${esc(nome)}</h2></div>
      <div class="cl-conta-id">${logoDaIa(c.ia, "cl-logo grande")}<div class="cl-conta-id-txt"><div class="cl-nome">${titulo}${c.plano ? `<span class="cl-plano">${esc(planoNaTela(c.plano))}</span>` : ""}${c.corporativa ? '<span class="selo">Corporativa</span>' : ""}</div><small>${esc(ident)}</small></div><label class="cl-conta-fila"><span>Bots podem usar</span>${chaveDaFila(c)}</label></div>
      ${limite}${semAcesso}
      <section class="cl-conta-sec" aria-label="Uso"><h3${c.cota !== undefined && !x.simulacao ? ` title="${esc(DE_ONDE_VEM_O_USO[c.ia])}"` : ""}>Uso${medido ? `<small>${esc(medido)}</small>` : ""}</h3>${uso || '<p class="mudo">O uso aparece depois do primeiro trabalho com esta conta.</p>'}</section>
      <section class="cl-conta-sec" aria-label="Máquinas"><h3>Máquinas</h3><ul class="cl-maq-lista">${maquinas.map((m) => linhaDaMaquina(c, m, x)).join("") || '<li class="cl-maq-linha mudo">Nenhuma máquina conectada.</li>'}</ul>${logins}</section>
      <div class="cl-conta-acoes"><span class="cl-conta-acoes-sep"></span><button type="button" class="ob-link cl-remover-link" data-act="cl-remover" data-id="${esc(c.id)}">Remover conta</button></div>
    </div>`;
}

/**
 * ADR-108 (R8): o liga/desliga "na fila" da conta. Ligado, o Nod pode passar sozinho para ela quando a anterior da mesma
 * IA acaba; desligado, ela só é usada quando você escolhe ("Seguir com"). Ligar a 2ª da mesma IA mostra os termos de uso
 * antes (NOD-308: a corporativa segue a mesma regra) (web/lib/contas-da-pessoa.ts).
 */
function chaveDaFila(c: ContaIa): string {
  const nome = nomeDaContaNaTela(c);
  return `<button type="button" class="chave cl-fila" role="switch" aria-checked="${c.entraNaTrocaAutomatica}" data-act="cl-fila" data-id="${esc(c.id)}" aria-label="${esc(`${nome} na fila`)}" title="${c.entraNaTrocaAutomatica ? "Na fila: o Nod pode passar sozinho para ela" : "Fora da fila: só quando você escolher"}"><span></span></button>`;
}

/** ADR-108 (R8, canvas Main): não há regra para configurar — só como o Nod age quando uma conta acaba. */
export const REGRAS_DA_FILA: readonly { titulo: string; texto: string }[] = [
  { titulo: "Mesma IA", texto: "passa sozinho para a próxima conta ligada na fila. No Claude, nada se perde. No ChatGPT, a tarefa com sessão recomeçaria do resumo noutra conta: o Nod recomenda esperar ou seguir, e você decide." },
  { titulo: "Outra IA", texto: "só nos bots em Automático. A conversa segue na hora." },
  { titulo: "Tarefas em andamento", texto: "trocar de IA faz a tarefa recomeçar do resumo. Por isso o Nod recomenda esperar ou trocar, pela hora em que a conta volta, e você decide." },
];

/**
 * Jornadas da IA (Paper A1, 2026-11-19): os fornecedores numa lista que cresce para baixo — os que já entram e, numa
 * linha só, os que chegam em breve (os harnesses ainda não integrados, que a API manda em `executor.harnesses`).
 */
const ASSINATURA: Record<IaComConta, string> = { "claude-cli": "assinatura Pro, Max ou Team", "codex-cli": "assinatura Plus, Pro ou Team" };
const IAS_COM_CONTA: readonly IaComConta[] = ["claude-cli", "codex-cli"];
export function emBreve(nomes: readonly string[]): string {
  if (!nomes.length) return "";
  return `${nomes.length > 1 ? `${nomes.slice(0, -1).join(", ")} e ${nomes.at(-1)}` : nomes[0]} ${nomes.length > 1 ? "chegam" : "chega"} em breve`;
}

export type MarcaDoPasso = "feito" | "ativo" | "girando" | "erro" | "depois";
/** Paper A1b/A2: "Instalar · Conta · Teste" de uma máquina, pelo que o login dela diz. */
export function trilhaDoLogin(g: LoginNaMaquina): [MarcaDoPasso, MarcaDoPasso, MarcaDoPasso] {
  if (g.fase === "pronto") return ["feito", "feito", "feito"];
  if (g.fase === "preparando") return ["girando", "depois", "depois"];
  if (g.fase === "falhou" || g.fase === "cancelado") return g.erro === "preparo_falhou" || g.erro === "cli_antigo" || g.erro === "nao_instalada" ? ["erro", "depois", "depois"] : g.erro === "nao_confirmou" ? ["feito", "feito", "erro"] : ["feito", "erro", "depois"];
  if (g.fase === "conferindo" || g.codigoEnviado) return ["feito", "feito", "girando"];
  if (g.fase === "aguardando_pessoa" && g.url) return ["feito", "ativo", "depois"];
  return ["feito", "girando", "depois"];
}
function trilha(marcas: readonly MarcaDoPasso[], instalouAgora: boolean): string {
  const nomes = [instalouAgora || marcas[0] !== "feito" ? "Instalar" : "Instalado", "Conta", "Teste"];
  const icone: Record<MarcaDoPasso, string> = { feito: "✓", ativo: "○", girando: '<span class="ob-gira" aria-hidden="true"></span>', erro: "!", depois: "○" };
  const falado: Record<MarcaDoPasso, string> = { feito: "feito", ativo: "agora", girando: "em andamento", erro: "falhou", depois: "depois" };
  return `<ol class="cl-trilha" aria-label="Passos nesta máquina">${marcas.map((m, k) => `<li class="t-${m}"><span aria-hidden="true">${icone[m]}</span>${nomes[k]}<span class="qd-sr"> (${falado[m]})</span></li>`).join("")}</ol>`;
}

/** O formulário "Nova conta" (Paper A1 → A1b/A2 → A3): fornecedor, apelido, onde roda e, depois do Conectar, cada máquina. */
function formNova(x: ContextoContas): string {
  const n = x.ui.nova;
  if (!n) return `<button type="button" class="bt cl-adicionar" data-act="cl-nova">${ICONE.mais}Adicionar conta</button>`;
  // O login mora numa máquina (a impressão da conta só existe depois dele): sem uma que receba o login, não há formulário,
  // e sim o porquê e o caminho (pedido do Marlon no PR #306: "não entendi esse ponto de conectar em uma máquina").
  const recebem = x.maquinas.filter((m) => m.conectada && (m.plataforma !== "darwin" || ehEsteMac(m, x)));
  if (recebem.length === 0) return semMaquina(x);
  const entrando = !!n.entrando;
  const { nome: nomeIa, empresa, cli } = PROVEDOR[n.ia];
  const breve = emBreve(x.emBreve ?? []);
  const provedor = entrando
    ? `<div class="cl-prov-escolhido">${logoDaIa(n.ia, "cl-logo")}<span class="cl-prov-txt"><b>${esc(nomeIa)}</b><small>${esc(empresa)} · pelo ${esc(cli)}</small></span></div>`
    : `<div class="cl-provs" role="radiogroup" aria-labelledby="cl-np-forn">${IAS_COM_CONTA.map((ia) => `<label class="cl-prov${n.ia === ia ? " ativo" : ""}"><input type="radio" name="ia" value="${ia}" class="cl-prov-in" data-cl-nova-ia${n.ia === ia ? " checked" : ""}><i class="cl-prov-radio" aria-hidden="true"></i>${logoDaIa(ia, "cl-logo")}<span class="cl-prov-txt"><b>${esc(PROVEDOR[ia].nome)}</b><small>${esc(PROVEDOR[ia].empresa)} · pelo ${esc(PROVEDOR[ia].cli)} · ${esc(ASSINATURA[ia])}</small></span></label>`).join("")}${breve ? `<div class="cl-prov-breve"><span class="cl-prov-breve-logos" aria-hidden="true"><i></i><i></i></span><span>${esc(breve)}</span></div>` : ""}</div>`;
  const dela = (m: MaquinaDto) => x.ui.logins.find((l) => maquinaDoLogin(l) === m.id && contaDoLogin(l) === null && (l.onde === "vm" ? l.login.ia : l.ia) === n.ia);
  const recebe = (m: MaquinaDto) => m.conectada || (m.plataforma !== "darwin" && !!m.nuvem);
  const versao = (m: MaquinaDto) => m.iasDetalhe?.[n.ia]?.versao ?? null;
  const ic = (m: MaquinaDto) => (m.plataforma === "darwin" ? ICONE.laptop : ICONE.servidor);
  const rotulo = (m: MaquinaDto) => (m.plataforma === "darwin" && ehEsteMac(m, x) ? rotuloDoMac() : m.nome);
  let maqs: string;
  if (!entrando) {
    maqs = x.maquinas.filter(recebe).map((m) => {
      const mac = m.plataforma === "darwin";
      const pode = !mac || ehEsteMac(m, x);
      const v = versao(m);
      const sub = !m.conectada ? "Desligada" : m.ias[n.ia] === "ausente" ? `Sem ${cli} ainda` : v ? `${cli} ${v}` : mac && pode ? "Este Mac" : "";
      const prepara = preparoNaNova(m, n.ia);
      const dica = !m.conectada ? "Liga ao conectar" : mac ? (pode ? "Abre o navegador deste Mac" : "Abra o app do nod nesse Mac") : prepara ? `O nod ${prepara.includes("atualiza") ? "atualiza" : "instala"} ao conectar · ~1 min` : "O login aparece aqui na tela";
      const marcada = n.maquinas.includes(m.id) && pode;
      return `<label class="cl-maq${pode ? "" : " mudo"}"><input type="checkbox" value="${esc(m.id)}" data-cl-nova-maq${marcada ? " checked" : ""}${!pode ? " disabled" : ""}>${ic(m)}<span><b>${esc(rotulo(m))}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</span><span class="cl-maq-dica">${esc(dica.charAt(0).toUpperCase() + dica.slice(1))}</span></label>`;
    }).join("");
  } else {
    maqs = n.maquinas.map((id) => x.maquinas.find((m) => m.id === id)).filter((m): m is MaquinaDto => !!m).map((m) => {
      const l = dela(m);
      const cabeca = (sub: string, direita: string) => `<div class="cl-maq cl-maq-entrando">${ic(m)}<span><b>${esc(rotulo(m))}</b><small>${esc(sub)}</small></span>${direita}</div>`;
      if (!l) return cabeca(m.conectada ? "Começando…" : "Ligando a máquina…", '<span class="cl-np-est"><span class="ob-gira" aria-hidden="true"></span>Aguarde</span>');
      // O Mac mostra o cartão da IA do app (instalar, entrar, testar), com os passos dele.
      // Paper A2: o Mac com a mesma trilha da VM (lida dos passos do app) e, do cartão do app, só o passo da vez.
      if (l.onde === "mac") {
        const marcas = x.passosDoMac?.(l.ia) ?? null;
        const chip = !marcas ? estadoDoLoginNaNova(l)
          : marcas[1] === "ativo" ? '<span class="cl-np-chip"><i aria-hidden="true"></i>Esperando você no navegador</span>'
            : marcas[0] === "girando" ? '<span class="cl-np-est"><span class="ob-gira" aria-hidden="true"></span>Instalando…</span>'
              : marcas[2] === "girando" || marcas[2] === "ativo" ? '<span class="cl-np-est"><span class="ob-gira" aria-hidden="true"></span>Testando a conta…</span>'
                : marcas.every((k) => k === "feito") ? '<span class="cl-np-est ok">✓ Pronta</span>'
                  : marcas.includes("erro") ? '<span class="cl-np-est erro">Não entrou</span>' : estadoDoLoginNaNova(l);
        return `<div class="cl-maq-bloco cl-maq-mac">${cabeca(versao(m) ? `${cli} ${versao(m)} pelo app do nod` : `${cli} pelo app do nod`, chip)}${marcas ? trilha(marcas, false) : ""}<div class="cl-np-login">${x.cartaoDoMac(l.ia)}</div></div>`;
      }
      const g = l.login;
      const v = versaoNova(g, m);
      const sub = g.fase === "preparando"
        ? (g.preparo?.linha || `${g.preparo?.acao === "atualizar" ? "Atualizando" : "Instalando"} o ${cli} · leva até 2 minutos`)
        : g.fase === "pronto" ? `${v ? `${cli} ${v} · ` : ""}a conta entrou e foi conferida` : v ? `${cli} ${v}${g.preparo ? " instalado agora" : ""}` : cli;
      const passos = !["pronto", "pedido", "abrindo", "preparando"].includes(g.fase) && (g.url || g.fase === "falhou" || g.fase === "cancelado") ? `<div class="cl-np-login">${blocoDoLogin(l, x, null)}</div>` : "";
      return `<div class="cl-maq-bloco">${cabeca(sub, estadoDoLoginNaNova(l))}${g.fase === "pronto" ? "" : trilha(trilhaDoLogin(g), !!g.preparo)}${passos}</div>`;
    }).join("");
  }
  const marcadas = n.maquinas.filter((id) => x.maquinas.some((m) => m.id === id && recebe(m))).length;
  const daNova = n.maquinas.map((id) => x.maquinas.find((m) => m.id === id)).filter((m): m is MaquinaDto => !!m).map(dela);
  const andando = daNova.some((l) => l && (l.onde === "mac" || !FASES_FINAIS.has(l.login.fase)));
  const instalando = daNova.some((l) => l?.onde === "vm" && l.login.fase === "preparando");
  // Paper A3: a conta que entrou e o lugar dela na fila.
  const finalId = daNova.map((l) => (l?.onde === "vm" && l.login.fase === "pronto" ? l.login.contaFinalId : null)).find(Boolean) ?? null;
  const apelido = n.apelido.trim();
  const final = entrando && !andando ? x.contas.contas.find((c) => c.id === finalId) ?? (apelido ? x.contas.contas.find((c) => c.ia === n.ia && c.apelido === apelido) : undefined) : undefined;
  const pos = final ? x.contas.contas.findIndex((c) => c.id === final.id) + 1 : 0;
  const fila = final
    ? `<div class="cl-np-fila" role="status"><b>${esc(nomeDaContaNaTela(final))} ${final.entraNaTrocaAutomatica ? `é a ${pos}ª conta da fila` : "ficou fora da fila"}</b><p>${final.entraNaTrocaAutomatica
      ? "Os bots em Automático já podem usar. Quando ela chegar ao limite, eles passam para a próxima sozinhos, e você vê a hora em que ela volta."
      : "Ela só é usada quando você escolher. Para o nod passar para ela sozinho, ligue o “na fila” dela na lista."}</p></div>`
    : "";
  const passosAntes = entrando ? "" : `<div class="cl-np-passos"><b>Ao conectar, em cada máquina</b><ol><li><span>1</span>Instala o que faltar</li><li><span>2</span>Abre o login no navegador</li><li><span>3</span>Confere se a conta responde</li></ol></div>`;
  const entrar = !entrando
    ? `<button type="submit" class="cl-np-entrar"${marcadas === 0 ? " disabled" : ""}>${marcadas > 1 ? `Conectar nas ${marcadas} máquinas` : "Conectar"}</button>`
    : andando
      ? `<button type="submit" class="cl-np-entrar" disabled>${instalando ? "Instalando…" : "Conectando…"}</button>`
      : `<button type="button" class="cl-np-entrar" data-act="cl-nova-fechar"${final ? ` data-recente="${esc(final.id)}"` : ""}>${final || daNova.some((l) => l?.onde === "vm" && l.login.fase === "pronto") ? "Concluir" : "Fechar"}</button>`;
  // Depois do Conectar a página vira <div>: o login de cada máquina tem o <form> dele (o código), e form dentro de form
  // some no parser — o "Enviar" do código mandaria a Nova conta.
  const tag = entrando ? "div" : "form";
  return `<${tag} class="cl-nova cl-nova-pag" data-form="cl-nova" aria-labelledby="cl-nova-tit">
      <div class="cl-np-cab"><button type="button" class="cl-np-voltar" data-act="cl-nova-fechar" aria-label="Voltar para Provedores de IA">${ICONE_VOLTAR}</button><span class="cl-np-mig">Provedores de IA</span><span class="cl-np-sep" aria-hidden="true">/</span><h2 class="cl-nova-tit" id="cl-nova-tit">Nova conta</h2></div>
      <span class="cl-campo-tit" id="cl-np-forn">Fornecedor</span>
      ${provedor}
      <label class="cl-campo"><span class="cl-campo-tit">Apelido</span><input name="apelido" maxlength="40" placeholder="ex.: Lumen, Pessoal, Freela" value="${esc(n.apelido)}" data-cl-nova-apelido data-manter-foco="cl-nova-apelido" aria-describedby="cl-np-apelido-dica"${entrando ? " readonly" : ""}></label>
      <small class="qd-sr" id="cl-np-apelido-dica">Aparece na lista e na conversa. E-mail e organização ficam só nas suas máquinas.</small>
      <span class="cl-campo-tit" id="cl-np-maqs">Onde a conta vai rodar</span>
      <div class="cl-maqs-form${entrando ? " entrando" : ""}" role="group" aria-labelledby="cl-np-maqs">${maqs}${entrando && !final ? '<p class="cl-np-paralelo mudo">As máquinas andam em paralelo. A instalação usa uma cópia do nod e não mexe no que você já usa no Terminal.</p>' : ""}</div>
      ${passosAntes}${fila}
      <div class="cl-nova-acoes"><p class="cl-np-nota">${ICONE_CADEADO}<span>O nod não vê sua senha: o login é no site da ${esc(empresa)}, e a sessão fica em cada máquina.</span></p><button type="button" class="cl-np-cancelar" data-act="cl-nova-fechar">Cancelar</button>${entrar}</div>
    </${tag}>`;
}

const FASES_FINAIS: ReadonlySet<string> = new Set(["pronto", "falhou", "cancelado"]);

/** O estado do login à direita da máquina, na Nova conta (tela 19b do Paper). */
function estadoDoLoginNaNova(l: LoginNaTela): string {
  const gira = '<span class="ob-gira" aria-hidden="true"></span>';
  // O cartão do app (embaixo) diz o passo exato; aqui só que está andando.
  if (l.onde === "mac") return `<span class="cl-np-est">${gira}Em andamento</span>`;
  const g = l.login;
  if (g.fase === "pronto") return `<span class="cl-np-est ok">✓ Pronta</span>`;
  if (g.fase === "falhou" || g.fase === "cancelado") return `<span class="cl-np-est erro">Não entrou</span>`;
  if (g.fase === "preparando") return `<span class="cl-np-est">${gira}${g.preparo?.acao === "atualizar" ? "Atualizando…" : "Instalando…"}</span>`;
  if (g.fase === "conferindo" || g.codigoEnviado) return `<span class="cl-np-est">${gira}Testando a conta…</span>`;
  if (!g.url || g.fase === "pedido" || g.fase === "abrindo") return `<span class="cl-np-est">${gira}Abrindo o login…</span>`;
  return `<span class="cl-np-chip"><i aria-hidden="true"></i>Esperando você no navegador</span>`;
}

const ICONE_VOLTAR = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 4L6 8l4 4"/></svg>';
const ICONE_CADEADO = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 015 0v2"/></svg>';

/**
 * NOD-8 (definido em 2026-10-22): na VM sem a IA (ou abaixo do piso), a Nova conta avisa que o nod instala (ou atualiza)
 * antes do login, lendo o que a máquina anunciou (`MaquinaDto.ias`/`iasDetalhe`). null = a IA já está lá (ou não se sabe).
 */
function preparoNaNova(m: MaquinaDto, ia: IaComConta): string | null {
  if (m.ias[ia] !== "ausente") return null;
  const causa = m.iasDetalhe?.[ia]?.causa;
  if (causa === "sonda_lenta" || causa === "sem_node" || causa === "config_invalida") return null;
  return `o nod ${causa === "cli_antigo" ? "atualiza" : "instala"} o ${PROVEDOR[ia].nome} nela e o login aparece aqui`;
}

/** "Adicionar conta" sem nenhuma máquina que receba o login: diz por que e leva a conectar uma. */
function semMaquina(x: ContextoContas): string {
  const macFechado = x.maquinas.some((m) => m.conectada && m.plataforma === "darwin");
  const mac = x.noApp
    ? ""
    : macFechado
      ? "<p>Seu Mac já está conectado: abra o app do nod nele para entrar por lá.</p>"
      : "<p>No Mac, o login é feito pelo app do nod: abra o app e ele se conecta sozinho.</p>";
  return `<div class="espaco-cartao cl-nova cl-sem-maquina" role="group" aria-labelledby="cl-sem-maquina-tit">
      <b class="cl-nova-tit" id="cl-sem-maquina-tit">Nova conta</b>
      <p>Suas contas de IA ficam nas suas máquinas: o login do Claude e do ChatGPT é feito no Mac, pelo app do nod, ou numa VM. O nod guarda só o apelido. Conecte uma máquina para entrar.</p>
      ${mac}
      <div class="cl-nova-acoes"><button type="button" class="bt" data-act="cl-nova-fechar">Cancelar</button><button type="button" class="bt pri" data-act="cl-conectar-vm">${ICONE.servidor}Conectar uma VM</button></div>
    </div>`;
}

/** "A", "A e B", "A, B e C". */
const emLista = (itens: readonly string[]): string => (itens.length < 2 ? itens.join("") : `${itens.slice(0, -1).join(", ")} e ${itens.at(-1)!}`);

/**
 * NOD-293 C11 (definido em 2026-10-20): antes de sair ou remover, o diálogo diz quais frentes param. A conversa sem frente
 * aparece como "a conversa com {bot}"; na remoção (várias máquinas), a máquina vai entre parênteses. Sem conferir (a busca
 * falhou), o aviso diz o risco e não bloqueia: a pessoa decide. Os quatro estados ficam em role="status".
 */
function avisoDasFrentes(x: ContextoContas, frentes: readonly FrenteAtivaDaConta[] | null | undefined, acao: "sair" | "remover"): string {
  if (frentes === undefined) return `<p class="cl-caixa" role="status">Conferindo as tarefas que usam esta conta…</p>`;
  if (frentes === null) return `<p class="cl-caixa cl-caixa-aviso" role="status">Não deu para conferir se alguma tarefa usa esta conta. Se houver alguma, ela para ao ${acao}.</p>`;
  if (!frentes.length) return `<p class="cl-caixa" role="status">Nenhuma tarefa usa esta conta agora.</p>`;
  const itens = frentes.map((f) => {
    const rotulo = `<b>${esc(f.titulo ?? `a conversa com ${f.agente}`)}</b>`;
    if (acao === "sair") return rotulo;
    const m = x.maquinas.find((y) => y.id === f.maquinaId);
    const onde = m ? nomeCurto(m, x.maquinas) : f.maquina;
    return onde ? `${rotulo} (${esc(onde)})` : rotulo;
  });
  return `<p class="cl-caixa" role="status">Vão parar: ${emLista(itens)}.</p>`;
}

/** As confirmações (G1-P5 Sair, G1-P6 Remover) num diálogo sobre a tela. */
function confirmacao(x: ContextoContas): string {
  const q = x.ui.confirmar;
  if (!q) return "";
  const c = x.contas.contas.find((y) => y.id === q.contaId);
  if (!c) return "";
  const nome = nomeDaContaNaTela(c);
  let titulo = "";
  let corpo = "";
  let botao = "";
  if (q.tipo === "sair") {
    const m = x.maquinas.find((y) => y.id === q.maquinaId);
    const nm = m ? nomeCurto(m, x.maquinas) : "máquina";
    // "do Mac", "da vm-bots": o artigo segue a máquina (o Sair agora mora na conta aberta, Paper G2).
    const o = m?.plataforma === "darwin" ? "o" : "a";
    // "No Mac", "Na vm-bots": o artigo segue cada máquina (a frase dizia "Na Mac").
    const outrasMaqs = c.maquinas.filter((v) => v.maquinaId !== q.maquinaId && v.estado === "pronta").map((v) => { const o = x.maquinas.find((y) => y.id === v.maquinaId); return `${o?.plataforma === "darwin" ? "no" : "na"} ${o ? nomeCurto(o, x.maquinas) : v.nome}`; });
    const outrasContas = x.contas.contas.filter((o) => o.id !== c.id && prontaEm(o, q.maquinaId)).map(nomeDaContaNaTela);
    const bots = x.botsNaMaquina(q.maquinaId);
    titulo = `Sair da ${nome} n${o} ${nm}?`;
    corpo = `${avisoDasFrentes(x, q.frentes, "sair")}<p>${o.toUpperCase()} ${esc(nm)} esquece o login desta conta.${outrasMaqs.length ? ` Ela continua ${esc(outrasMaqs.join(" e "))}.` : ""}</p>
      ${bots.length ? `<div class="cl-caixa">${outrasContas.length
        ? `Os bots da ${esc(nm)} (${esc(bots.join(", "))}) seguem com as outras contas logadas lá: ${outrasContas.map((o) => `<b>${esc(o)}</b>`).join(" e ")}.`
        : `A ${esc(nm)} fica sem conta de IA: os bots dela (${esc(bots.join(", "))}) esperam até você entrar numa conta lá.`}</div>` : ""}`;
    botao = `<button type="button" class="bt perigo" data-act="cl-confirmar"${q.frentes === undefined ? " disabled aria-busy=\"true\"" : ""}>Sair d${o} ${esc(nm)}</button>`;
  } else {
    const nomes = c.maquinas.map((v) => { const o = x.maquinas.find((y) => y.id === v.maquinaId); return o ? nomeCurto(o, x.maquinas) : v.nome; });
    titulo = `Remover a ${nome}?`;
    corpo = `${avisoDasFrentes(x, q.frentes, "remover")}<p>${nomes.length ? `O nod sai desta conta ${nomes.length === 1 ? "na" : "no"} ${esc(nomes.join(" e na "))} e apaga a pasta dela${nomes.length > 1 ? ` nas ${nomes.length === 2 ? "duas" : nomes.length}` : ""}. ` : ""}Ela some da lista; as outras continuam.</p><p class="mudo sm">Para usar de novo, é só adicionar a conta outra vez.</p>`;
    botao = `<button type="button" class="bt perigo" data-act="cl-confirmar"${q.frentes === undefined ? " disabled aria-busy=\"true\"" : ""}>${nomes.length > 1 ? `Remover das ${nomes.length} máquinas` : "Remover"}</button>`;
  }
  return `<div class="cl-fundo" data-act="cl-confirmar-fechar"></div><div class="cl-dialogo" role="dialog" aria-modal="true" aria-labelledby="cl-dialogo-tit"><h3 id="cl-dialogo-tit">${esc(titulo)}</h3>${corpo}<div class="cl-dialogo-acoes"><button type="button" class="bt" data-act="cl-confirmar-fechar" data-cl-autofoco>Cancelar</button>${botao}</div></div>`;
}

/** QA do PR #306 (ISSUE-009): "Entrando…" só enquanto algum login corre; terminado, a linha diz como acabou. */
function estadoDosLogins(ls: readonly LoginNaTela[]): string {
  const fases = ls.map((l) => (l.onde === "vm" ? l.login.fase : "abrindo"));
  if (fases.some((f) => f !== "pronto" && f !== "falhou" && f !== "cancelado")) return '<span class="contas-estado e-disp">Entrando…</span>';
  return fases.includes("pronto") ? '<span class="contas-estado e-uso">Entrou</span>' : "";
}

/** Os logins de contas novas (sem conta na lista ainda) aparecem embaixo da lista. */
function loginsSemConta(x: ContextoContas): string {
  const soltos = x.ui.logins.filter((l) => {
    const id = contaDoLogin(l);
    return id === null || !x.contas.contas.some((c) => c.id === id);
  });
  if (soltos.length === 0) return "";
  const porConta = new Map<string, LoginNaTela[]>();
  for (const l of soltos) {
    const ia = l.onde === "vm" ? l.login.ia : l.ia;
    const apelido = l.onde === "vm" ? l.login.apelido : l.apelido;
    const k = `${ia}:${apelido ?? ""}`;
    porConta.set(k, [...(porConta.get(k) ?? []), l]);
  }
  // Paper G1b: o login da conta nova também não abre dentro da linha. A linha diz onde está entrando e, clicada, reabre a
  // Nova conta no ponto em que o login está (o "já estava na lista" continua aqui, com o Fechar).
  return [...porConta.entries()].map(([k, ls]) => {
    const [ia, apelido] = k.split(":") as [IaComConta, string];
    const nome = `${PROVEDOR[ia].nome}${apelido ? ` · ${apelido}` : ""}`;
    const maqs = ls.map((l) => x.maquinas.find((m) => m.id === maquinaDoLogin(l))).filter((m): m is MaquinaDto => !!m);
    const onde = maqs.length === 1 ? nomeCurto(maqs[0]!, x.maquinas) : undefined;
    const andando = ls.some((l) => l.onde === "mac" || !FASES_FINAIS.has(l.login.fase));
    const estado = andando ? estadoDoLoginNaConta(ls.find((l) => l.onde === "mac" || !FASES_FINAIS.has(l.login.fase))!, onde ?? `${maqs.length} máquinas`).replace(/na (\d+ máquinas)/, "em $1") : estadoDosLogins(ls);
    const ja = ls.map((l) => (l.onde === "vm" && l.login.fase === "pronto" && !l.login.contaId && l.login.contaFinalId ? x.contas.contas.find((c) => c.id === l.login.contaFinalId) : undefined)).find(Boolean);
    const fechar = ja ? ls.filter((l) => l.onde === "vm" && l.login.contaFinalId === ja.id).map((l) => `<button type="button" class="ob-link" data-act="cl-login-fechar" data-login="${esc(idDoLogin(l))}">Fechar</button>`).join("") : "";
    const ident = ja ? `<span>Essa conta já estava na lista: <b>${esc(nomeDaContaNaTela(ja))}</b>.</span>` : `<span>conta nova · pelo ${esc(PROVEDOR[ia].cli)}</span>`;
    return `<li class="cl-linha cl-linha-g1 entrando"><span class="cl-alca" aria-hidden="true"></span><span class="cl-pos" aria-hidden="true">+</span>${logoDaIa(ia, "cl-logo")}<div class="cl-corpo"><div class="cl-nome"><button type="button" class="cl-nome-bt" data-act="cl-nova-retomar" data-ia="${ia}" data-apelido="${esc(apelido)}"><b>${esc(nome)}</b></button></div><div class="cl-ident">${ident}</div></div><div class="cl-uso-col"></div><div class="cl-dir">${estado}${fechar}</div><div class="cl-mais"><button type="button" class="cl-abrir-bt" data-act="cl-nova-retomar" data-ia="${ia}" data-apelido="${esc(apelido)}" aria-label="Abrir a conta nova ${esc(nome)}">${ICONE.seta}</button></div></li>`;
  }).join("");
}

/** "Um login venceu e uma máquina ainda não entrou." — o que há com as contas que precisam da pessoa. */
function motivoDosPendentes(cs: readonly ContaIa[]): string {
  const vinc = cs.flatMap((c) => c.maquinas);
  const partes = [
    vinc.some((v) => v.estado === "sem_login") ? "login vencido" : "",
    vinc.some((v) => v.estado === "sem_acesso") ? "acesso perdido" : "",
    cs.some((c) => c.maquinas.length === 0) ? "conta sem máquina" : "",
  ].filter(Boolean);
  return partes.length ? `${partes.join(", ").replace(/^./, (l) => l.toUpperCase())}.` : "";
}

export function renderListaDeContas(x: ContextoContas): string {
  const filtro = x.ui.filtro ? x.maquinas.find((m) => m.id === x.ui.filtro) ?? null : null;
  // Tela 19b do Paper: com a Nova conta aberta (e uma máquina que receba o login), a página é só ela.
  if (x.ui.nova && !filtro) { const f = formNova(x); if (f.includes('data-form="cl-nova"')) return `${f}${confirmacao(x)}`; }
  const usada = emUso(x);
  const aberta = x.ui.aberta && !filtro ? x.contas.contas.find((c) => c.id === x.ui.aberta) ?? null : null;
  if (aberta) return `${renderContaAberta(aberta, x, usada)}${confirmacao(x)}`;
  const pendentes = filtro ? [] : x.contas.contas.filter(precisaDeVoce);
  const soPendentes = !!x.ui.pendentes && pendentes.length > 0;
  const linhas = x.contas.contas.map((c, i) => (soPendentes && !precisaDeVoce(c) ? "" : linha(c, i + 1, x, usada))).join("");
  const n = x.contas.contas.length;
  const k = pendentes.length;
  const aviso = k ? `<div class="cl-aviso" role="status"><i aria-hidden="true"></i><span><b>${k === 1 ? "1 conta precisa" : `${k} contas precisam`} de você.</b> ${esc(motivoDosPendentes(pendentes))}</span><button type="button" class="ob-link" data-act="cl-pendentes" data-valor="${soPendentes ? "0" : "1"}">${soPendentes ? "Ver todas" : "Ver"}</button></div>` : "";
  const segmento = k ? `<div class="segmentado cl-seg" role="group" aria-label="Quais contas"><button type="button" class="seg${soPendentes ? "" : " ativo"}" aria-pressed="${!soPendentes}" data-act="cl-pendentes" data-valor="0">Todas · ${n}</button><button type="button" class="seg${soPendentes ? " ativo" : ""}" aria-pressed="${soPendentes}" data-act="cl-pendentes" data-valor="1">Precisam de você · ${k}</button></div>` : "";
  const abas = filtro
    ? `<div class="cl-filtro"><div class="segmentado" role="group" aria-label="Máquina">${[{ id: "", nome: "Todas as máquinas" }, ...x.maquinas.map((m) => ({ id: m.id, nome: m.plataforma === "darwin" && ehEsteMac(m, x) ? "Este Mac" : nomeCurto(m, x.maquinas) }))].map((o) => `<button type="button" class="seg${(x.ui.filtro ?? "") === o.id ? " ativo" : ""}" aria-pressed="${(x.ui.filtro ?? "") === o.id}" data-act="cl-filtro" data-maquina="${esc(o.id)}">${esc(o.nome)}</button>`).join("")}</div><button type="button" class="ob-link" data-act="secao-espaco" data-secao="maquinas">‹ Voltar para Máquinas</button></div>`
    : "";
  const vazio = n === 0 && x.ui.logins.length === 0
    ? `<div class="espaco-cartao cl-vazio"><p>Nenhuma conta de IA ainda.${x.maquinas.length === 0 ? " Conecte o app do Mac ou uma VM em Máquinas e entre numa conta nela." : " Adicione uma conta e escolha em quais máquinas entrar."}</p></div>`
    : "";
  // Jornadas da IA (Paper G1): as regras da troca recolhidas num "Como o nod troca de conta" no pé, ao lado do que chega
  // em breve; abertas, a tabela de duas colunas de sempre (não há nada para configurar) e a nota da privacidade.
  const breve = x.emBreve?.length ? `<span class="cl-pe-breve">Em breve: ${esc(emBreve(x.emBreve).replace(/ chegam? em breve$/, ""))}.</span>` : "<span></span>";
  const regras = n > 0
    ? `<details class="cl-regras-det"><summary>${breve}<span class="cl-regras-link">Como o nod troca de conta</span></summary><div class="espaco-cartao cl-regras"><b>Quando uma conta acabar</b><dl class="cl-regras-tab" aria-label="É assim que o Nod age; não há nada para configurar aqui">${REGRAS_DA_FILA.map((r) => `<dt>${esc(r.titulo)}</dt><dd>${esc(r.texto)}</dd>`).join("")}</dl><p class="contas-privado">E-mail e organização ficam só nas suas máquinas: o servidor do nod recebe o apelido, o plano e uma impressão da conta, nunca o e-mail.</p></div></details>`
    : "";
  const nota = x.ui.nota ? `<p class="cl-nota" role="status">${esc(x.ui.nota)}</p>` : "";
  return `${abas}
    ${aviso}
    ${vazio}
    ${n > 0 || x.ui.logins.length > 0 ? `<div class="prov-ordem">${segmento || `<span class="prov-ordem-titulo">${n} ${n === 1 ? "conta" : "contas"}</span>`}${filtro || x.ui.nova ? "" : `<span class="prov-ordem-acoes">${formNova(x)}</span>`}</div>
    <ol class="espaco-cartao cl-lista" data-ordem-lista="contas" aria-label="Suas contas de IA, em ordem de uso">${linhas}${loginsSemConta(x)}</ol>` : ""}
    ${nota}
    ${filtro || (!x.ui.nova && (n > 0 || x.ui.logins.length > 0)) ? "" : formNova(x)}
    ${regras}
    ${confirmacao(x)}`;
}

/**
 * As contas numa máquina, no passo "Contas" do Conectar (CMJ, 2026-10-13): cada conta da pessoa com "Entrar" (ou ✓ se
 * já está logada nela), os logins abertos e o atalho para uma conta nova direto nesta máquina.
 */
export function renderContasNaMaquina(x: ContextoContas, maquinaId: string): string {
  const m = x.maquinas.find((y) => y.id === maquinaId);
  if (!m) return "";
  const nome = nomeCurto(m, x.maquinas);
  const linhas = x.contas.contas.map((c) => {
    const pronta = prontaEm(c, maquinaId);
    const logins = x.ui.logins.filter((l) => contaDoLogin(l) === c.id && maquinaDoLogin(l) === maquinaId);
    const direita = pronta ? '<span class="contas-estado e-uso">✓ logada</span>'
      : logins.length ? '<span class="contas-estado e-disp">Entrando…</span>'
      : `<button type="button" class="bt sm" data-act="cl-entrar" data-id="${esc(c.id)}" data-maquina="${esc(maquinaId)}">Entrar</button>`;
    return `<li class="cl-linha${pronta ? "" : " fora"}">${logoDaIa(c.ia, "cl-logo")}<div class="cl-corpo"><div class="cl-nome"><b>${esc(nomeDaContaNaTela(c))}</b>${c.plano ? `<span class="cl-plano">${esc(planoNaTela(c.plano))}</span>` : ""}</div>${logins.map((l) => blocoDoLogin(l, x, c)).join("")}</div><div class="cl-dir">${direita}</div></li>`;
  }).join("");
  const novas = x.ui.logins.filter((l) => maquinaDoLogin(l) === maquinaId && (contaDoLogin(l) === null || !x.contas.contas.some((c) => c.id === contaDoLogin(l)))).map((l) => blocoDoLogin(l, x, null)).join("");
  const atalhos = (["claude-cli", "codex-cli"] as const).map((ia) => `<button type="button" class="bt sm" data-act="cl-nova-na-maquina" data-ia="${ia}" data-maquina="${esc(maquinaId)}">${logoDaIa(ia, "cl-logo mini")}Conta nova do ${esc(PROVEDOR[ia].nome)}</button>`).join("");
  return `<ol class="espaco-cartao cl-lista cl-na-maquina" aria-label="Suas contas na ${esc(nome)}">${linhas || `<li class="cl-linha cl-vazia"><span class="mudo">Você ainda não tem contas de IA. Entre na primeira aqui.</span></li>`}</ol>
    ${novas ? `<div class="cl-novas">${novas}</div>` : ""}
    <div class="cl-atalhos">${atalhos}</div>`;
}

/** O resumo das contas no cartão da máquina (G2-M1): logos, nomes e quantas ainda não estão nela. */
export function resumoDasContasNaMaquina(contas: ContasIaDto, m: MaquinaDto): string {
  const aqui = contas.contas.filter((c) => prontaEm(c, m.id));
  const faltam = contas.contas.length - aqui.length;
  const logos = aqui.slice(0, 6).map((c) => logoDaIa(c.ia, "cl-logo mini")).join("");
  const texto = aqui.length === 0
    ? "Nenhuma conta de IA aqui ainda"
    : faltam === 0 && contas.contas.length > 1 ? `${aqui.length} contas · todas as suas` : `${aqui.length} ${aqui.length === 1 ? "conta" : "contas"} · ${aqui.map(nomeDaContaNaTela).join(", ")}`;
  const aviso = aqui.length > 0 && faltam > 0 ? `<small class="cl-aviso-txt">${faltam === 1 ? "1 conta sua ainda não está aqui" : `${faltam} contas suas ainda não estão aqui`}</small>` : "";
  return `<div class="maq-contas"><span class="maq-contas-logos">${logos}</span><span class="maq-contas-txt"><span>${esc(texto)}</span>${aviso}</span><button type="button" class="ob-link" data-act="cl-gerenciar" data-maquina="${esc(m.id)}">${aqui.length === 0 ? "Entrar numa conta" : "Gerenciar contas"} ›</button></div>`;
}
