import { randomUUID } from "node:crypto";
import { FERRAMENTAS_NAVEGADOR, FERRAMENTAS_NAVEGADOR_DIRETAS, NAVEGADOR_SO_LEITURA, type NomeFerramentaNavegador } from "../../contracts/ferramentas-navegador.ts";
import type { JsonSchema } from "../../contracts/json-schema.ts";
import type { Executor } from "../../contracts/evento.ts";
import type { AbaNavegador, EntradaNavegador, GravacaoNavegador, LugarNavegador, OperacaoEnsinar, OperacaoNavegador, PassoNavegador, TarefaEnsinada, VistaNavegador } from "../../contracts/navegador-do-bot.ts";
import type { PlanoTurno } from "../../contracts/plano-turno.ts";
import { ErroDeDominio } from "../../domain/erro.ts";
import { modoNoTurno } from "../../domain/modo-aprovacao.ts";
import { motorLe, tipoDoAnexo } from "../../domain/anexo.ts";
import { classificarAcao, decidirNoNavegador, perguntaDaAcao, SEM_LIBERACOES, type AlvoResolvido, type LiberacoesNavegador } from "../../domain/navegador-aprovacao.ts";
import { entradaDigita } from "../../domain/navegador-entrada.ts";
import { arquivoDosPassos, campoDoElemento, eventoDoClique, gravar, nomeSugerido, novaGravacao, passosDaGravacao, type EventoGravado, type Gravacao } from "../../domain/navegador-ensinar.ts";
import { buscarNoCatalogo, ehDoCatalogo } from "../../domain/navegador-catalogo.ts";
import { campoEhSecreto, redigirArvore, segredoAindaNaPagina } from "../../domain/navegador-sensivel.ts";
import { botPodeAgir, deveriaPausar, fraseDoPasso, proximoControle, temChromeVivo, type OperacaoControle } from "../../domain/navegador-vista.ts";
import { log } from "../../obs/log.ts";
import type { Escopo } from "../../shared/types.ts";
import { errosDoSchema, type ResultadoChamada } from "../../use-cases/chamar-ferramenta.ts";
import { receberAnexo } from "../../use-cases/anexos.ts";
import { enviarMensagem } from "../../use-cases/enviar-mensagem.ts";
import { pedirAprovacaoComputador } from "../../use-cases/pedir-aprovacao.ts";
import { fecharComResposta, retomarComResposta } from "../../use-cases/responder-decisao.ts";
import { pedirAPessoa } from "../../use-cases/pedir-a-pessoa.ts";
import { avisarForaDoAr, type LugarDecidido } from "../../use-cases/navegador-lugar.ts";
import { registrarNegacao } from "../../use-cases/registrar-negacao.ts";
import type { Deps } from "../../use-cases/tipos.ts";
import { ehFalhaNavegador, FalhaNavegador, type AbaMotor, type MotorNavegador, type RefLida, type SessaoNavegador } from "../navegador/motor-agent-browser.ts";
import { turnoPermitido } from "./computadores.ts";

/**
 * O portão do navegador do bot (ADR-190), no molde de `computadores.chamar`: catálogo, validade do plano, parada,
 * esquema, controle, aprovação e trilha. O motor (agent-browser) fica atrás de `MotorNavegador`, um por lugar.
 *
 * definido em 2026-11-20 (ADR-190, decisão 3): a classe da ação sai do alvo que o SERVIDOR resolveu da última leitura
 * (papel e nome da referência), nunca do texto do modelo. Referência que não está na última leitura é recusada ("leia de
 * novo"); seletor CSS no clique é resolvido pelo texto do elemento na página e conta como botão (o pior caso).
 *
 * Estado em memória por bot (vista, controle, última leitura): um reinício volta tudo a "desligado" e o próximo comando
 * religa o Chrome com o perfil persistente (logins guardados).
 */
type Dentro = <T>(escopo: Escopo, fn: (d: Deps) => Promise<T>) => Promise<T>;

export type OpcoesNavegadores = {
  dentro: Dentro;
  /** O motor de cada lugar; null = o navegador não roda ali agora (as ferramentas respondem indisponível com o motivo). */
  motor(lugar: LugarNavegador, escopo: Escopo): MotorNavegador | null;
  /**
   * Onde o navegador de cada bot roda agora (ADR-190, decisão 5; `navegador-lugar` nos use-cases): decidido a cada chamada
   * do bot e a cada "ligar" da pessoa, dentro da transação dela. Ausente = sempre o nod.
   */
  lugarDe?(d: Deps, escopo: Escopo, agenteId: string): Promise<LugarDecidido>;
  /** A linha "A vm-sp estava fora do ar às HH:MM. Fiz no nod." (padrão: `avisarForaDoAr`). */
  avisarForaDoAr?(d: Deps, agenteId: string, maquina: { id: string; nome: string }): Promise<void>;
  /** Por que o motor do lugar está fora (a frase que o bot lê). */
  motivoIndisponivel?: string;
  /** O plano oferece as navegador_* (algum lugar pode rodar o Chrome: o nod, ou as máquinas pela ponte). Ausente = o motor do nod. */
  algumLugar?(): boolean;
  cifrar(s: string): string;
  decifrar(s: string): string;
  /** NOD_NAVEGADORES_MAX: Chromes vivos ao mesmo tempo no servidor (ADR-190, decisão 8; padrão 4). */
  max?: number;
  agora?: () => number;
  /** A vista de um bot mudou (estado, controle, abas, passo): o canal ao vivo manda a vista e o SSE avisa a web. */
  aoMudar?(escopo: Escopo, vista: VistaNavegador): void;
  /** O executor vivo (o da retomada do turno e da mensagem "Ensinei: …"); ausente = catcher. */
  executor?: () => Executor;
  /** Costura de teste: fecha o pedido aberto com a frase e retoma o turno (padrão: fecharComResposta + retomarComResposta). */
  retomarPedido?: (escopo: Escopo, decisaoId: string, texto: string) => Promise<void>;
  /** Costura de teste: a mensagem da pessoa com o arquivo anexado (padrão: anexo + enviarMensagem na conversa do bot). */
  mandarMensagem?: (d: Deps, p: MensagemDaPessoa) => Promise<void>;
  /** Costuras de teste: os casos de uso que criam a decisão (padrão: os reais). */
  pedirAprovacao?: typeof pedirAprovacaoComputador;
  pedirAPessoa?: typeof pedirAPessoa;
};

export type { LugarDecidido };

type Estado = {
  escopo: Escopo;
  vista: VistaNavegador;
  /** As referências da última leitura (`e3` → papel e nome). null = ainda não leu nesta página. */
  refs: Readonly<Record<string, RefLida>> | null;
  url: string;
  /** L3: a URL em que o nod pôs um segredo; enquanto a página não muda, leitura, print e eval travam. */
  urlDoSegredo: string | null;
  /** O Chrome deste bot conta no limite de vivos. */
  vivo: boolean;
  /** D0: as URLs das abas quando o Chrome pausou; `retomar` as reabre. */
  abasGuardadas: string[];
  /** T: a gravação em curso (só com a pessoa no controle) e o campo em que ela digita agora (rótulo, nunca o valor). */
  gravacao: Gravacao | null;
  parou: GravacaoNavegador["parou"];
  campo: { campo: string; protegido: boolean } | null;
  /** T: a última gravação descartada, guardada até `ate` para o Desfazer. */
  descartada: { gravacao: Gravacao; ate: number } | null;
  /** O lugar espera (Mac desligado, máquina travada): a vista mostra a causa até o lugar voltar a rodar. */
  esperando: boolean;
  /** A máquina cujo "fora do ar" já foi avisado na conversa (uma linha por queda). */
  desvioAvisado: string | null;
};

/** A mensagem que a pessoa manda ao salvar uma tarefa ensinada (T3). */
export type MensagemDaPessoa = { agenteId: string; texto: string; arquivo: { nome: string; conteudo: string } };

/** A ação pendente de aprovação, cifrada no item da decisão: roda como foi aprovada. */
type AcaoPendente = { agenteId: string; turnoId: string; ferramenta: NomeFerramentaNavegador; argumentos: Record<string, unknown> };

/** O conteúdo de uma ferramenta que rodou, antes de virar JSON. */
type Saida = { conteudo: Record<string, unknown>; imagem?: string; isError?: boolean };
type Contexto = { escopo: Escopo; plano: Pick<PlanoTurno, "turnoId" | "agenteId" | "conversaId">; est: Estado; motor: MotorNavegador; modo: "manual" | "automatico" | "total"; liberacoes: LiberacoesNavegador };

const MAX_PADRAO = 4;
/** definido em 2026-11-20 (T): o Desfazer da gravação descartada vale 10 s. */
export const DESFAZER_DESCARTE_MS = 10_000;
/** definido em 2026-11-20 (D0): reabrir mais que isto de abas ao retomar pesa mais do que ajuda. */
const ABAS_GUARDADAS_MAX = 10;
/** As frases que retomam o turno que esperava a pessoa (login, captcha, ajuda). */
const RETOMADA = {
  devolver: "Terminei no navegador e devolvi o controle. Leia a página de novo (navegador_ler) e continue.",
  resolver: "Resolvi o que você pediu no navegador. Leia a página de novo (navegador_ler) e continue.",
} as const;
const TAB_ID = /^t[1-9]\d{0,8}$/;
/** definido em 2026-11-20 (ADR-190): `navegador_rodar_script` roda até 20 passos, parando no primeiro erro. */
const PASSOS_MAX = 20;
/** definido em 2026-11-20: o resultado de `navegador_avaliar` volta com até 4000 caracteres (contrato). */
const AVALIAR_MAX = 4_000;
/** definido em 2026-11-20: o texto da página inteira cabe no orçamento do proxy, que corta e guarda o resto (ler_mais). */
const TEXTO_MAX = 200_000;
/** Resultados de ações aprovadas esperando o turno que as pediu (entregues uma vez). */
const RESULTADOS_MAX = 200;
const PAPEIS_DE_ACAO_NO_CSS = "button";

/** Ferramentas que não entram num script (nem script dentro de script). */
const FORA_DO_SCRIPT: ReadonlySet<string> = new Set(["navegador_buscar", "navegador_usar", "navegador_rodar_script", "navegador_entrar", "navegador_pedir_ajuda", "navegador_tarefa_ensinada"]);
/** ADR-166: o bot em só leitura navega e lê; o que muda a página (clicar, preencher, enviar) é negado. */
const PERMITIDAS_EM_SO_LEITURA: ReadonlySet<string> = new Set([...NAVEGADOR_SO_LEITURA, "navegador_abrir", "navegador_rolar", "navegador_historico", "navegador_abas", "navegador_usar", "navegador_entrar", "navegador_pedir_ajuda", "navegador_quadro"]);
/** O que mostra o conteúdo da página: trava com segredo na página (L3). */
const LEEM_A_PAGINA: ReadonlySet<string> = new Set(["navegador_ler", "navegador_ver", "navegador_texto", "navegador_obter", "navegador_avaliar", "navegador_estilos", "navegador_pdf"]);
/** O que pode mudar de página: as referências antigas deixam de valer. */
const NAVEGAM: ReadonlySet<string> = new Set(["navegador_abrir", "navegador_historico", "navegador_abas", "navegador_quadro"]);

/**
 * definido em 2026-11-20: o Chrome no servidor alcança a rede de dentro (o próprio nod, o metadata da nuvem). `abrir` e
 * a aba nova recusam endereço que não seja http(s) público. TODO(2026-11-20): bloquear também na rede (proxy ou
 * firewall do processo) — um link clicado ou um redirect ainda chegam à rede de dentro, e DNS que aponta para dentro
 * passa pelo nome.
 */
export function enderecoPermitido(url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!h || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || h === "metadata.google.internal") return false;
  if (h === "::1" || h === "::" || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe80:/.test(h)) return false;
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224) return false;
  }
  if (/^\d+$/.test(h)) return false;
  return true;
}

/**
 * definido em 2026-11-20: `navegador_avaliar` não lê campo protegido, cookie nem armazenamento, e não manda nada para
 * fora da página. Defesa por texto (o JS pode ofuscar): a trava de verdade é o segredo na página (L3) e o perfil cifrado.
 */
const EVAL_PROIBIDO = /cookie|localStorage|sessionStorage|indexedDB|password|senha|credential|\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|navigator\.clipboard|window\.open|\bimport\s*\(|document\.write/i;

const ehRef = (alvo: string) => /^@?e\d+$/.test(alvo.trim());
const ref = (alvo: string) => alvo.trim().replace(/^@/, "");
/** O alvo é um campo protegido: a ref da última leitura com nome de senha/cartão/código, ou um seletor que diz password. */
function alvoSecreto(est: { refs: Readonly<Record<string, RefLida>> | null }, alvo: string): boolean {
  if (!alvo) return false;
  if (!ehRef(alvo)) return /password|senha|cc-number|cc-csc|one-time-code/i.test(alvo);
  const r = est.refs?.[ref(alvo)];
  return r !== undefined && campoEhSecreto({ papel: r.papel, nome: r.nome });
}
const hostDe = (url: string) => { try { return new URL(url).hostname; } catch { return ""; } };
const obj = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function tipoDoPasso(ferramenta: string): PassoNavegador["tipo"] {
  if (ferramenta === "navegador_clicar" || ferramenta === "navegador_procurar" || ferramenta === "navegador_pixel") return "clicar";
  if (ferramenta === "navegador_preencher" || ferramenta === "navegador_digitar" || ferramenta === "navegador_tecla") return "digitar";
  if (ferramenta === "navegador_rolar") return "rolar";
  if (ferramenta === "navegador_esperar") return "esperar";
  if (ferramenta === "navegador_ler" || ferramenta === "navegador_texto" || ferramenta === "navegador_ver") return "ler";
  return "mirar";
}

const abaDaVista = (a: { id: string; titulo: string; url: string; ativa: boolean }): AbaNavegador => ({ ...a, carregando: false, inseguro: a.url.startsWith("http:") });

/** As instruções fixas que o bot lê. */
const AGUARDANDO_PESSOA = { estado: "aguardando_pessoa", instrucao: "A pessoa está com o navegador (ou ele espera um passo dela). Nada foi executado. Encerre o turno e aguarde; ela devolve e você continua." };
const NA_FILA = { estado: "na_fila", instrucao: "Os navegadores do nod estão todos em uso agora. Nada foi executado. Siga com o que dá sem o navegador e tente de novo em 30 s; não diga que o navegador quebrou." };
const SEGREDO_NA_PAGINA = { erro: "segredo_na_pagina", instrucao: "A página tem uma senha ou código que o nod preencheu; a leitura e o print ficam travados até a página mudar. Clique no botão de entrar (ou espere a página seguinte) e leia de novo." };
const PESSOA_FAZ = { erro: "a_pessoa_faz", instrucao: "Trocar senha, e-mail ou a segurança da conta é sempre a pessoa que faz. Nada foi executado. Chame navegador_pedir_ajuda com o motivo e encerre o turno." };

function instrucaoDaFalha(e: FalhaNavegador): { erro: string; detalhe: string; instrucao: string } {
  const instrucao = {
    alvo_invalido: "O alvo não existe, sumiu ou não aceita esta ação. Leia a página de novo (navegador_ler) e use uma referência da leitura nova.",
    tempo_esgotado: "O site não respondeu a tempo. Leia a página de novo antes de repetir; não afirme que a ação aconteceu.",
    acao_falhou: "A ação falhou no navegador. Leia a página de novo antes de repetir; não afirme que a ação aconteceu.",
    indisponivel: "O navegador não está disponível agora. Nada foi executado; siga com o que dá sem ele e diga em uma frase o que ficou de fora.",
  }[e.motivo];
  return { erro: e.motivo, detalhe: e.detalhe, instrucao };
}

/** O que `navegador_tarefa_ensinada` devolve: a lista (nome e quantos passos) ou os passos da tarefa pedida pelo nome. */
export function tarefasParaOBot(tarefas: readonly TarefaEnsinada[], nome: unknown): Record<string, unknown> {
  if (!tarefas.length) return { tarefas: [], instrucao: "Nenhuma tarefa foi ensinada a você no navegador ainda." };
  const pedido = typeof nome === "string" ? nome.trim().toLowerCase() : "";
  const achada = pedido ? tarefas.find((t) => t.nome.toLowerCase() === pedido) ?? tarefas.find((t) => t.nome.toLowerCase().includes(pedido)) : undefined;
  if (achada) return { nome: achada.nome, passos: achada.passos, instrucao: "Estes são os passos que a pessoa fez com as próprias mãos. Repita-os no navegador, lendo a página antes de cada passo; os campos marcados como não gravados você pede a ela (navegador_entrar ou navegador_pedir_ajuda)." };
  return { tarefas: tarefas.map((t) => ({ nome: t.nome, passos: t.passos.length })), ...(pedido ? { erro: "tarefa_inexistente" } : {}), instrucao: "Chame de novo com o nome de uma destas tarefas para ver os passos." };
}

/**
 * A mensagem da pessoa com o arquivo dos passos (T3), na conversa do bot: o anexo nasce solto e entra no envio, que
 * enfileira o turno normal do bot. O bot fixado numa IA que não lê texto recebe os passos no próprio texto.
 */
export async function mandarMensagemPadrao(d: Deps, p: MensagemDaPessoa & { executor?: Executor }): Promise<void> {
  const conversa = await d.repos.conversas.buscarPropriaDoAgente(p.agenteId);
  const agente = await d.repos.agentes.buscar(p.agenteId);
  if (!conversa || !agente) throw new ErroDeDominio("nao_encontrado", { cause: "conversa do bot" });
  const fixo = agente.harness && agente.harness !== "auto" ? agente.harness : null;
  const leTexto = !fixo || motorLe(fixo, tipoDoAnexo("text/plain"));
  const anexos = leTexto ? [(await receberAnexo(d, { conversaId: conversa.id, nome: p.arquivo.nome, mime: "text/plain", conteudo: Buffer.from(p.arquivo.conteudo, "utf8") })).data.id] : [];
  const r = await enviarMensagem(d, { conversaId: conversa.id, texto: leTexto ? p.texto : `${p.texto}\n\n${p.arquivo.conteudo}`, anexos, ...(p.executor ? { executor: p.executor } : {}) });
  if (r.events?.length) await d.repos.events.gravarComOutbox(r.events);
}

export function criarNavegadores(o: OpcoesNavegadores) {
  const agora = o.agora ?? (() => Date.now());
  const max = Math.max(1, o.max ?? MAX_PADRAO);
  const aprovar = o.pedirAprovacao ?? pedirAprovacaoComputador;
  const perguntar = o.pedirAPessoa ?? pedirAPessoa;
  const estados = new Map<string, Estado>();
  const resultados = new Map<string, { pessoaId: string; cifrado: string }>();

  const motorDe = (est: Estado): MotorNavegador | null => o.motor(est.vista.lugar, est.escopo);
  const sessao = (agenteId: string): SessaoNavegador => ({ agenteId });

  function estadoDe(escopo: Escopo, agenteId: string): Estado {
    const e = estados.get(agenteId);
    if (e) {
      if (e.escopo.pessoaId !== escopo.pessoaId || e.escopo.tenantId !== escopo.tenantId) throw new ErroDeDominio("nao_permitido");
      return e;
    }
    const novo: Estado = {
      escopo: { tenantId: escopo.tenantId, pessoaId: escopo.pessoaId }, refs: null, url: "", urlDoSegredo: null, vivo: false,
      abasGuardadas: [], gravacao: null, parou: null, campo: null, descartada: null, esperando: false, desvioAvisado: null,
      vista: { agenteId, estado: "desligado", controle: "bot", lugar: { tipo: "nod" }, abas: [], aviso: null, passo: null, pedido: null, gravacao: null, descarte: null, segredoNaPagina: false, atividadeEm: agora(), erro: null, viewport: { w: 1280, h: 720 } },
    };
    estados.set(agenteId, novo);
    return novo;
  }

  function mudar(est: Estado, parcial: Partial<VistaNavegador>): void {
    // O aviso de Desfazer some sozinho na próxima mudança depois do prazo.
    const descarte = est.descartada && est.descartada.ate < agora() ? { descarte: null } : {};
    if ("descarte" in descarte) est.descartada = null;
    est.vista = { ...est.vista, ...descarte, ...parcial };
    try { o.aoMudar?.(est.escopo, est.vista); } catch (e) { log("aviso", "navegador_aviso_falhou", { erro: e instanceof Error ? e.name : "desconhecido" }); }
  }

  /** Fecha os Chromes parados há 10 min (D0): a vista fica "em pausa" e o perfil guarda os logins. */
  async function pausarOciosos(): Promise<number> {
    let pausados = 0;
    for (const est of estados.values()) {
      if (!est.vivo || !deveriaPausar(est.vista, agora())) continue;
      const motor = motorDe(est);
      const abas = await motor?.abas(sessao(est.vista.agenteId)).catch(() => null);
      est.abasGuardadas = (abas ?? est.vista.abas).map((a) => a.url).filter(enderecoPermitido).slice(0, ABAS_GUARDADAS_MAX);
      est.vivo = false;
      est.refs = null;
      pausados++;
      await motor?.fechar(sessao(est.vista.agenteId)).catch((e: unknown) => log("aviso", "navegador_pausar_falhou", { agente_id: est.vista.agenteId, erro: e instanceof Error ? e.name : "desconhecido" }));
      mudar(est, { estado: "pausa", passo: null });
    }
    return pausados;
  }

  /** O Chrome do bot conta no limite; sem vaga, o bot espera na fila (ADR-190, decisão 8). Só o lugar "nod" tem limite. */
  async function vaga(est: Estado): Promise<boolean> {
    if (est.vivo) return true;
    if (est.vista.lugar.tipo === "nod") {
      const vivos = () => [...estados.values()].filter((e) => e.vivo && e.vista.lugar.tipo === "nod").length;
      if (vivos() >= max) await pausarOciosos();
      if (vivos() >= max) return false;
    }
    est.vivo = true;
    mudar(est, { estado: "ligando", erro: null });
    return true;
  }

  const resposta = (conteudo: unknown, isError = false): ResultadoChamada => ({ ok: true, conteudo: JSON.stringify(conteudo), confianca: "nao_confiavel", ...(isError ? { isError: true } : {}) });

  /** A referência tem de estar na última leitura; o resto (seletor CSS) segue. */
  function conferirRef(est: Estado, alvo: unknown): void {
    if (typeof alvo !== "string" || !ehRef(alvo)) return;
    if (!est.refs || !Object.hasOwn(est.refs, ref(alvo))) throw new FalhaNavegador("alvo_invalido", `A referência @${ref(alvo)} não está na última leitura desta página. Leia de novo (navegador_ler) e use uma referência da leitura nova.`);
  }

  /** O alvo como o servidor o conhece (para classificar): ref → da leitura; seletor → texto do elemento na página. */
  async function resolverAlvo(c: Contexto, ferramenta: string, args: Record<string, unknown>): Promise<AlvoResolvido | null> {
    const host = hostDe(c.est.url);
    if (ferramenta === "navegador_procurar") {
      if (args.acao !== "clicar") return null;
      const papel = args.por === "papel" ? String(args.valor) : PAPEIS_DE_ACAO_NO_CSS;
      const nome = typeof args.nome === "string" ? args.nome : args.por === "papel" ? "" : String(args.valor);
      return { papel, nome, host };
    }
    if (ferramenta === "navegador_tecla") {
      if (typeof args.tecla !== "string" || !/^(enter|space| )$/i.test(args.tecla)) return null;
      const f = await c.motor.focado(sessao(c.plano.agenteId));
      return f ? { ...f, host } : null;
    }
    if (ferramenta !== "navegador_clicar" || typeof args.alvo !== "string") return null;
    if (ehRef(args.alvo)) {
      const r = c.est.refs?.[ref(args.alvo)];
      return r ? { ...r, host } : null;
    }
    const nome = await c.motor.texto(sessao(c.plano.agenteId), args.alvo).catch(() => "");
    return { papel: PAPEIS_DE_ACAO_NO_CSS, nome: nome.slice(0, 200), host };
  }

  /** Confere o segredo na página contra a URL de agora; a URL mudou, a trava sai. */
  async function segredoTrava(c: Contexto): Promise<boolean> {
    if (!c.est.urlDoSegredo) return false;
    const url = await c.motor.url(sessao(c.plano.agenteId)).catch(() => c.est.url);
    c.est.url = url;
    if (segredoAindaNaPagina(c.est.urlDoSegredo, url)) return true;
    c.est.urlDoSegredo = null;
    mudar(c.est, { segredoNaPagina: false });
    return false;
  }

  async function atualizarAbasDe(est: Estado, motor: MotorNavegador): Promise<void> {
    const abas = await motor.abas(sessao(est.vista.agenteId)).catch(() => null);
    if (abas) aplicarAbas(est, abas);
  }
  const atualizarAbas = (c: Contexto) => atualizarAbasDe(c.est, c.motor);

  /**
   * As abas de agora (do motor ou do stream ao vivo): a URL ativa mudou, as referências e o segredo na página caem (L3) e,
   * gravando, a página nova vira "Abriu …". Só avisa a web se algo mudou.
   */
  function aplicarAbas(est: Estado, abas: readonly AbaMotor[]): void {
    const ativa = abas.find((a) => a.ativa);
    if (ativa && ativa.url !== est.url) {
      est.url = ativa.url;
      est.refs = null;
      est.campo = null;
      if (est.urlDoSegredo && !segredoAindaNaPagina(est.urlDoSegredo, ativa.url)) { est.urlDoSegredo = null; mudar(est, { segredoNaPagina: false }); }
      if (/^https?:/i.test(ativa.url)) registrar(est, { tipo: "abriu", url: ativa.url });
    }
    const novas = abas.map(abaDaVista);
    if (JSON.stringify(novas) !== JSON.stringify(est.vista.abas)) mudar(est, { abas: novas });
  }

  const vistaDaGravacao = (est: Estado): GravacaoNavegador | null => (est.gravacao ? { desde: est.gravacao.desde, passos: passosDaGravacao(est.gravacao), parou: est.parou } : null);

  /** Um passo da gravação, só com a pessoa no controle (T). Igual ao anterior (o mesmo campo, a mesma página) não muda nada. */
  function registrar(est: Estado, e: EventoGravado): void {
    if (!est.gravacao || est.vista.controle !== "pessoa") return;
    const r = gravar(est.gravacao, e, agora());
    if (r.gravacao === est.gravacao && r.parou === est.parou) return;
    est.gravacao = r.gravacao;
    est.parou = r.parou ?? est.parou;
    mudar(est, { gravacao: vistaDaGravacao(est) });
  }

  /** Devolver no meio (ou Descartar) joga a gravação fora, mas a guarda 10 s para o Desfazer. */
  function descartarGravacao(est: Estado): void {
    if (!est.gravacao) return;
    const ate = agora() + DESFAZER_DESCARTE_MS;
    est.descartada = { gravacao: est.gravacao, ate };
    const passos = est.gravacao.eventos.length;
    est.gravacao = null;
    est.parou = null;
    est.campo = null;
    mudar(est, { gravacao: null, descarte: { passos, ate } });
  }

  /** As rotas da pessoa e o canal ao vivo: o bot tem de ser dela (o estado em memória não basta para quem chega primeiro). */
  async function conferirDona(escopo: Escopo, agenteId: string): Promise<void> {
    const agente = await o.dentro(escopo, (d) => d.repos.agentes.buscar(agenteId));
    if (!agente || agente.ownerId !== escopo.pessoaId) throw new ErroDeDominio("nao_encontrado");
  }

  /** O que só a pessoa no controle faz (a barra de endereço, as abas, recarregar). */
  function exigirPessoa(est: Estado): MotorNavegador {
    if (est.vista.controle !== "pessoa") throw new ErroDeDominio("estado_invalido", { cause: "assuma_primeiro" });
    const motor = motorDe(est);
    if (!motor) throw new ErroDeDominio("estado_invalido", { cause: "indisponivel" });
    if (!est.vivo) throw new ErroDeDominio("estado_invalido", { cause: "desligado" });
    return motor;
  }

  /**
   * O lugar de agora (ADR-190, decisão 5), decidido dentro da transação de quem pede. Mudou: o Chrome do lugar velho fecha
   * (as abas ficam guardadas para o novo) — menos com a pessoa no controle, que não perde o navegador no meio. Espera: a
   * vista mostra a causa ("Seu Mac está desligado") até voltar a rodar. Desvio (a máquina fora do ar, roda no nod): a
   * conversa ganha a linha uma vez por queda.
   */
  async function decidirLugar(d: Deps, est: Estado): Promise<LugarDecidido> {
    const agenteId = est.vista.agenteId;
    const decidido: LugarDecidido = o.lugarDe ? await o.lugarDe(d, est.escopo, agenteId) : { tipo: "roda", lugar: { tipo: "nod" }, desvio: null };
    if (decidido.tipo === "espera") {
      if (est.vista.controle === "pessoa" && est.vivo) return decidido;
      await soltarChrome(est);
      est.esperando = true;
      mudar(est, { estado: "erro", erro: { causa: decidido.causa, em: agora() }, passo: null, abas: [] });
      return decidido;
    }
    if (JSON.stringify(decidido.lugar) !== JSON.stringify(est.vista.lugar)) {
      if (est.vivo && est.vista.controle === "pessoa") return { tipo: "roda", lugar: est.vista.lugar, desvio: null };
      await soltarChrome(est);
      mudar(est, { lugar: decidido.lugar, abas: [], ...(est.vista.estado === "erro" || temChromeVivo(est.vista.estado) ? { estado: "desligado", erro: null } : {}) });
    }
    if (est.esperando) {
      est.esperando = false;
      mudar(est, { estado: est.vivo ? "ao_vivo" : "desligado", erro: null });
    }
    if (!decidido.desvio) est.desvioAvisado = null;
    else if (est.desvioAvisado !== decidido.desvio.maquinaId) {
      est.desvioAvisado = decidido.desvio.maquinaId;
      await (o.avisarForaDoAr ?? avisarForaDoAr)(d, agenteId, { id: decidido.desvio.maquinaId, nome: decidido.desvio.nome })
        .catch((e: unknown) => log("aviso", "navegador_aviso_fora_do_ar_falhou", { agente_id: agenteId, erro: e instanceof Error ? e.name : "desconhecido" }));
    }
    return decidido;
  }

  /** Fecha o Chrome do lugar de agora guardando as abas (o lugar mudou ou espera). */
  async function soltarChrome(est: Estado): Promise<void> {
    if (!est.vivo) return;
    const motor = motorDe(est);
    const s = sessao(est.vista.agenteId);
    const abas = est.vista.abas.map((a) => a.url).filter(enderecoPermitido);
    if (abas.length) est.abasGuardadas = abas.slice(0, ABAS_GUARDADAS_MAX);
    est.vivo = false;
    est.refs = null;
    await motor?.fechar(s).catch((e: unknown) => log("aviso", "navegador_trocar_lugar_falhou", { agente_id: est.vista.agenteId, erro: e instanceof Error ? e.name : "desconhecido" }));
  }

  /** Liga o Chrome (ou o reabre da pausa com as abas guardadas). */
  async function ligar(est: Estado): Promise<void> {
    const motor = motorDe(est);
    if (!motor) throw new ErroDeDominio("estado_invalido", { cause: "indisponivel" });
    if (est.vivo && est.vista.estado !== "erro") return;
    if (!(await vaga(est))) throw new ErroDeDominio("estado_invalido", { cause: "na_fila" });
    const s = sessao(est.vista.agenteId);
    const [primeira, ...outras] = est.abasGuardadas;
    try {
      await motor.abrir(s, primeira ?? "about:blank");
      for (const url of outras) await motor.abaNova(s, url);
    } catch (e) {
      est.vivo = false;
      mudar(est, { estado: "erro", erro: { causa: ehFalhaNavegador(e) ? e.detalhe : "o navegador não abriu", em: agora() } });
      throw new ErroDeDominio("estado_invalido", { cause: "nao_ligou" });
    }
    est.abasGuardadas = [];
    est.refs = null;
    await atualizarAbasDe(est, motor);
    mudar(est, { estado: "ao_vivo", erro: null, passo: null, atividadeEm: agora() });
  }

  /** Devolver/resolver fecham o pedido aberto (login, ajuda) com a frase e retomam o turno que esperava (molde do computador). */
  async function retomarDoPedido(escopo: Escopo, decisaoId: string, texto: string): Promise<void> {
    await o.dentro(escopo, async (d) => {
      const decisao = await d.repos.decisoes.buscar(decisaoId);
      if (!decisao || (decisao.estado !== "pendente" && decisao.estado !== "reaberta")) return;
      const r = await fecharComResposta(d, { decisaoId, texto });
      if (r.events?.length) await d.repos.events.gravarComOutbox(r.events);
      const retomada = await retomarComResposta(d, { decisao: r.data.decisao, texto, respondidaPor: { id: escopo.pessoaId, nome: "A pessoa" }, executor: o.executor?.() ?? "catcher" });
      if (retomada.events?.length) await d.repos.events.gravarComOutbox(retomada.events);
    });
  }

  /** O efeito de uma ferramenta já aprovada (ou que não pede): fala com o motor e devolve o que o bot lê. */
  async function efeito(c: Contexto, ferramenta: NomeFerramentaNavegador, args: Record<string, unknown>): Promise<Saida> {
    const s = sessao(c.plano.agenteId);
    const m = c.motor;
    const alvo = typeof args.alvo === "string" ? args.alvo : "";
    for (const chave of ["alvo", "de", "para"]) conferirRef(c.est, args[chave]);
    if (LEEM_A_PAGINA.has(ferramenta) && (await segredoTrava(c))) return { conteudo: SEGREDO_NA_PAGINA, isError: true };
    switch (ferramenta) {
      case "navegador_abrir": {
        const url = String(args.url);
        if (!enderecoPermitido(url)) return { conteudo: { erro: "endereco_recusado", instrucao: "Só endereços http(s) da internet abrem no navegador do bot (nada de localhost, rede interna ou file:)." }, isError: true };
        const r = await m.abrir(s, url, args.nova_aba === true);
        c.est.url = r.url;
        await atualizarAbas(c);
        return { conteudo: { ok: true, url: r.url, titulo: r.titulo, instrucao: "Leia a página (navegador_ler) antes de agir." } };
      }
      case "navegador_ler": {
        const l = await m.ler(s, { soInterativos: args.so_interativos !== false, ...(typeof args.dentro === "string" && args.dentro ? { dentro: args.dentro } : {}) });
        c.est.refs = l.refs;
        if (l.url) c.est.url = l.url;
        return { conteudo: { url: l.url || c.est.url, referencias: Object.keys(l.refs).length, arvore: redigirArvore(l.arvore) } };
      }
      case "navegador_clicar": await m.clicar(s, alvo, args.duplo === true); break;
      case "navegador_preencher":
      case "navegador_digitar": {
        if (alvoSecreto(c.est, alvo)) return { conteudo: { erro: "campo_protegido", instrucao: "Este campo é de senha, código ou cartão: você nunca o preenche. Use navegador_entrar (login) ou navegador_pedir_ajuda (código, cartão)." }, isError: true };
        if (ferramenta === "navegador_preencher") await m.preencher(s, alvo, String(args.texto ?? ""));
        else await m.digitar(s, alvo, String(args.texto ?? ""));
        break;
      }
      case "navegador_tecla": await m.tecla(s, String(args.tecla)); break;
      case "navegador_rolar": await m.rolar(s, { ...(typeof args.direcao === "string" ? { direcao: args.direcao as "cima" } : {}), ...(typeof args.pixels === "number" ? { pixels: args.pixels } : {}), ...(alvo ? { alvo } : {}) }); break;
      case "navegador_esperar": await m.esperar(s, { ...(alvo ? { alvo } : {}), ...(typeof args.texto === "string" ? { texto: args.texto } : {}), ...(typeof args.ms === "number" ? { ms: args.ms } : {}) }); break;
      case "navegador_ver": {
        const p = await m.print(s, { paginaInteira: args.pagina_inteira === true });
        return { conteudo: { ok: true, url: c.est.url }, imagem: p.jpeg };
      }
      case "navegador_texto": {
        const t = await m.texto(s, alvo || undefined);
        return { conteudo: { url: c.est.url, texto: t.slice(0, TEXTO_MAX), ...(t.length > TEXTO_MAX ? { cortado: true } : {}) } };
      }
      case "navegador_obter":
        // O valor de um campo protegido nunca volta ao modelo (L3), nem pelo atributo nem pelo HTML.
        if (args.o_que !== "url" && args.o_que !== "titulo" && args.o_que !== "quantos" && args.o_que !== "caixa" && alvoSecreto(c.est, alvo)) return { conteudo: { erro: "campo_protegido", instrucao: "Este campo é de senha, código ou cartão: o valor dele não volta para você." }, isError: true };
        return { conteudo: { o_que: args.o_que, valor: await m.obter(s, args.o_que as "url", alvo || undefined, typeof args.nome === "string" ? args.nome : undefined) } };
      case "navegador_estilos": return { conteudo: { estilos: await m.estilos(s, alvo) } };
      case "navegador_selecionar": await m.selecionar(s, alvo, (args.opcoes as string[]) ?? []); break;
      case "navegador_marcar": await m.marcar(s, alvo, args.marcado === true); break;
      case "navegador_passar_mouse": await m.passarMouse(s, alvo); break;
      case "navegador_arrastar": await m.arrastar(s, String(args.de), String(args.para)); break;
      case "navegador_pixel": await m.mouse(s, { acao: args.acao as "clicar", x: Number(args.x), y: Number(args.y), ...(typeof args.delta === "number" ? { delta: args.delta } : {}) }); break;
      case "navegador_historico": await m.historico(s, args.acao as "voltar"); break;
      case "navegador_abas": {
        const abas = await m.abas(s);
        const n = typeof args.aba === "number" ? abas[args.aba - 1] : undefined;
        if ((args.acao === "trocar" || (args.acao === "fechar" && args.aba !== undefined)) && !n) return { conteudo: { erro: "aba_inexistente", abas: abas.map((a, i) => ({ aba: i + 1, titulo: a.titulo, url: a.url, ativa: a.ativa })), instrucao: "Use o número de uma aba desta lista." }, isError: true };
        if (args.acao === "nova") {
          const url = typeof args.url === "string" && args.url ? args.url : undefined;
          if (url && !enderecoPermitido(url)) return { conteudo: { erro: "endereco_recusado", instrucao: "Só endereços http(s) da internet abrem no navegador do bot." }, isError: true };
          await m.abaNova(s, url);
        } else if (args.acao === "trocar" && n) await m.abaTrocar(s, n.id);
        else if (args.acao === "fechar") await m.abaFechar(s, n?.id);
        await atualizarAbas(c);
        return { conteudo: { abas: c.est.vista.abas.map((a, i) => ({ aba: i + 1, titulo: a.titulo, url: a.url, ativa: a.ativa })) } };
      }
      case "navegador_quadro": await m.quadro(s, args.principal === true || !alvo ? null : alvo); break;
      case "navegador_dialogo": await m.dialogo(s, args.aceitar === true, typeof args.texto === "string" ? args.texto : undefined); break;
      case "navegador_baixar": {
        const r = await m.baixar(s, alvo, typeof args.nome === "string" && args.nome ? args.nome : `download-${agora()}`);
        // TODO(2026-11-20): levar o arquivo aos Arquivos do bot (hoje fica na pasta do navegador no servidor).
        return { conteudo: { ok: true, arquivo: r.nome, bytes: r.bytes } };
      }
      case "navegador_enviar_arquivo": await m.enviarArquivo(s, alvo, (args.arquivos as string[]) ?? []); break;
      case "navegador_pdf": {
        const r = await m.pdf(s, typeof args.nome === "string" && args.nome ? args.nome : `pagina-${agora()}`);
        return { conteudo: { ok: true, arquivo: r.nome, bytes: r.bytes } };
      }
      case "navegador_procurar": await m.procurar(s, { por: args.por as "texto", valor: String(args.valor), acao: args.acao as "clicar", ...(typeof args.texto === "string" ? { texto: args.texto } : {}), ...(typeof args.nome === "string" ? { nome: args.nome } : {}) }); break;
      case "navegador_avaliar": {
        const expressao = String(args.expressao);
        if (EVAL_PROIBIDO.test(expressao)) return { conteudo: { erro: "expressao_recusada", instrucao: "navegador_avaliar não lê cookies, armazenamento nem campos protegidos, e não manda nada para fora da página. Use navegador_texto ou navegador_obter." }, isError: true };
        const r = JSON.stringify(await m.avaliar(s, expressao)) ?? "undefined";
        return { conteudo: { resultado: r.slice(0, AVALIAR_MAX), ...(r.length > AVALIAR_MAX ? { cortado: true } : {}) } };
      }
      default:
        throw new FalhaNavegador("acao_falhou", `ferramenta ${ferramenta} não roda aqui`);
    }
    if (NAVEGAM.has(ferramenta)) {
      c.est.refs = null;
      await atualizarAbas(c);
    } else {
      // Clicar ou apertar uma tecla pode navegar: a URL de agora diz se as referências ainda valem.
      const url = await m.url(s).catch(() => c.est.url);
      if (url !== c.est.url) { c.est.refs = null; c.est.url = url; }
    }
    return { conteudo: { ok: true, url: c.est.url, ...(c.est.refs ? {} : { instrucao: "A página mudou: leia de novo (navegador_ler) antes do próximo passo." }) } };
  }

  /** A vista acompanha o passo: a frase da linha de atividade e "ao vivo"; a falha deixa a vista viva. */
  async function comPasso<T>(c: Contexto, ferramenta: string, alvo: AlvoResolvido | null, fn: () => Promise<T>): Promise<T> {
    mudar(c.est, { passo: { tipo: tipoDoPasso(ferramenta), frase: fraseDoPasso(ferramenta, alvo?.nome ?? null, hostDe(c.est.url) || null), caixa: null, em: agora() }, atividadeEm: agora() });
    try {
      return await fn();
    } catch (e) {
      if (ehFalhaNavegador(e) && e.motivo === "indisponivel") { c.est.vivo = false; mudar(c.est, { estado: "erro", erro: { causa: e.detalhe, em: agora() } }); }
      throw e;
    } finally {
      if (c.est.vivo) mudar(c.est, { estado: "ao_vivo", passo: null, atividadeEm: agora() });
    }
  }

  type Desfecho = { saida: Saida } | { aguardar: string } | { recusa: Record<string, unknown> };

  /** O portão de UMA ação: alvo resolvido → classe → modo → efeito, pedido de aprovação ou "a pessoa faz". */
  async function passo(c: Contexto, ferramenta: NomeFerramentaNavegador, args: Record<string, unknown>): Promise<Desfecho> {
    for (const chave of ["alvo", "de", "para"]) conferirRef(c.est, args[chave]);
    const alvo = await resolverAlvo(c, ferramenta, args);
    const classe = classificarAcao({ ferramenta, alvo, ...(typeof args.tecla === "string" ? { tecla: args.tecla } : {}) });
    const host = hostDe(c.est.url);
    // TODO(2026-11-20): o revisor do Automático (ADR-115) para envios; por ora o automático passa como sem revisor. As
    // liberações de antemão (A2/A3) vêm de navegador_preferencias (0180); o destino do envio ainda não é resolvido.
    const d = decidirNoNavegador({ modo: c.modo, classe, host, rotulo: alvo?.nome ?? "", destino: null, liberacoes: c.liberacoes, revisorLigado: false });
    if (d.tipo === "pessoa_faz") return { recusa: PESSOA_FAZ };
    if (d.tipo === "pede") {
      const pergunta = perguntaDaAcao(d.classe, alvo?.nome ?? ferramenta, host);
      const acao: AcaoPendente = { agenteId: c.plano.agenteId, turnoId: c.plano.turnoId, ferramenta, argumentos: args };
      const r = await o.dentro(c.escopo, async (dd) => {
        const pedido = await aprovar(dd, { turnoId: c.plano.turnoId, agenteId: c.plano.agenteId, conversaId: c.plano.conversaId, resumo: "Ação no navegador do bot", itens: [{ texto: pergunta, destino: { conector: "navegador", ferramenta: "executar", argumentos: { acaoId: randomUUID(), acao: o.cifrar(JSON.stringify(acao)) } } }] });
        if (pedido.events?.length) await dd.repos.events.gravarComOutbox(pedido.events);
        return pedido.data;
      });
      if (r.estado === "recusada") return { recusa: { erro: "recusada", erros: r.erros, instrucao: r.instrucao } };
      if (r.estado !== "pendente") throw new ErroDeDominio("estado_invalido");
      // TODO(2026-11-20): pagar pede Touch ID (ADR-177, d.touchId); o cartão ainda é o de aprovação comum.
      mudar(c.est, { controle: "precisa_de_voce", pedido: { tipo: "aprovacao", decisaoId: r.decisao_id, pergunta, botao: (alvo?.nome ?? "").slice(0, 80), touchId: d.touchId } });
      return { aguardar: r.decisao_id };
    }
    return { saida: await comPasso(c, ferramenta, alvo, () => efeito(c, ferramenta, args)) };
  }

  const comoResultado = (d: Desfecho): ResultadoChamada => {
    if ("aguardar" in d) return { aguardar: d.aguardar };
    if ("recusa" in d) return resposta(d.recusa, true);
    return { ...resposta(d.saida.conteudo, d.saida.isError === true), ...(d.saida.imagem ? { imagem: { mimeType: "image/jpeg" as const, data: d.saida.imagem } } : {}) };
  };

  /** Um script: cada passo pelo mesmo portão; para no primeiro erro ou no primeiro que pede a pessoa. */
  async function script(c: Contexto, passos: readonly unknown[]): Promise<ResultadoChamada> {
    const feitos: Record<string, unknown>[] = [];
    for (const [i, cru] of passos.slice(0, PASSOS_MAX).entries()) {
      const p = obj(cru);
      const nome = typeof p.ferramenta === "string" ? p.ferramenta : "";
      const args = obj(p.argumentos);
      const schema = (FERRAMENTAS_NAVEGADOR as Record<string, JsonSchema | undefined>)[nome];
      const erros = !schema || FORA_DO_SCRIPT.has(nome) ? [`passo ${i + 1}: ${nome || "(sem ferramenta)"} não roda num script`] : errosDoSchema(schema, args, `passo ${i + 1}`);
      if (erros.length) return resposta({ passos: feitos, parou_em: i + 1, erros, instrucao: "Corrija o passo e rode de novo a partir dele." }, true);
      let d: Desfecho;
      try { d = await passo(c, nome as NomeFerramentaNavegador, args); } catch (e) {
        if (!ehFalhaNavegador(e)) throw e;
        return resposta({ passos: feitos, parou_em: i + 1, ...instrucaoDaFalha(e) }, true);
      }
      if ("aguardar" in d) return { aguardar: d.aguardar };
      if ("recusa" in d) return resposta({ passos: feitos, parou_em: i + 1, ...d.recusa }, true);
      feitos.push({ passo: i + 1, ferramenta: nome, ...d.saida.conteudo });
      if (d.saida.isError) return resposta({ passos: feitos, parou_em: i + 1 }, true);
    }
    return resposta({ ok: true, passos: feitos });
  }

  /** O pedido aberto para a pessoa já foi respondido (ou venceu): o controle volta ao bot. */
  async function pedidoResolvido(d: Deps, est: Estado): Promise<boolean> {
    if (est.vista.controle !== "precisa_de_voce" || !est.vista.pedido) return false;
    const decisao = await d.repos.decisoes.buscar(est.vista.pedido.decisaoId);
    return !decisao || (decisao.estado !== "pendente" && decisao.estado !== "reaberta");
  }

  return {
    /** NOD_NAVEGADOR_NO_SERVIDOR=1: o plano oferece as ferramentas (ADR-190, decisão 8). */
    /**
     * Sem argumentos (o plano): algum lugar pode rodar o navegador (`algumLugar`; padrão, o motor do nod). Com o lugar e o
     * escopo (a tela): aquele lugar tem motor agora.
     */
    disponivel: (lugar?: LugarNavegador, escopo?: Escopo) => (lugar && escopo ? o.motor(lugar, escopo) !== null : o.algumLugar?.() ?? o.motor({ tipo: "nod" }, { tenantId: "", pessoaId: "" }) !== null),
    async chamar(escopo: Escopo, plano: PlanoTurno, nome: string, argumentos: unknown): Promise<ResultadoChamada> {
      const args = obj(argumentos);
      const r = await o.dentro(escopo, async (d): Promise<ResultadoChamada | Contexto & { ferramenta: NomeFerramentaNavegador; args: Record<string, unknown> }> => {
        const negar = async (motivo: "parada_ativa" | "fora_do_catalogo" | "args_invalidos" | "capacidade_desligada" | "plano_expirado") => {
          const n = await registrarNegacao(d, { turnoId: plano.turnoId, agenteId: plano.agenteId, conversaId: plano.conversaId, nome, motivo, classe: "ferramenta_negada", autoria: plano.autoria });
          if (n.events?.length) await d.repos.events.gravarComOutbox(n.events);
          return { ok: false as const, negacao: n.data };
        };
        if (plano.tenantId !== escopo.tenantId || plano.autoria.conta_de_execucao !== escopo.pessoaId || !plano.catalogo.ferramentas.some((f) => f.nome === nome && f.origem === "navegador")) return negar("fora_do_catalogo");
        if (plano.expiraEm <= d.agora()) return negar("plano_expirado");
        if (!await turnoPermitido(d, plano.turnoId, plano.agenteId)) return negar("parada_ativa");
        const schema = (FERRAMENTAS_NAVEGADOR_DIRETAS as Record<string, JsonSchema | undefined>)[nome];
        if (!schema || errosDoSchema(schema, argumentos).length) return negar("args_invalidos");
        if (nome === "navegador_buscar") {
          const b = buscarNoCatalogo(String(args.busca));
          return { ok: true, conteudo: JSON.stringify({ ferramentas: b.resultados, ...(b.resultados.length ? {} : { todas: b.todos }), instrucao: "Chame com navegador_usar {ferramenta, argumentos}." }), confianca: "confiavel" };
        }
        let ferramenta = nome as NomeFerramentaNavegador;
        let argsDaFerramenta = args;
        if (nome === "navegador_usar") {
          const alvo = String(args.ferramenta);
          argsDaFerramenta = obj(args.argumentos);
          if (!ehDoCatalogo(alvo) || errosDoSchema(FERRAMENTAS_NAVEGADOR[alvo], argsDaFerramenta).length) return negar("args_invalidos");
          ferramenta = alvo;
        }
        // Os passos levam nomes de botão e de página tirados do site: voltam não confiáveis, como a leitura (ADR-026).
        if (ferramenta === "navegador_tarefa_ensinada") return { ok: true, conteudo: JSON.stringify(tarefasParaOBot(await d.repos.navegadorTarefas.doAgente(plano.agenteId), argsDaFerramenta.nome)), confianca: "nao_confiavel" };
        const est = estadoDe(escopo, plano.agenteId);
        const lugar = await decidirLugar(d, est);
        if (lugar.tipo === "espera") return { ok: true, isError: true, conteudo: JSON.stringify({ erro: "espera", instrucao: lugar.instrucao }), confianca: "confiavel" };
        const motor = motorDe(est);
        if (!motor) return { ok: true, isError: true, conteudo: JSON.stringify({ erro: "indisponivel", instrucao: `${o.motivoIndisponivel ?? "O navegador do bot não está ligado neste servidor."} Nada foi executado; siga com o que dá sem ele e diga em uma frase o que ficou de fora.` }), confianca: "confiavel" };
        const agente = await d.repos.agentes.buscar(plano.agenteId);
        if (agente?.soLeitura === true && !PERMITIDAS_EM_SO_LEITURA.has(ferramenta)) return negar("capacidade_desligada");
        if (await pedidoResolvido(d, est)) mudar(est, { controle: "bot", pedido: null });
        if (!botPodeAgir(est.vista.controle)) return { ok: true, conteudo: JSON.stringify(AGUARDANDO_PESSOA), confianca: "confiavel" };
        if (ferramenta === "navegador_pedir_ajuda" || ferramenta === "navegador_entrar") {
          const login = ferramenta === "navegador_entrar";
          const motivo = String(args.motivo).slice(0, 300);
          const site = String(args.site ?? "").slice(0, 300);
          // TODO(2026-11-20): o cartão de login (L) com o item do cofre que casa com o site; por ora a pessoa entra ela mesma.
          const texto = login
            ? `Preciso que você entre em ${site} no meu navegador para eu continuar: ${motivo}. A senha não passa por mim.`
            : `Preciso de você no meu navegador: ${motivo}`;
          const p = await perguntar(d, { turnoId: plano.turnoId, agenteId: plano.agenteId, conversaId: plano.conversaId, tipo: "pergunta", texto });
          if (p.events?.length) await d.repos.events.gravarComOutbox(p.events);
          mudar(est, { controle: "precisa_de_voce", passo: null, pedido: login ? { tipo: "login", decisaoId: p.data.decisao_id, site, motivo } : { tipo: "ajuda", decisaoId: p.data.decisao_id, motivo } });
          return { ok: true, conteudo: JSON.stringify(p.data), confianca: "confiavel" };
        }
        const modo = modoNoTurno(agente?.modoAprovacao, plano.autoria) ?? "manual";
        const liberacoes = await d.repos.navegadorPreferencias.liberacoes(plano.agenteId);
        return { escopo, plano, est, motor, modo, liberacoes, ferramenta, args: argsDaFerramenta };
      });
      if (!("est" in r)) return r;
      if (!(await vaga(r.est))) return { ok: true, conteudo: JSON.stringify(NA_FILA), confianca: "confiavel" };
      try {
        if (r.ferramenta === "navegador_rodar_script") return await script(r, Array.isArray(r.args.passos) ? r.args.passos : []);
        return comoResultado(await passo(r, r.ferramenta, r.args));
      } catch (e) {
        if (ehFalhaNavegador(e)) return resposta(instrucaoDaFalha(e), true);
        log("erro", "navegador_erro_inesperado", { ferramenta: r.ferramenta, erro: e instanceof Error ? e.name : "desconhecido" });
        return resposta({ erro: "acao_falhou", instrucao: "A ação falhou no navegador. Nada foi confirmado; leia a página de novo antes de repetir." }, true);
      }
    },
    /**
     * A ação aprovada roda como foi pedida (molde de `computadores.executarAprovado`): o turno ainda vale, a pessoa não
     * está no controle. O resultado espera o turno que pediu (`resultadoDaAcao`), cifrado e entregue uma vez.
     */
    async executarAprovado(p: Escopo & { agenteId: string; turnoId: string; acaoId: string; acao: string }): Promise<void> {
      const acao = JSON.parse(o.decifrar(p.acao)) as AcaoPendente;
      if (acao.agenteId !== p.agenteId || acao.turnoId !== p.turnoId || !Object.hasOwn(FERRAMENTAS_NAVEGADOR, acao.ferramenta)) throw new ErroDeDominio("nao_permitido");
      const escopo = { tenantId: p.tenantId, pessoaId: p.pessoaId };
      const plano = await o.dentro(escopo, async (d) => {
        if (!await turnoPermitido(d, p.turnoId, p.agenteId, true)) throw new ErroDeDominio("nao_permitido");
        const t = await d.repos.turnos.buscar(p.turnoId);
        return { turnoId: p.turnoId, agenteId: p.agenteId, conversaId: t?.conversaId ?? "" };
      });
      const est = estadoDe(escopo, p.agenteId);
      if (est.vista.controle === "pessoa") throw new ErroDeDominio("nao_permitido");
      mudar(est, { controle: "bot", pedido: null });
      const motor = motorDe(est);
      const guardar = (conteudo: unknown) => {
        if (resultados.size >= RESULTADOS_MAX) resultados.delete(resultados.keys().next().value!);
        resultados.set(p.acaoId, { pessoaId: p.pessoaId, cifrado: o.cifrar(JSON.stringify(conteudo)) });
      };
      if (!motor || !(await vaga(est))) {
        guardar({ erro: "indisponivel", instrucao: "O navegador não estava disponível quando a pessoa aprovou. Nada foi executado; peça de novo." });
        throw new ErroDeDominio("estado_invalido", { cause: "navegador indisponível" });
      }
      const c: Contexto = { escopo, plano, est, motor, modo: "total", liberacoes: SEM_LIBERACOES };
      try {
        const s = await comPasso(c, acao.ferramenta, null, () => efeito(c, acao.ferramenta, acao.argumentos));
        // O print aprovado não volta ao modelo (o turno não pediu para ver): só o texto.
        guardar(s.conteudo);
        if (s.isError) throw new ErroDeDominio("estado_invalido");
      } catch (e) {
        if (ehFalhaNavegador(e)) { guardar(instrucaoDaFalha(e)); throw new ErroDeDominio("estado_invalido", { cause: e.motivo }); }
        throw e;
      }
    },
    /** O resultado da ação aprovada, uma vez, para o turno que a esperava; null se não há (ou é de outra pessoa). */
    resultadoDaAcao(escopo: Escopo, acaoId: string): string | null {
      const r = resultados.get(acaoId);
      if (!r || r.pessoaId !== escopo.pessoaId) return null;
      resultados.delete(acaoId);
      return o.decifrar(r.cifrado);
    },
    /** A vista de um bot (null = nunca usou o navegador desde que o servidor subiu). */
    vista(escopo: Escopo, agenteId: string): VistaNavegador | null {
      const e = estados.get(agenteId);
      return e && e.escopo.pessoaId === escopo.pessoaId && e.escopo.tenantId === escopo.tenantId ? e.vista : null;
    },
    /** D4: assumir, devolver, pedir e resolver o controle. null = a transição não vale do estado atual. */
    controlar(escopo: Escopo, agenteId: string, op: OperacaoControle): VistaNavegador | null {
      const est = estadoDe(escopo, agenteId);
      const proximo = proximoControle(est.vista.controle, op);
      if (!proximo) return null;
      if (proximo !== "pessoa") descartarGravacao(est);
      mudar(est, { controle: proximo, ...(proximo === "bot" ? { pedido: null } : {}), atividadeEm: agora() });
      return est.vista;
    },
    /** L3: o nod pôs um segredo na página (cofre → campo); leitura, print e eval travam até a URL mudar. */
    marcarSegredo(escopo: Escopo, agenteId: string, url: string): void {
      const est = estadoDe(escopo, agenteId);
      est.urlDoSegredo = url;
      mudar(est, { segredoNaPagina: true });
    },
    /** A porta do WebSocket de quadros do Chrome do bot (a próxima etapa repassa à web); null sem Chrome vivo. */
    async portaDoStream(escopo: Escopo, agenteId: string): Promise<number | null> {
      const est = estados.get(agenteId);
      if (!est || !est.vivo || est.escopo.pessoaId !== escopo.pessoaId) return null;
      return (await motorDe(est)?.portaDoStream(sessao(agenteId))) ?? null;
    },
    /** Desliga o Chrome do bot (excluir o bot, a pessoa pediu). */
    async desligar(escopo: Escopo, agenteId: string): Promise<void> {
      const est = estados.get(agenteId);
      if (!est || est.escopo.pessoaId !== escopo.pessoaId) return;
      est.vivo = false;
      est.refs = null;
      await motorDe(est)?.fechar(sessao(agenteId));
      mudar(est, { estado: "desligado", passo: null, abas: [] });
    },
    pausarOciosos,
    conferirDona,
    /** A vista de um bot, criada se ainda não existe (o canal ao vivo, depois de conferir a dona). */
    vistaDe: (escopo: Escopo, agenteId: string): VistaNavegador => estadoDe(escopo, agenteId).vista,
    /**
     * POST /agentes/:id/navegador (D3, D4). devolver e resolver fecham o pedido aberto (login, ajuda) e retomam o turno
     * que esperava; com uma aprovação aberta, o controle volta a esperar por ela (a aprovação se responde pelos botões).
     * Devolver no meio de uma gravação a descarta (com Desfazer por 10 s).
     */
    async operar(escopo: Escopo, agenteId: string, op: OperacaoNavegador): Promise<VistaNavegador> {
      await conferirDona(escopo, agenteId);
      const est = estadoDe(escopo, agenteId);
      if (op === "assumir") {
        if (!proximoControle(est.vista.controle, "assumir")) throw new ErroDeDominio("estado_invalido", { cause: "ja_com_voce" });
        mudar(est, { controle: "pessoa", atividadeEm: agora() });
        return est.vista;
      }
      if (op === "devolver" || op === "resolver") {
        if (!proximoControle(est.vista.controle, op)) throw new ErroDeDominio("estado_invalido", { cause: "sem_controle" });
        descartarGravacao(est);
        const pedido = est.vista.pedido;
        if (pedido?.tipo === "aprovacao") {
          const aberta = await o.dentro(escopo, async (d) => {
            const decisao = await d.repos.decisoes.buscar(pedido.decisaoId);
            return decisao !== null && (decisao.estado === "pendente" || decisao.estado === "reaberta");
          });
          if (aberta) { mudar(est, { controle: "precisa_de_voce", atividadeEm: agora() }); return est.vista; }
        }
        mudar(est, { controle: "bot", pedido: null, atividadeEm: agora() });
        if (pedido && pedido.tipo !== "aprovacao") await (o.retomarPedido ?? retomarDoPedido)(escopo, pedido.decisaoId, RETOMADA[op]);
        return est.vista;
      }
      if (op === "ligar" || op === "retomar") {
        const lugar = await o.dentro(escopo, (d) => decidirLugar(d, est));
        if (lugar.tipo === "espera") throw new ErroDeDominio("estado_invalido", { cause: lugar.motivo });
        await ligar(est);
        return est.vista;
      }
      if (op === "encerrar") {
        descartarGravacao(est);
        est.vivo = false;
        est.refs = null;
        est.abasGuardadas = [];
        await motorDe(est)?.fechar(sessao(agenteId));
        mudar(est, { estado: "desligado", passo: null, abas: [], controle: est.vista.controle === "pessoa" ? "bot" : est.vista.controle });
        return est.vista;
      }
      // recarregar
      const motor = exigirPessoa(est);
      await motor.historico(sessao(agenteId), "recarregar").catch((e: unknown) => { throw ehFalhaNavegador(e) ? new ErroDeDominio("estado_invalido", { cause: "acao_falhou" }) : e; });
      est.refs = null;
      return est.vista;
    },
    /** POST /agentes/:id/navegador/endereco: a pessoa no controle digita na barra (a mesma validação do portão). */
    async irPara(escopo: Escopo, agenteId: string, url: string): Promise<VistaNavegador> {
      await conferirDona(escopo, agenteId);
      const est = estadoDe(escopo, agenteId);
      if (!enderecoPermitido(url)) throw new ErroDeDominio("entrada_invalida", { cause: "endereco_recusado" });
      const motor = exigirPessoa(est);
      await motor.abrir(sessao(agenteId), url).catch((e: unknown) => { throw ehFalhaNavegador(e) ? new ErroDeDominio("estado_invalido", { cause: "acao_falhou" }) : e; });
      await atualizarAbasDe(est, motor);
      mudar(est, { atividadeEm: agora() });
      return est.vista;
    },
    /** POST /agentes/:id/navegador/aba: a pessoa no controle troca de aba (o id da vista, `t1`). */
    async trocarAba(escopo: Escopo, agenteId: string, aba: string): Promise<VistaNavegador> {
      await conferirDona(escopo, agenteId);
      const est = estadoDe(escopo, agenteId);
      if (!TAB_ID.test(aba)) throw new ErroDeDominio("entrada_invalida", { cause: "aba" });
      const motor = exigirPessoa(est);
      const abas = await motor.abas(sessao(agenteId));
      if (!abas.some((a) => a.id === aba)) throw new ErroDeDominio("nao_encontrado", { cause: "aba" });
      await motor.abaTrocar(sessao(agenteId), aba);
      await atualizarAbasDe(est, motor);
      return est.vista;
    },
    /**
     * POST /agentes/:id/navegador/ensinar (T). Começar só com a pessoa no controle; salvar grava a tarefa e manda, em nome
     * dela, "Ensinei: <nome>." com `passos-gravados.txt` na conversa do bot (o turno normal do bot vem dessa mensagem).
     */
    async ensinar(escopo: Escopo, agenteId: string, op: OperacaoEnsinar, nome?: string): Promise<{ vista: VistaNavegador; tarefa?: TarefaEnsinada }> {
      await conferirDona(escopo, agenteId);
      const est = estadoDe(escopo, agenteId);
      if (op === "comecar") {
        if (est.vista.controle !== "pessoa") throw new ErroDeDominio("estado_invalido", { cause: "assuma_primeiro" });
        if (!est.gravacao) {
          est.gravacao = novaGravacao(agora());
          est.parou = null;
          est.campo = null;
          est.descartada = null;
          mudar(est, { gravacao: vistaDaGravacao(est), descarte: null });
          if (/^https?:/i.test(est.url)) registrar(est, { tipo: "abriu", url: est.url });
        }
        return { vista: est.vista };
      }
      if (op === "descartar") {
        if (!est.gravacao) throw new ErroDeDominio("estado_invalido", { cause: "sem_gravacao" });
        descartarGravacao(est);
        return { vista: est.vista };
      }
      if (op === "desfazer_descarte") {
        if (!est.descartada || est.descartada.ate < agora()) throw new ErroDeDominio("estado_invalido", { cause: "sem_descarte" });
        est.gravacao = est.descartada.gravacao;
        est.descartada = null;
        mudar(est, { gravacao: vistaDaGravacao(est), descarte: null });
        return { vista: est.vista };
      }
      // salvar
      const g = est.gravacao;
      if (!g || g.eventos.length === 0) throw new ErroDeDominio("estado_invalido", { cause: "sem_passos" });
      const nomeFinal = (nome?.replace(/\s+/g, " ").trim() || nomeSugerido(g)).slice(0, 120);
      const tarefa = await o.dentro(escopo, async (d) => {
        const t = await d.repos.navegadorTarefas.criar({ agenteId, nome: nomeFinal, passos: passosDaGravacao(g) });
        if (!t) throw new ErroDeDominio("nao_encontrado");
        const mandar = o.mandarMensagem ?? ((dd: Deps, m: MensagemDaPessoa) => mandarMensagemPadrao(dd, { ...m, ...(o.executor ? { executor: o.executor() } : {}) }));
        await mandar(d, { agenteId, texto: `Ensinei: ${nomeFinal}.`, arquivo: { nome: "passos-gravados.txt", conteudo: arquivoDosPassos(nomeFinal, g) } });
        return t;
      });
      est.gravacao = null;
      est.parou = null;
      est.campo = null;
      mudar(est, { gravacao: null });
      return { vista: est.vista, tarefa };
    },
    /** O stream ao vivo do Chrome mandou abas ou o tamanho da tela (só para quem já tem estado: a dona assistindo). */
    doStream(escopo: Escopo, agenteId: string, m: { abas?: readonly AbaMotor[]; viewport?: { w: number; h: number } }): void {
      const est = estados.get(agenteId);
      if (!est || est.escopo.pessoaId !== escopo.pessoaId || est.escopo.tenantId !== escopo.tenantId || !est.vivo) return;
      if (m.abas) aplicarAbas(est, m.abas);
      if (m.viewport && (m.viewport.w !== est.vista.viewport.w || m.viewport.h !== est.vista.viewport.h)) mudar(est, { viewport: m.viewport });
    },
    /**
     * Antes de repassar uma entrada da pessoa ao Chrome (T): gravando, o clique vira "Clicou em …" (o elemento no ponto,
     * descrito ANTES do clique, que pode trocar de página) e a digitação vira "Preencheu <rótulo>" (nunca o texto).
     */
    async antesDaEntrada(escopo: Escopo, agenteId: string, e: EntradaNavegador): Promise<void> {
      const est = estados.get(agenteId);
      if (!est || !est.gravacao || est.vista.controle !== "pessoa" || est.escopo.pessoaId !== escopo.pessoaId) return;
      const motor = motorDe(est);
      if (!motor) return;
      const s = sessao(agenteId);
      if (e.t === "mouse") {
        if (e.evento !== "mousePressed") return;
        const el = await motor.descreverElemento(s, { x: e.x, y: e.y }).catch(() => null);
        if (el?.editavel) { est.campo = campoDoElemento(el, campoEhSecreto); return; }
        est.campo = null;
        const clique = eventoDoClique(el);
        if (clique) registrar(est, clique);
        return;
      }
      if (e.evento === "keyDown" && e.tecla === "Enter") { registrar(est, { tipo: "tecla", tecla: "Enter" }); return; }
      if (e.evento === "keyDown" && e.tecla === "Tab") { est.campo = null; return; }
      if (!entradaDigita(e)) return;
      if (!est.campo) {
        const el = await motor.descreverElemento(s, null).catch(() => null);
        if (!el?.editavel) return;
        est.campo = campoDoElemento(el, campoEhSecreto);
      }
      registrar(est, { tipo: "digitou", campo: est.campo.campo, protegido: est.campo.protegido });
    },
    /** Quantos Chromes vivos no servidor (o limite NOD_NAVEGADORES_MAX). */
    vivos: () => [...estados.values()].filter((e) => e.vivo).length,
  };
}
export type Navegadores = ReturnType<typeof criarNavegadores>;
