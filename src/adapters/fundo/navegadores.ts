import { randomUUID } from "node:crypto";
import { FERRAMENTAS_NAVEGADOR, FERRAMENTAS_NAVEGADOR_DIRETAS, NAVEGADOR_SO_LEITURA, type NomeFerramentaNavegador } from "../../contracts/ferramentas-navegador.ts";
import type { JsonSchema } from "../../contracts/json-schema.ts";
import type { Executor } from "../../contracts/evento.ts";
import type { AbaNavegador, CaixaNavegador, EntradaNavegador, EscolhaLoginNavegador, FonteCofre, GravacaoNavegador, LugarNavegador, OpcaoLogin, OperacaoEnsinar, OperacaoNavegador, PassoNavegador, PedidoDaVistaNavegador, TarefaEnsinada, VistaNavegador } from "../../contracts/navegador-do-bot.ts";
import type { PlanoTurno } from "../../contracts/plano-turno.ts";
import { ErroDeDominio } from "../../domain/erro.ts";
import { modoNoTurno } from "../../domain/modo-aprovacao.ts";
import { motorLe, tipoDoAnexo } from "../../domain/anexo.ts";
import { classificarAcao, decidirNoNavegador, juntarLiberacoes, perguntaDaAcao, SEM_LIBERACOES, siteLegivel, type AlvoResolvido, type LiberacoesNavegador } from "../../domain/navegador-aprovacao.ts";
import { aplicarDigitacao, codigoValido, destinoNaPagina, DIGITADO_DURA_MS, dominioRegistravel, ehLoginDoGoogle, googleRecusouOLogin, hostDoSite, itemCasaComHost, textosDoAparelho, type AparelhoDaPessoa, OPCOES_MAX, ordenarOpcoes, rotuloDoItem, textoDoCombinar, textoDoLembrar, type Digitado } from "../../domain/navegador-cofre.ts";
import { entradaDigita } from "../../domain/navegador-entrada.ts";
import { arquivoDosPassos, campoDoElemento, mensagemDoEnsinado, nomeDoArquivoDosPassos, eventoDoClique, gravar, nomeSugerido, novaGravacao, passosDaGravacao, type ElementoNaPagina, type EventoGravado, type Gravacao } from "../../domain/navegador-ensinar.ts";
import { buscarNoCatalogo, ehDoCatalogo } from "../../domain/navegador-catalogo.ts";
import { campoEhSecreto, redigirArvore, segredoAindaNaPagina } from "../../domain/navegador-sensivel.ts";
import { botPodeAgir, deveriaPausar, fraseDoPasso, proximoControle, temChromeVivo, viewportDeQuemAssiste, viewportMudouMuito, type OperacaoControle } from "../../domain/navegador-vista.ts";
import { log } from "../../obs/log.ts";
import type { Escopo } from "../../shared/types.ts";
import { errosDoSchema, type ResultadoChamada } from "../../use-cases/chamar-ferramenta.ts";
import { receberAnexo } from "../../use-cases/anexos.ts";
import { enviarMensagem } from "../../use-cases/enviar-mensagem.ts";
import { pedirAprovacaoComputador } from "../../use-cases/pedir-aprovacao.ts";
import { fecharComResposta, retomarComResposta } from "../../use-cases/responder-decisao.ts";
import { pedirAjudaDoComputador, pedirAPessoa } from "../../use-cases/pedir-a-pessoa.ts";
import { avisarForaDoAr, type LugarDecidido } from "../../use-cases/navegador-lugar.ts";
import { cartaoDaEspera } from "../../use-cases/navegador-mac-desligado.ts";
import { registrarNegacao } from "../../use-cases/registrar-negacao.ts";
import type { Deps } from "../../use-cases/tipos.ts";
import { ehFalhaNavegador, FalhaNavegador, type AbaMotor, type MotorNavegador, type RefLida, type SessaoNavegador } from "../navegador/motor-agent-browser.ts";
import type { MacDaPessoa } from "../navegador/mac-da-pessoa.ts";
import { inserirCodigo, preencherLogin } from "../navegador/preencher-login.ts";
import { turnoPermitido } from "./computadores.ts";
import { retomarAposDevolverNavegador } from "../../use-cases/retomar-apos-devolver.ts";

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
  /**
   * O navegador espera o Mac: o cartão da conversa (K1 no pedido pela conversa, a pergunta M2/J1 na rotina) e a instrução
   * que o bot lê no lugar da padrão (padrão: `cartaoDaEspera`). Uma vez por turno.
   */
  cartaoDaEspera?(d: Deps, plano: PlanoTurno): Promise<string | null>;
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
  /** D2 C e D8: quanto o anel fica no alvo antes do clique (padrão MS_MIRAR_ANTES, 300 ms; os testes passam 0). */
  msMirar?: number;
  /** Quanto o nod espera antes de conferir de novo um CAPTCHA visto (o do Cloudflare às vezes passa sozinho; padrão MS_DESAFIO_CONFERIR, os testes passam 0). */
  msDesafio?: number;
  /** O intervalo das conferências do título depois de abrir uma página que voltou sem título (padrão 1 s; os testes passam 0). */
  msCarregar?: number;
  /** A vista de um bot mudou (estado, controle, abas, passo): o canal ao vivo manda a vista e o SSE avisa a web. */
  aoMudar?(escopo: Escopo, vista: VistaNavegador): void;
  /** O executor vivo (o da retomada do turno e da mensagem "Ensinei: …"); ausente = catcher. */
  executor?: () => Executor;
  /** Costura de teste: fecha o pedido aberto com a frase e retoma o turno (padrão: fecharComResposta + retomarComResposta). */
  retomarPedido?: (escopo: Escopo, decisaoId: string, texto: string) => Promise<void>;
  /** Costura de teste: retoma o turno que esbarrou no navegador com a pessoa (padrão: retomarAposDevolverNavegador). */
  retomarDevolvido?: (escopo: Escopo, turnoId: string, automatico: boolean) => Promise<void>;
  /** Costura de teste: a mensagem da pessoa com o arquivo anexado (padrão: anexo + enviarMensagem na conversa do bot). */
  mandarMensagem?: (d: Deps, p: MensagemDaPessoa) => Promise<void>;
  /** Costuras de teste: os casos de uso que criam a decisão (padrão: os reais; login e código usam o pedido de ajuda). */
  pedirAprovacao?: typeof pedirAprovacaoComputador;
  pedirAPessoa?: typeof pedirAPessoa;
  /**
   * O app do Mac da pessoa (ADR-177, L): o 1Password, o Bitwarden, os cookies do Chrome e o Touch ID, pela fila da
   * máquina. Ausente = só o cofre do nod e a confirmação comum.
   */
  mac?: MacDaPessoa;
  /** A máquina onde o navegador de um lugar remoto roda (o Mac do lugar "mac"): preencher no próprio Mac quando é o mesmo. */
  maquinaDoLugar?(lugar: LugarNavegador, escopo: Escopo): string | null;
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
  /** L: o host da aba quando o cartão de login foi montado (o preenchimento confere que a página não mudou de site). */
  loginHost: string | null;
  /** 2026-11-23: o último site (fora do login do Google) em que o bot esteve: o do "Entrar com o Google" que o Google recusou. */
  siteAntesDoGoogle: string | null;
  /** L2: o preenchimento em segundo plano (o Mac pede o Touch ID ou o Keychain). */
  loginEmCurso: Promise<void> | null;
  /** L5: o que a pessoa digita no login "Entrar eu mesmo", só em memória e cifrado, até `ate`. */
  captura: Captura | null;
  /** A3: o último texto que o BOT preencheu e em que página (a citação do cartão de envio). Nunca o que a pessoa digita. */
  ultimoTexto: { url: string; texto: string } | null;
  /**
   * O tamanho do Chrome que acompanha quem assiste (emenda de 2026-11-20, item 4): `pedido` é o último que a web pediu
   * (fica com ninguém assistindo), `aplicado` o que o Chrome de agora já tem (null = o padrão de quando ligou).
   */
  tamanho: { pedido: { w: number; h: number } | null; aplicado: { w: number; h: number } | null; mudando: boolean };
  /** As referências caíram porque o Chrome mudou de tamanho: a ref velha recebe "a página mudou de tamanho". */
  refsPorTamanho: boolean;
  /** D3, 5 e N4: o turno que mexeu por último e o último passo dele; o turno acabado põe a vista em "terminou". */
  turnoId: string | null;
  ultimoPasso: PassoNavegador | null;
  /** A URL em que o nod já entregou um CAPTCHA à pessoa: se ela devolve na mesma página, o bot segue (sem entregar de novo). */
  desafioEm: string | null;
  /**
   * O controle assumido à mão (2026-11-22): quando a pessoa assumiu, quando mexeu por último (o controle volta sozinho
   * depois de DEVOLVE_SOZINHO_MS parado) e o turno do bot que esbarrou no navegador com ela (retomado quando volta).
   */
  assumidoEm: number | null;
  entradaPessoaEm: number | null;
  turnoEsperando: string | null;
};

/** L5: o usuário e a senha que a pessoa digitou (cada um cifrado), o campo em que ela está e a URL de quando começou. */
type Captura = { host: string; url: string; ate: number; campo: "usuario" | "senha" | null; usuario: string | null; senha: string | null; tudo: { usuario: boolean; senha: boolean }; ofertada: boolean };

/** A mensagem que a pessoa manda ao salvar uma tarefa ensinada (T3). */
export type MensagemDaPessoa = { agenteId: string; texto: string; arquivo: { nome: string; conteudo: string } };

/**
 * A ação pendente de aprovação, cifrada no item da decisão: roda como foi aprovada. `touchId` (A1, ADR-177): pagar pede o
 * Touch ID do Mac antes de rodar, por qualquer caminho que a aprovação venha (pílula, conversa, celular). `lembrar` (A3):
 * o destino visto na página que o "Não perguntar de novo" grava. `combinar` (A2): o teto ou o destino de antemão.
 */
type AcaoPendente =
  | { tipo?: "ferramenta"; agenteId: string; turnoId: string; ferramenta: NomeFerramentaNavegador; argumentos: Record<string, unknown>; touchId?: boolean; pergunta?: string; lembrar?: { host: string; destino: string } }
  | { tipo: "combinar"; agenteId: string; turnoId: string; host: string; ateCentavos: number | null; destino: string | null; touchId: boolean; pergunta: string };

/** O conteúdo de uma ferramenta que rodou, antes de virar JSON. */
type Saida = { conteudo: Record<string, unknown>; imagem?: string; isError?: boolean };
type Contexto = { escopo: Escopo; plano: Pick<PlanoTurno, "turnoId" | "agenteId" | "conversaId">; est: Estado; motor: MotorNavegador; modo: "manual" | "automatico" | "total"; liberacoes: LiberacoesNavegador };

const MAX_PADRAO = 4;
/** definido em 2026-11-20 (T): o Desfazer da gravação descartada vale 10 s. */
export const DESFAZER_DESCARTE_MS = 10_000;
/** definido em 2026-11-20 (D0): reabrir mais que isto de abas ao retomar pesa mais do que ajuda. */
const ABAS_GUARDADAS_MAX = 10;
/** As frases que retomam o turno que esperava a pessoa (login, captcha, ajuda). */
export const RETOMADA = {
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
const FORA_DO_SCRIPT: ReadonlySet<string> = new Set(["navegador_buscar", "navegador_usar", "navegador_rodar_script", "navegador_entrar", "navegador_pedir_ajuda", "navegador_tarefa_ensinada", "navegador_combinar"]);
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
/**
 * L5: o campo do login em que a pessoa digita. Senha = type=password ou autocomplete de senha; o código de uso único e o
 * cartão (outros campos protegidos) nunca são capturados; um campo de digitar comum é o usuário.
 */
function campoDoLogin(el: ElementoNaPagina | null): "usuario" | "senha" | null {
  if (!el?.editavel) return null;
  if (el.tipo === "password" || /^(current-password|new-password)/.test(el.autocomplete ?? "")) return "senha";
  return campoEhSecreto({ papel: el.papel, nome: el.rotulo || el.nome, tipo: el.tipo, autocomplete: el.autocomplete }) ? null : "usuario";
}
const obj = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** definido em 2026-11-20 (D2 C, D8): o anel aparece no alvo 300 ms antes do clique. */
export const MS_MIRAR_ANTES = 300;
/**
 * definido em 2026-11-20 (prova real: o DuckDuckGo abriu um CAPTCHA, o modelo viu no print e pediu no chat, sem
 * navegador_pedir_ajuda, e a tela não ficou azul): depois de abrir, ler, ver, clicar ou apertar uma tecla, o nod confere se
 * a página mostra uma verificação de humano e, se mostra, entrega o navegador à pessoa ele mesmo, com o pedido de ajuda
 * na conversa (o mesmo de navegador_pedir_ajuda). Só o que se vê conta: o reCAPTCHA invisível de um formulário não
 * dispara (quadro de 40 px ou mais, visível). O texto só conta em página curta, para um artigo sobre CAPTCHA não disparar.
 */
export const DETECTAR_DESAFIO = `(() => {
  const ve = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width >= 40 && r.height >= 40 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.1; };
  for (const f of document.querySelectorAll("iframe")) {
    const src = f.src || "";
    if (/size=invisible/.test(src) || !ve(f)) continue;
    if (/recaptcha\\/(api2|enterprise)\\/(anchor|bframe)/.test(src)) return "recaptcha";
    if (/hcaptcha\\.com/.test(src)) return "hcaptcha";
    if (/challenges\\.cloudflare\\.com/.test(src)) return "cloudflare";
    if (/captcha/i.test(src)) return "captcha";
  }
  const t = (document.body && document.body.innerText || "").slice(0, 6000);
  if (t.length < 6000 && /bots use DuckDuckGo too|I'm not a robot|I am not a robot|n[ãa]o sou um rob[ôo]|verify (that )?you('re| are) (a )?human|confirm (that )?(this search was made by|you('re| are)) a human|prove you('re| are) (a )?human|verifique se voc[êe] [ée] (um )?humano|complete the security check/i.test(t)) return "texto";
  return null;
})()`;
export const MS_DESAFIO_CONFERIR = 2500;
/** Depois destas, a página pode ter virado um CAPTCHA (ou o bot pode tê-lo visto). */
const CONFEREM_DESAFIO: ReadonlySet<string> = new Set(["navegador_abrir", "navegador_ler", "navegador_ver", "navegador_clicar", "navegador_tecla", "navegador_procurar", "navegador_historico"]);
export const INSTRUCAO_DO_DESAFIO = "A página mostra uma verificação de humano (CAPTCHA). O nod já passou o navegador para a pessoa, com o pedido na conversa: não peça no chat nem tente resolver. Encerre o turno; ela devolve e você continua.";
/** As ferramentas cujo alvo a pessoa vê na imagem: o passo leva a caixa dele (o cursor com o nome e o anel, D2 C). */
const FERRAMENTAS_COM_ALVO_NA_TELA: ReadonlySet<string> = new Set(["navegador_clicar", "navegador_preencher", "navegador_digitar", "navegador_selecionar", "navegador_marcar", "navegador_passar_mouse", "navegador_baixar", "navegador_enviar_arquivo", "navegador_rolar"]);

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
const AGUARDANDO_PESSOA = { estado: "aguardando_pessoa", instrucao: "O navegador espera a pessoa resolver o pedido que você fez a ela (login, ajuda ou aprovação). Nada foi executado. Encerre o turno e aguarde; quando ela resolver, você continua." };
/**
 * A pessoa assumiu o navegador à mão (revisto em 2026-11-22, teste do dono): a frase dupla de antes ("está com o navegador
 * (ou ele espera um passo dela)") fez a Ada dizer "provavelmente uma verificação do site". Agora diz o que aconteceu e o
 * que vem depois; adiantar o resto por outro caminho segue permitido (decisão do dono: ler por fora não faz mal).
 */
const PESSOA_NO_CONTROLE = { estado: "pessoa_no_controle", instrucao: "A pessoa assumiu o controle do navegador. Nada foi executado nele. Adiante o que não depende do navegador, se houver, e termine o turno dizendo em uma frase o que falta fazer nele. Quando ela devolver (ou depois de alguns minutos sem ela mexer), você é retomada automaticamente e continua daqui." };
/** O controle assumido à mão volta sozinho ao bot depois deste tempo sem a pessoa mexer (como o OpenMausBot, no modo "manter"). */
export const DEVOLVE_SOZINHO_MS = 5 * 60_000;
/** A pílula avisa ("volta para a Ada em 1 min") este tempo antes. */
export const AVISO_DEVOLVE_MS = 60_000;
const NA_FILA = { estado: "na_fila", instrucao: "Os navegadores do nod estão todos em uso agora. Nada foi executado. Siga com o que dá sem o navegador e tente de novo em 30 s; não diga que o navegador quebrou." };
const SEGREDO_NA_PAGINA = { erro: "segredo_na_pagina", instrucao: "A página tem uma senha ou código que o nod preencheu; a leitura e o print ficam travados até a página mudar. Clique no botão de entrar (ou espere a página seguinte) e leia de novo." };
/**
 * As frases que fecham o pedido de login e retomam o bot (nunca com valor nenhum). Exportadas para o teste da web, que
 * reconhece a resposta e a desenha como linha discreta (web/lib/navegador-cartoes.ts, `linhaDaRespostaDoNavegador`).
 */
export const LOGIN_PREENCHIDO = (site: string) => `Login preenchido no ${site} (a senha não passa por você). A leitura e o print ficam travados até a página mudar: aperte Enter (navegador_tecla) ou clique no botão de entrar com a referência da última leitura. Se a página seguinte pedir um código, chame navegador_pedir_ajuda com codigo: true.`;
export const SO_USUARIO = (site: string) => `Preenchi só o usuário no ${site}: a página não mostra o campo de senha ainda. Clique em continuar (ou avançar) e chame navegador_entrar de novo na página da senha.`;
export const CODIGO_ENVIADO = "Código enviado. A pessoa pôs o código no campo da página (você não o vê). A leitura fica travada até a página mudar: aperte Enter (navegador_tecla) ou clique no botão de confirmar com a referência da última leitura.";
/**
 * 2026-11-23: o que o bot ouve quando a página é a recusa do Google ("pode não ser seguro"): não contornar, pedir à pessoa o
 * "Trazer do meu Chrome" do site de origem.
 */
export const GOOGLE_RECUSOU = (site: string | null) => `O Google recusou o login neste navegador ("Esse navegador pode não ser seguro"). É regra do Google para navegadores automatizados: não tente de novo nem contorne. ${site ? `Chame navegador_pedir_ajuda dizendo que a pessoa pode tocar em "Trazer do meu Chrome" para entrar em ${site} com a sessão do Chrome dela` : "Chame navegador_pedir_ajuda dizendo que a pessoa pode tocar em \"Trazer do meu Chrome\" (menu ⋯ do navegador) no site em que quer entrar"}; quando ela trouxer, você é retomada.`;
export const DO_CHROME = (site: string, n: number) => `Trouxe do Chrome da pessoa a sessão de ${site} (${n} cookies) e recarreguei a página. Leia a página de novo; se ainda pedir login, chame navegador_entrar.`;
/**
 * As falas do bot que abrem os pedidos de login, de código e de ajuda (a mensagem `pedido_a_pessoa` da conversa). A web as
 * reconhece para trocar o cartão de pergunta pelo do navegador (web/lib/navegador-cartoes.ts, `pedidoDoNavegadorNaFala`).
 */
export const FALA_DO_LOGIN = (site: string, motivo: string) => `Preciso entrar em ${site} no meu navegador para continuar: ${motivo}. A senha vai do cofre direto para a página; ela não passa por mim.`;
export const FALA_DO_CODIGO = (motivo: string) => `Preciso do código que chegou para você: ${motivo}. Digite no cartão; ele vai direto para a página, não para mim.`;
export const FALA_DA_AJUDA = (motivo: string) => `Preciso de você no meu navegador: ${motivo}`;
/** A citação do envio (A3): o último texto que o bot preencheu na mesma página, até este tamanho. */
export const CITACAO_MAX = 280;
/** O aviso da pílula quando pagar pede Touch ID e o Mac está desligado (ADR-177; definido em 2026-11-20). */
export const AVISO_SEM_TOUCH_ID = textosDoAparelho("mac").avisoSemConfirmacao;
/** L2: a resposta ao celular quando o Mac pede a confirmação. */
export const CONFIRME_NO_MAC = textosDoAparelho("mac").confirmeNoAparelho;
/** Os erros do cartão de login (frases fixas, sem dado da pessoa). */
const ERRO_LOGIN: Readonly<Record<string, string>> = {
  recusado: "Você não confirmou no Mac. Escolha de novo.",
  alvo_invalido: "Não achei o campo de login nesta página.",
  tempo_esgotado: "O Mac não respondeu a tempo. Tente de novo.",
  indisponivel: "O seu Mac não está ligado agora.",
  acao_falhou: "Não deu para preencher agora. Tente de novo.",
  site_mudou: "A página mudou de site. Peça o login de novo.",
  sem_cookies: "O seu Chrome não tem uma sessão deste site.",
};
const PESSOA_FAZ = { erro: "a_pessoa_faz", instrucao: "Trocar senha, e-mail ou a segurança da conta é sempre a pessoa que faz. Nada foi executado. Chame navegador_pedir_ajuda com o motivo e encerre o turno." };

/** A frase que a máquina da pessoa mandou ("instale a extensão do nod…"), para o cartão: maiúscula, ponto final, curta. */
export function fraseDaMaquina(detalhe: string): string | undefined {
  const t = detalhe.replace(/[\p{Cc}]/gu, " ").trim().slice(0, 300);
  if (!t) return undefined;
  const f = t[0]!.toLocaleUpperCase("pt-BR") + t.slice(1);
  return /[.!?…]$/u.test(f) ? f : `${f}.`;
}

/** As frases do "Trazer do meu Chrome" solto (o ⋯ e a recusa do Google), para o aviso da web. */
export const TROUXE_DO_CHROME = (site: string) => `Pronto: o navegador entrou em ${site} com a sessão do seu Chrome.`;
export const CHROME_SEM_SESSAO = (site: string) => `O seu Chrome não tem uma sessão de ${site}. Entre nele no seu Chrome e tente de novo.`;

function instrucaoDaFalha(e: FalhaNavegador): { erro: string; detalhe: string; instrucao: string } {
  const instrucao = {
    alvo_invalido: "O alvo não existe, sumiu ou não aceita esta ação. Leia a página de novo (navegador_ler) e use uma referência da leitura nova.",
    tempo_esgotado: "O site não respondeu a tempo. Leia a página de novo antes de repetir; não afirme que a ação aconteceu.",
    acao_falhou: "A ação falhou no navegador. Leia a página de novo antes de repetir; não afirme que a ação aconteceu.",
    indisponivel: "O navegador não está disponível agora. Nada foi executado; siga com o que dá sem ele e diga em uma frase o que ficou de fora.",
    recusado: "A pessoa não confirmou. Nada foi executado; não tente de novo sem ela pedir.",
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
  const msMirar = o.msMirar ?? MS_MIRAR_ANTES;
  const msDesafio = o.msDesafio ?? MS_DESAFIO_CONFERIR;
  const msCarregar = o.msCarregar ?? 1_000;
  const max = Math.max(1, o.max ?? MAX_PADRAO);
  const aprovar = o.pedirAprovacao ?? pedirAprovacaoComputador;
  const perguntar = o.pedirAPessoa ?? pedirAPessoa;
  /** Login e código se respondem pelos botões (nunca com texto no chat: a senha e o código não passam por lá). */
  const perguntarSemTexto = o.pedirAPessoa ?? pedirAjudaDoComputador;
  /** As opções do Mac vistas por último, por pessoa e site (sem segredo): com o Mac desligado, elas aparecem cinza (M4). */
  const opcoesDoMacVistas = new Map<string, OpcaoLogin[]>();
  /** Os cofres do Mac que a pessoa usa (vistos numa lista): a oferta de guardar (L5) só oferece esses. */
  const fontesVistas = new Map<string, Set<FonteCofre>>();
  const chavePessoa = (escopo: Escopo) => `${escopo.tenantId}:${escopo.pessoaId}`;
  const estados = new Map<string, Estado>();
  /** Os turnos que já ganharam o cartão do Mac desligado (um por turno; o mais antigo sai depois de 500). */
  const cartoesDaEspera = new Set<string>();
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
      abasGuardadas: [], gravacao: null, parou: null, campo: null, descartada: null, esperando: false, desvioAvisado: null, loginHost: null, siteAntesDoGoogle: null, loginEmCurso: null, captura: null, ultimoTexto: null,
      tamanho: { pedido: null, aplicado: null, mudando: false }, refsPorTamanho: false, turnoId: null, ultimoPasso: null, desafioEm: null, assumidoEm: null, entradaPessoaEm: null, turnoEsperando: null,
      vista: { agenteId, estado: "desligado", controle: "bot", lugar: { tipo: "nod" }, abas: [], aviso: null, passo: null, pedido: null, gravacao: null, descarte: null, segredoNaPagina: false, ofertaGuardar: null, atividadeEm: agora(), erro: null, viewport: { w: 1280, h: 720 } },
    };
    estados.set(agenteId, novo);
    return novo;
  }

  /**
   * 2026-11-22 (o navegador no PC): o aparelho da pessoa (o Mac ou o PC). O ligado agora; desligado, o último visto
   * (a frase "precisa do seu PC ligado" não vira "Mac" quando ele desliga); nunca visto, o Mac.
   */
  const aparelhosVistos = new Map<string, AparelhoDaPessoa>();
  function aparelhoDe(escopo: Escopo): AparelhoDaPessoa {
    const agoraLigado = o.mac?.aparelho?.(escopo) ?? null;
    if (agoraLigado) aparelhosVistos.set(chavePessoa(escopo), agoraLigado);
    return agoraLigado ?? aparelhosVistos.get(chavePessoa(escopo)) ?? "mac";
  }
  const textos = (escopo: Escopo) => textosDoAparelho(aparelhoDe(escopo));

  function mudar(est: Estado, parcial: Partial<VistaNavegador>): void {
    // A vista diz o aparelho da pessoa (os textos da confirmação na web); só quando muda.
    const aparelho = aparelhoDe(est.escopo);
    if ((est.vista.aparelho ?? "mac") !== aparelho) parcial = { ...parcial, aparelho };
    // O aviso de Desfazer some sozinho na próxima mudança depois do prazo.
    const descarte = est.descartada && est.descartada.ate < agora() ? { descarte: null } : {};
    if ("descarte" in descarte) est.descartada = null;
    const antes = est.vista.estado;
    est.vista = { ...est.vista, ...descarte, ...parcial };
    // O Chrome novo nasce no tamanho padrão; quando fica ao vivo, ganha o tamanho de quem assiste (se alguém pediu).
    if (est.vista.estado === "ligando" && antes !== "ligando") est.tamanho.aplicado = null;
    if (est.vista.estado === "ao_vivo" && antes !== "ao_vivo" && est.tamanho.pedido) void aplicarTamanho(est);
    try { o.aoMudar?.(est.escopo, est.vista); } catch (e) { log("aviso", "navegador_aviso_falhou", { erro: e instanceof Error ? e.name : "desconhecido" }); }
  }

  /**
   * Põe o Chrome no tamanho pedido por quem assiste, um pedido por vez (o que chegar no meio espera e vale o último). Só
   * muda com mais de 8% de diferença. As referências da leitura caem: a página reflui e `@e3` pode ser outro elemento.
   */
  async function aplicarTamanho(est: Estado): Promise<void> {
    const t = est.tamanho;
    const alvo = t.pedido;
    if (t.mudando || !alvo || !est.vivo || !temChromeVivo(est.vista.estado)) return;
    if (!viewportMudouMuito(t.aplicado ?? est.vista.viewport, alvo)) return;
    const motor = motorDe(est);
    if (!motor) return;
    t.mudando = true;
    try {
      await motor.tamanho(sessao(est.vista.agenteId), alvo.w, alvo.h);
      t.aplicado = alvo;
      if (est.refs) { est.refs = null; est.refsPorTamanho = true; }
      mudar(est, { viewport: alvo });
    } catch (e) {
      log("aviso", "navegador_tamanho_falhou", { agente_id: est.vista.agenteId, erro: e instanceof Error ? e.name : "desconhecido" });
    } finally {
      t.mudando = false;
    }
    if (t.pedido !== alvo) void aplicarTamanho(est);
  }

  /** A pessoa mexeu no navegador (clique, tecla, endereço, aba): o prazo para o controle voltar sozinho recomeça. */
  function marcarEntrada(est: Estado): void {
    if (est.vista.controle !== "pessoa") return;
    est.entradaPessoaEm = agora();
    if (est.vista.devolveEm) mudar(est, { devolveEm: null });
  }

  /** O controle assumido à mão volta ao bot; devolve o turno que esperava por ele (null = nenhum). */
  function soltarDaPessoa(est: Estado): string | null {
    const esperando = est.turnoEsperando;
    est.assumidoEm = null;
    est.entradaPessoaEm = null;
    est.turnoEsperando = null;
    mudar(est, { controle: "bot", pedido: null, devolveEm: null, atividadeEm: agora() });
    return esperando;
  }

  async function retomarDevolvido(escopo: Escopo, turnoId: string, automatico: boolean): Promise<void> {
    if (o.retomarDevolvido) return o.retomarDevolvido(escopo, turnoId, automatico);
    await o.dentro(escopo, async (d) => {
      const r = await retomarAposDevolverNavegador(d, { turnoId, automatico });
      if (r.events?.length) await d.repos.events.gravarComOutbox(r.events);
    });
  }

  /**
   * O controle assumido à mão volta sozinho (2026-11-22): um minuto antes a pílula avisa; depois de DEVOLVE_SOZINHO_MS sem
   * a pessoa mexer, o bot recebe o navegador e o turno que esperava continua. Não vale com pedido aberto (login, ajuda:
   * o bot espera ela) nem gravando uma tarefa (ensinar).
   */
  async function devolverParados(): Promise<void> {
    const t = agora();
    for (const est of estados.values()) {
      if (est.vista.controle !== "pessoa" || est.vista.pedido || est.gravacao || est.entradaPessoaEm === null) continue;
      const parada = t - est.entradaPessoaEm;
      if (parada >= DEVOLVE_SOZINHO_MS) {
        const esperando = soltarDaPessoa(est);
        if (esperando) await retomarDevolvido(est.escopo, esperando, true).catch((e: unknown) => log("aviso", "navegador_retomada_falhou", { erro: e instanceof Error ? e.name : "desconhecido" }));
      } else if (parada >= DEVOLVE_SOZINHO_MS - AVISO_DEVOLVE_MS && !est.vista.devolveEm) {
        mudar(est, { devolveEm: est.entradaPessoaEm + DEVOLVE_SOZINHO_MS });
      }
    }
  }

  /**
   * D3, 5 e N4: o turno que mexeu por último acabou (concluído ou interrompido) e o bot não mexe mais — a vista vai a
   * "terminou" com o último passo ("Baixou 14 notas fiscais"), que a linha de atividade mostra com o ✓, a hora e o lugar.
   */
  async function marcarTerminados(): Promise<void> {
    for (const est of estados.values()) {
      const turnoId = est.turnoId;
      if (!turnoId || !est.vivo || est.vista.estado !== "ao_vivo" || est.vista.controle !== "bot" || est.vista.pedido || est.gravacao) continue;
      const t = await o.dentro(est.escopo, (d) => d.repos.turnos.buscar(turnoId)).catch(() => null);
      if (!t || (t.estado !== "concluido" && t.estado !== "interrompido") || est.turnoId !== turnoId) continue;
      est.turnoId = null;
      mudar(est, { estado: "terminou", passo: est.ultimoPasso });
    }
  }

  /** Fecha os Chromes parados há 10 min (D0): a vista fica "em pausa" e o perfil guarda os logins. */
  async function pausarOciosos(): Promise<number> {
    await devolverParados();
    await marcarTerminados();
    let pausados = 0;
    for (const est of estados.values()) {
      if (!est.vivo || !deveriaPausar(est.vista, agora())) continue;
      await pausar(est);
      pausados++;
    }
    return pausados;
  }

  /** Fecha o Chrome do bot: as abas ficam guardadas e o perfil guarda os logins (D0). */
  async function pausar(est: Estado): Promise<void> {
    const motor = motorDe(est);
    const abas = await motor?.abas(sessao(est.vista.agenteId)).catch(() => null);
    est.abasGuardadas = (abas ?? est.vista.abas).map((a) => a.url).filter(enderecoPermitido).slice(0, ABAS_GUARDADAS_MAX);
    est.vivo = false;
    est.refs = null; est.refsPorTamanho = false;
    await motor?.fechar(sessao(est.vista.agenteId)).catch((e: unknown) => log("aviso", "navegador_pausar_falhou", { agente_id: est.vista.agenteId, erro: e instanceof Error ? e.name : "desconhecido" }));
    mudar(est, { estado: "pausa", passo: null });
    // Ponto 09 dos cenários (2026-11-22): com o Chrome fechado, o cache sai do disco (os logins ficam).
    if (motor?.limparCache && !est.vivo) await motor.limparCache(sessao(est.vista.agenteId)).catch((e: unknown) => log("aviso", "navegador_limpar_cache_falhou", { agente_id: est.vista.agenteId, erro: e instanceof Error ? e.name : "desconhecido" }));
  }

  /**
   * Ponto 03 dos cenários (2026-11-22): com o teto cheio, o bot novo esperou 6 min porque os 4 Chromes eram de bots que já
   * tinham terminado (só pausam depois de 10 min parados). O Chrome de quem terminou há mais tempo pausa na hora e cede a
   * vaga; quem trabalha, espera alguém, está com a pessoa ou gravando uma tarefa nunca é tirado.
   */
  function quemCedeAVaga(): Estado | null {
    const livres = [...estados.values()].filter((e) => e.vivo && e.vista.lugar.tipo === "nod" && e.vista.estado === "terminou"
      && e.vista.controle === "bot" && !e.vista.pedido && !e.gravacao);
    return livres.sort((a, b) => a.vista.atividadeEm - b.vista.atividadeEm)[0] ?? null;
  }

  /** O Chrome do bot conta no limite; sem vaga, o bot espera na fila (ADR-190, decisão 8). Só o lugar "nod" tem limite. */
  async function vaga(est: Estado): Promise<boolean> {
    if (est.vivo) return true;
    if (est.vista.lugar.tipo === "nod") {
      const vivos = () => [...estados.values()].filter((e) => e.vivo && e.vista.lugar.tipo === "nod").length;
      if (vivos() >= max) await pausarOciosos();
      if (vivos() >= max) { const cede = quemCedeAVaga(); if (cede) await pausar(cede); }
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
    if (!est.refs && est.refsPorTamanho) throw new FalhaNavegador("alvo_invalido", `A página mudou de tamanho (a pessoa abriu a vista numa área de outro tamanho) e a referência @${ref(alvo)} é da leitura de antes. Leia de novo (navegador_ler) e use uma referência da leitura nova.`);
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
      notarUrl(est, ativa.url);
      est.refs = null; est.refsPorTamanho = false;
      est.campo = null;
      if (est.urlDoSegredo && !segredoAindaNaPagina(est.urlDoSegredo, ativa.url)) { est.urlDoSegredo = null; mudar(est, { segredoNaPagina: false }); }
      if (/^https?:/i.test(ativa.url)) registrar(est, { tipo: "abriu", url: ativa.url });
      oferecerGuardar(est, ativa.url);
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

  /** L5: o que a pessoa digitou sai da memória (guardou, disse não, venceu os 5 min ou começou outro login). */
  function limparCaptura(est: Estado): void {
    if (!est.captura && !est.vista.ofertaGuardar) return;
    est.captura = null;
    if (est.vista.ofertaGuardar) mudar(est, { ofertaGuardar: null });
  }

  /** A captura de agora, ou null se venceu (e aí some de vez). */
  function capturaViva(est: Estado): Captura | null {
    if (est.captura && est.captura.ate <= agora()) limparCaptura(est);
    return est.captura;
  }

  /** L5: começa a guardar (em memória, cifrado) o que a pessoa digitar no login dela; some sozinho em 5 min. */
  function comecarCaptura(est: Estado, host: string): void {
    limparCaptura(est);
    const ate = agora() + DIGITADO_DURA_MS;
    est.captura = { host, url: est.url, ate, campo: null, usuario: null, senha: null, tudo: { usuario: false, senha: false }, ofertada: false };
    const t = setTimeout(() => { if (est.captura?.ate === ate) limparCaptura(est); }, DIGITADO_DURA_MS);
    t.unref?.();
  }

  /** Uma tecla da pessoa no campo de usuário ou de senha do login dela (L5). */
  function capturar(est: Estado, campo: "usuario" | "senha", e: EntradaNavegador): void {
    const c = est.captura;
    if (!c || c.ofertada) return;
    const antes: Digitado = { texto: c[campo] ? o.decifrar(c[campo]!) : "", tudo: c.tudo[campo] };
    const depois = aplicarDigitacao(antes, e);
    if (depois.texto === antes.texto && depois.tudo === antes.tudo) return;
    c[campo] = depois.texto ? o.cifrar(depois.texto) : null;
    c.tudo[campo] = depois.tudo;
  }

  /** Os cofres para onde a oferta de guardar pode ir: o do nod sempre; os do Mac só os que a pessoa usa, com o Mac ligado. */
  function destinosDeGuardar(escopo: Escopo): FonteCofre[] {
    const vistos = fontesVistas.get(chavePessoa(escopo)) ?? new Set<FonteCofre>();
    const comMac = o.mac?.maquina(escopo) ? (["1password", "bitwarden"] as const).filter((f) => vistos.has(f)) : [];
    return ["nod", ...comMac];
  }

  /** L5: a página mudou depois de a pessoa digitar uma senha no login dela: a vista ganha a linha "Guardar no cofre?". */
  function oferecerGuardar(est: Estado, url: string): void {
    const c = capturaViva(est);
    if (!c || c.ofertada || !c.senha || url === c.url) return;
    c.ofertada = true;
    c.campo = null;
    mudar(est, { ofertaGuardar: { site: siteLegivel(c.host), usuario: c.usuario ? o.decifrar(c.usuario) : "", destinos: destinosDeGuardar(est.escopo), ate: c.ate } });
  }

  /**
   * As opções do cartão de login (L1): os logins do cofre do nod que casam com o site e, com o Mac ligado, os do 1Password e
   * do Bitwarden que o app achou (sem segredo). Com o Mac desligado, os do Mac vistos por último aparecem cinza (M4).
   */
  async function montarOpcoes(escopo: Escopo, agenteId: string, host: string): Promise<{ opcoes: OpcaoLogin[]; podeTrazerDoChrome: boolean }> {
    if (!host) return { opcoes: [], podeTrazerDoChrome: false };
    const doNod: OpcaoLogin[] = (await o.dentro(escopo, (d) => d.repos.cofreLogins.listar()))
      .filter((l) => itemCasaComHost(l.site, host))
      .map((l) => ({ fonte: "nod", ref: l.id, rotulo: rotuloDoItem(siteLegivel(l.site), l.usuario), disponivel: true }));
    const chave = `${chavePessoa(escopo)}:${dominioRegistravel(host)}`;
    const macLigado = o.mac?.maquina(escopo) ?? null;
    let doMac: OpcaoLogin[] = [];
    if (o.mac && macLigado) {
      const lista = await o.mac.listar(escopo, agenteId, host);
      if (lista) {
        doMac = lista;
        opcoesDoMacVistas.set(chave, lista.map((x) => ({ ...x })));
        const vistas = fontesVistas.get(chavePessoa(escopo)) ?? new Set<FonteCofre>();
        for (const x of lista) vistas.add(x.fonte);
        fontesVistas.set(chavePessoa(escopo), vistas);
      } else doMac = opcoesDoMacVistas.get(chave) ?? [];
    } else {
      doMac = (opcoesDoMacVistas.get(chave) ?? []).map((x) => ({ fonte: x.fonte, ref: x.ref, rotulo: x.rotulo, disponivel: false, motivoIndisponivel: textos(escopo).semAparelho }));
    }
    // No PC (2026-11-23) a opção vem pela extensão do nod no Chrome da pessoa (o perfil do dia a dia prende os cookies ao
    // Chrome, "v20"); sem a extensão, o motor responde com o que fazer (instalar a extensão).
    return { opcoes: ordenarOpcoes([...doMac, ...doNod]).slice(0, OPCOES_MAX), podeTrazerDoChrome: macLigado !== null };
  }

  /** O pedido aberto com esta decisão (e ainda aberto no banco), de um dos tipos, ou o erro de estado para a rota. */
  async function pedidoAberto<T extends PedidoDaVistaNavegador["tipo"]>(escopo: Escopo, est: Estado, decisaoId: string, tipos: readonly T[]): Promise<Extract<PedidoDaVistaNavegador, { tipo: T }>> {
    const p = est.vista.pedido;
    if (!p || !(tipos as readonly string[]).includes(p.tipo) || p.decisaoId !== decisaoId) throw new ErroDeDominio("estado_invalido", { cause: "sem_pedido" });
    const aberta = await o.dentro(escopo, async (d) => {
      const decisao = await d.repos.decisoes.buscar(decisaoId);
      return decisao !== null && (decisao.estado === "pendente" || decisao.estado === "reaberta");
    });
    if (!aberta) { mudar(est, { pedido: null, controle: est.vista.controle === "precisa_de_voce" || est.vista.controle === "pessoa" ? "bot" : est.vista.controle }); throw new ErroDeDominio("estado_invalido", { cause: "sem_pedido" }); }
    return p as Extract<PedidoDaVistaNavegador, { tipo: T }>;
  }

  /** O pedido fecha com a frase e o bot retoma; a vista volta ao bot. */
  async function fecharPedido(est: Estado, decisaoId: string, texto: string): Promise<void> {
    mudar(est, { controle: "bot", pedido: null, atividadeEm: agora() });
    est.loginHost = null;
    await (o.retomarPedido ?? retomarDoPedido)(est.escopo, decisaoId, texto);
  }

  /** O motor com o Chrome aberto e a URL de agora (o login e o código mexem na página que está lá). */
  async function motorAberto(est: Estado): Promise<{ motor: MotorNavegador; url: string }> {
    const motor = motorDe(est);
    if (!motor) throw new ErroDeDominio("estado_invalido", { cause: "indisponivel" });
    if (!est.vivo) throw new ErroDeDominio("estado_invalido", { cause: "desligado" });
    const url = await motor.url(sessao(est.vista.agenteId)).catch(() => est.url);
    est.url = url;
    notarUrl(est, url);
    return { motor, url };
  }

  /**
   * 2026-11-23: a URL de agora. Guarda o último site fora do login do Google e liga/desliga o `googleRecusou` da vista (a
   * recusa do Google "pode não ser seguro"), que a conversa mostra com "Trazer do meu Chrome".
   */
  function notarUrl(est: Estado, url: string): void {
    const host = /^https?:/iu.test(url) ? hostDe(url) : "";
    if (host && !ehLoginDoGoogle(host)) est.siteAntesDoGoogle = host;
    const recusou = googleRecusouOLogin(url) ? { site: est.siteAntesDoGoogle ?? "" } : null;
    const agora = est.vista.googleRecusou ?? null;
    if (recusou?.site !== agora?.site || (recusou === null) !== (agora === null)) mudar(est, { googleRecusou: recusou });
  }

  /** O erro do cartão de login: o pedido volta a "escolher" com a frase (a da máquina, quando ela diz o que fazer). */
  function erroNoLogin(est: Estado, decisaoId: string, causa: string, frase?: string): void {
    const p = est.vista.pedido;
    if (p?.tipo !== "login" || p.decisaoId !== decisaoId) return;
    mudar(est, { pedido: { ...p, etapa: "escolher", erro: frase ?? (causa === "indisponivel" ? textos(est.escopo).aparelhoDesligado : ERRO_LOGIN[causa] ?? ERRO_LOGIN.acao_falhou!) } });
  }

  /** Depois de preencher: a trava do segredo (L3) e o pedido fechado com a frase para o bot (sem valor nenhum). */
  async function depoisDePreencher(est: Estado, decisaoId: string, url: string, r: { usuario: boolean; senha: boolean }): Promise<void> {
    const site = siteLegivel(hostDe(url));
    if (r.senha) { est.urlDoSegredo = url; mudar(est, { segredoNaPagina: true }); }
    await fecharPedido(est, decisaoId, r.senha ? LOGIN_PREENCHIDO(site) : SO_USUARIO(site));
  }

  /** As rotas da pessoa e o canal ao vivo: o bot tem de ser dela (o estado em memória não basta para quem chega primeiro). */
  async function conferirDona(escopo: Escopo, agenteId: string): Promise<void> {
    const agente = await o.dentro(escopo, (d) => d.repos.agentes.buscar(agenteId));
    if (!agente || agente.ownerId !== escopo.pessoaId) throw new ErroDeDominio("nao_encontrado");
  }

  /** O que só a pessoa no controle faz (a barra de endereço, as abas, recarregar). */
  function exigirPessoa(est: Estado): MotorNavegador {
    if (est.vista.controle !== "pessoa") throw new ErroDeDominio("estado_invalido", { cause: "assuma_primeiro" });
    return exigirVivo(est);
  }
  function exigirVivo(est: Estado): MotorNavegador {
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
    est.refs = null; est.refsPorTamanho = false;
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
    est.refs = null; est.refsPorTamanho = false;
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
        notarUrl(c.est, r.url);
        // 2026-11-22 (teste do dono, IMDb): o firewall passa por uma página de conferência que se recarrega sozinha; o
        // abrir voltava sem título e a leitura seguinte vinha vazia ("0 elementos"). Espera a página assentar (até 5 s).
        let titulo = r.titulo;
        for (let i = 0; !titulo && i < 5; i++) {
          await new Promise((ok) => setTimeout(ok, msCarregar));
          const t = await m.avaliar(s, "document.readyState === 'complete' ? document.title : ''").catch(() => null);
          if (typeof t === "string" && t.trim()) titulo = t.trim();
        }
        await atualizarAbas(c);
        return { conteudo: { ok: true, url: r.url, titulo, instrucao: c.est.vista.googleRecusou ? GOOGLE_RECUSOU(siteLegivel(c.est.vista.googleRecusou.site) || null) : "Leia a página (navegador_ler) antes de agir." } };
      }
      case "navegador_ler": {
        const l = await m.ler(s, { soInterativos: args.so_interativos !== false, ...(typeof args.dentro === "string" && args.dentro ? { dentro: args.dentro } : {}) });
        c.est.refs = l.refs;
        c.est.refsPorTamanho = false;
        if (l.url) { c.est.url = l.url; notarUrl(c.est, l.url); }
        const referencias = Object.keys(l.refs).length;
        const vazia = referencias === 0 ? { instrucao: "Nenhum elemento lido: a página pode estar carregando. Espere uns segundos e leia de novo; para o texto da página, leia com so_interativos=false." } : {};
        const recusa = c.est.vista.googleRecusou ? { instrucao: GOOGLE_RECUSOU(siteLegivel(c.est.vista.googleRecusou.site) || null) } : {};
        return { conteudo: { url: l.url || c.est.url, referencias, arvore: redigirArvore(l.arvore), ...vazia, ...recusa } };
      }
      case "navegador_clicar": await m.clicar(s, alvo, args.duplo === true); break;
      case "navegador_preencher":
      case "navegador_digitar": {
        if (alvoSecreto(c.est, alvo)) return { conteudo: { erro: "campo_protegido", instrucao: "Este campo é de senha, código ou cartão: você nunca o preenche. Use navegador_entrar (login) ou navegador_pedir_ajuda (código, cartão)." }, isError: true };
        if (ferramenta === "navegador_preencher") await m.preencher(s, alvo, String(args.texto ?? ""));
        else await m.digitar(s, alvo, String(args.texto ?? ""));
        c.est.ultimoTexto = { url: c.est.url, texto: String(args.texto ?? "") };
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
      c.est.refs = null; c.est.refsPorTamanho = false;
      await atualizarAbas(c);
    } else {
      // Clicar ou apertar uma tecla pode navegar: a URL de agora diz se as referências ainda valem.
      const url = await m.url(s).catch(() => c.est.url);
      if (url !== c.est.url) { c.est.refs = null; c.est.refsPorTamanho = false; c.est.url = url; notarUrl(c.est, url); }
    }
    if (c.est.vista.googleRecusou) return { conteudo: { ok: true, url: c.est.url, instrucao: GOOGLE_RECUSOU(siteLegivel(c.est.vista.googleRecusou.site) || null) } };
    return { conteudo: { ok: true, url: c.est.url, ...(c.est.refs ? {} : { instrucao: "A página mudou: leia de novo (navegador_ler) antes do próximo passo." }) } };
  }

  /** A3: o destino que o bot disse aparece na página (texto do corpo ou título da aba)? */
  async function destinoVisto(c: Contexto, para: string): Promise<string | null> {
    const s = sessao(c.plano.agenteId);
    const [texto, titulo] = await Promise.all([c.motor.texto(s).catch(() => ""), c.motor.obter(s, "titulo").catch(() => "")]);
    return destinoNaPagina(para, texto.slice(0, TEXTO_MAX), typeof titulo === "string" ? titulo : "");
  }

  /** A1: a caixa do botão na página, para a web desenhar o realce azul fora da imagem (só com ref da leitura). */
  async function caixaDoAlvo(c: Contexto, alvo: unknown): Promise<CaixaNavegador | null> {
    if (typeof alvo !== "string" || !ehRef(alvo)) return null;
    const b = obj(await c.motor.obter(sessao(c.plano.agenteId), "caixa", alvo).catch(() => null));
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const [x, y, w, h] = [n(b.x), n(b.y), n(b.w), n(b.h)];
    return x !== null && y !== null && w !== null && h !== null && w > 0 && h > 0 ? { x, y, w, h } : null;
  }

  /** A vista acompanha o passo: a frase da linha de atividade e "ao vivo"; a falha deixa a vista viva. */
  async function comPasso<T>(c: Contexto, ferramenta: string, alvo: AlvoResolvido | null, fn: () => Promise<T>, caixa: CaixaNavegador | null = null): Promise<T> {
    const passo: PassoNavegador = { tipo: tipoDoPasso(ferramenta), frase: fraseDoPasso(ferramenta, alvo?.nome ?? null, hostDe(c.est.url) || null), caixa, em: agora() };
    c.est.ultimoPasso = passo;
    c.est.turnoId = c.plano.turnoId;
    // D2 C: com o alvo na tela, o cursor com o nome vai até ele e o anel verde aparece 300 ms antes do clique.
    if (caixa && passo.tipo === "clicar" && msMirar > 0) {
      mudar(c.est, { passo: { ...passo, tipo: "mirar" }, atividadeEm: agora() });
      await new Promise((ok) => setTimeout(ok, msMirar));
      passo.em = agora();
    }
    mudar(c.est, { passo, atividadeEm: agora() });
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
    // A3: o destino do envio só vale se aparece na página (texto ou título da aba); o que o bot diz sozinho não libera.
    const destino = classe === "enviar" && typeof args.para === "string" ? await destinoVisto(c, args.para) : null;
    // definido em 2026-11-20 (ADR-115 fica de fora): o revisor do Automático roda sobre itens de conector, em três fases com
    // a fila do executor e o assentamento (`revisar-acao.ts`); o clique do navegador não é item de conector e o efeito
    // roda no portão. Ligar os dois pede um item de revisão próprio do navegador — trabalho de outra etapa. Até lá, no
    // automático o envio para destino novo passa como sem revisor (o manual pede; o liberado antes passa).
    const d = decidirNoNavegador({ modo: c.modo, classe, host, rotulo: alvo?.nome ?? "", destino, liberacoes: c.liberacoes, revisorLigado: false });
    if (d.tipo === "pessoa_faz") return { recusa: PESSOA_FAZ };
    if (d.tipo === "pede") {
      const pergunta = perguntaDaAcao(d.classe, alvo?.nome ?? ferramenta, host, destino);
      // ADR-177 (definido em 2026-11-20): a web do nod não tem o fluxo de passkey (WebAuthn) pronto; pagar pede o Touch ID
      // no app do Mac (`systemPreferences.promptTouchID`, pela fila da máquina) na hora de executar, por qualquer caminho
      // que a aprovação venha. Sem o app conectado, vale a confirmação comum, e o cartão diz isso (AVISO_SEM_TOUCH_ID).
      const comMac = d.touchId && (o.mac?.maquina(c.escopo) ?? null) !== null;
      const lembrar = d.podeLembrar && destino ? { host, destino } : null;
      const acao: AcaoPendente = { agenteId: c.plano.agenteId, turnoId: c.plano.turnoId, ferramenta, argumentos: args, ...(d.touchId ? { touchId: true, pergunta: pergunta.replace(/\?$/, "") } : {}), ...(lembrar ? { lembrar } : {}) };
      const caixa = await caixaDoAlvo(c, args.alvo);
      const r = await o.dentro(c.escopo, async (dd) => {
        const pedido = await aprovar(dd, { turnoId: c.plano.turnoId, agenteId: c.plano.agenteId, conversaId: c.plano.conversaId, resumo: "Ação no navegador do bot", itens: [{ texto: pergunta, destino: { conector: "navegador", ferramenta: "executar", argumentos: { acaoId: randomUUID(), acao: o.cifrar(JSON.stringify(acao)) } } }] });
        if (pedido.events?.length) await dd.repos.events.gravarComOutbox(pedido.events);
        return pedido.data;
      });
      if (r.estado === "recusada") return { recusa: { erro: "recusada", erros: r.erros, instrucao: r.instrucao } };
      if (r.estado !== "pendente") throw new ErroDeDominio("estado_invalido");
      mudar(c.est, { controle: "precisa_de_voce", pedido: {
        tipo: "aprovacao", decisaoId: r.decisao_id, pergunta, botao: (alvo?.nome ?? "").slice(0, 80), classe: d.classe,
        touchId: comMac, avisoTouchId: d.touchId && !comMac ? textos(c.escopo).avisoSemConfirmacao : null, caixa,
        lembrar: lembrar ? { padrao: true, texto: textoDoLembrar(lembrar.destino) } : null,
        citacao: citacaoDoEnvio(c.est, d.classe),
      } });
      return { aguardar: r.decisao_id };
    }
    // O campo protegido (senha, código, cartão) não leva caixa: o efeito recusa sem tocar nele.
    const caixa = FERRAMENTAS_COM_ALVO_NA_TELA.has(ferramenta) && typeof args.alvo === "string" && !alvoSecreto(c.est, args.alvo) ? await caixaDoAlvo(c, args.alvo) : null;
    return { saida: await comPasso(c, ferramenta, alvo, () => efeito(c, ferramenta, args), caixa) };
  }

  /** A3: o que vai ser enviado, para a pessoa ler no cartão — o último texto que o bot preencheu nesta mesma página. */
  function citacaoDoEnvio(est: Estado, classe: string): string | null {
    const t = est.ultimoTexto;
    if (classe !== "enviar" || !t || t.url !== est.url) return null;
    const limpo = t.texto.replace(/\s+/g, " ").trim();
    return limpo ? (limpo.length > CITACAO_MAX ? `${limpo.slice(0, CITACAO_MAX - 1)}…` : limpo) : null;
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

  /**
   * L1: o cartão "A Ada precisa entrar no Itaú". O site para casar os cofres é o da aba (a página onde o login vai), ou o
   * que o bot disse quando a aba ainda não abriu nada; o preenchimento confere de novo que a aba não mudou de site.
   */
  /** O pedido de ajuda (captcha, código, app do banco): a fala na conversa e o navegador com a pessoa (borda azul). */
  async function pedirAjuda(d: Deps, plano: Pick<PlanoTurno, "turnoId" | "agenteId" | "conversaId">, est: Estado, motivo: string, codigo: boolean) {
    // L4: o código de uso único entra pelo campo privado do cartão, nunca pelo chat (o pedido não aceita texto).
    const p = await (codigo ? perguntarSemTexto : perguntar)(d, { turnoId: plano.turnoId, agenteId: plano.agenteId, conversaId: plano.conversaId, tipo: "pergunta", texto: codigo ? FALA_DO_CODIGO(motivo) : FALA_DA_AJUDA(motivo) });
    if (p.events?.length) await d.repos.events.gravarComOutbox(p.events);
    // definido em 2026-11-20 (teste do dono): quem pede ajuda já entrega o navegador. A pessoa clica, rola e digita na hora,
    // sem um passo de "assumir"; a borda segue azul porque há pedido aberto, e devolver retoma o turno.
    mudar(est, { controle: "pessoa", passo: null, pedido: { tipo: "ajuda", decisaoId: p.data.decisao_id, motivo, codigo }, atividadeEm: agora() });
    return p.data;
  }

  /**
   * Depois de um passo que pode mostrar um CAPTCHA: se a página mostra um, o nod entrega o navegador à pessoa. Uma vez por
   * URL (devolvido na mesma página, o bot segue). Visto, confere de novo depois de `msDesafio`: o que passa sozinho some.
   */
  async function conferirDesafio(c: Contexto, saida: Saida): Promise<void> {
    if (c.est.urlDoSegredo) return;
    const s = sessao(c.plano.agenteId);
    const ver = async () => { const r = await c.motor.avaliar(s, DETECTAR_DESAFIO).catch(() => null); return typeof r === "string" && r ? r : null; };
    if (!(await ver())) return;
    const url = await c.motor.url(s).catch(() => c.est.url);
    if (url && url === c.est.desafioEm) return;
    if (msDesafio > 0) { await new Promise((ok) => setTimeout(ok, msDesafio)); if (!(await ver())) return; }
    if (!botPodeAgir(c.est.vista.controle)) return;
    c.est.desafioEm = url || null;
    const host = hostDe(url) || "o site";
    const p = await o.dentro(c.escopo, (d) => pedirAjuda(d, c.plano, c.est, `${host} pede para provar que é gente (CAPTCHA). Resolva na tela e devolva para mim.`, false));
    saida.conteudo = { ...saida.conteudo, desafio_humano: true, pedido: p, instrucao: INSTRUCAO_DO_DESAFIO };
  }

  async function pedirLogin(escopo: Escopo, plano: PlanoTurno, est: Estado, site: string, motivo: string): Promise<ResultadoChamada> {
    const daAba = /^https?:/i.test(est.url) ? hostDe(est.url) : "";
    const host = daAba || hostDoSite(site);
    // Prova real (2026-11-20): o modelo passou a URL inteira ("https://…/login") e o cartão dizia "precisa entrar no
    // https://…/login". Com esquema ou caminho, o cartão e a fala ficam com o domínio; um nome solto ("Itaú") fica.
    site = /[:/]/.test(site) ? hostDoSite(site) || site : site;
    const { opcoes, podeTrazerDoChrome } = await montarOpcoes(escopo, plano.agenteId, host);
    return o.dentro(escopo, async (d) => {
      const texto = FALA_DO_LOGIN(site, motivo);
      const p = await perguntarSemTexto(d, { turnoId: plano.turnoId, agenteId: plano.agenteId, conversaId: plano.conversaId, tipo: "pergunta", texto });
      if (p.events?.length) await d.repos.events.gravarComOutbox(p.events);
      est.loginHost = host || null;
      // definido em 2026-11-20 (teste do dono): o pedido de login já entrega o navegador à pessoa. O cartão segue com o
      // cofre, o 1Password e o Bitwarden; se ela digitar na página, a captura (L5) já está ligada para o "Guardar no cofre?".
      if (host) comecarCaptura(est, host); else limparCaptura(est);
      mudar(est, { controle: "pessoa", atividadeEm: agora(), passo: null, pedido: { tipo: "login", decisaoId: p.data.decisao_id, site, motivo, opcoes, podeTrazerDoChrome, etapa: "escolher", erro: null } });
      return { ok: true, conteudo: JSON.stringify(p.data), confianca: "confiavel" };
    });
  }

  /**
   * A2: o combinado de antemão. O bot diz o que vai fazer e o teto (ou o destino); a pessoa responde uma vez, e a resposta
   * grava em `liberacoes` (o teto por site, o destino por site). "Me pergunte antes" = recusar: nada é gravado. O teto de
   * dinheiro também passa pelo Touch ID (ADR-177).
   */
  async function combinar(d: Deps, escopo: Escopo, plano: PlanoTurno, est: Estado, args: Record<string, unknown>): Promise<ResultadoChamada> {
    const host = hostDoSite(String(args.site ?? "")) || (/^https?:/i.test(est.url) ? hostDe(est.url) : "");
    const ateCentavos = typeof args.ate_valor_centavos === "number" && Number.isSafeInteger(args.ate_valor_centavos) && args.ate_valor_centavos > 0 ? args.ate_valor_centavos : null;
    const destino = typeof args.destino === "string" && args.destino.trim() ? args.destino.replace(/\s+/g, " ").trim().slice(0, 120) : null;
    if (!host || (ateCentavos === null && destino === null)) return resposta({ erro: "combinado_incompleto", instrucao: "Diga o site (domínio, como tap.pt) e o teto em centavos (ate_valor_centavos) ou o destino do envio (destino)." }, true);
    const t = textoDoCombinar({ host, oQue: String(args.o_que ?? ""), ateCentavos, destino });
    const acao: AcaoPendente = { tipo: "combinar", agenteId: plano.agenteId, turnoId: plano.turnoId, host, ateCentavos, destino, touchId: ateCentavos !== null, pergunta: t.titulo };
    const pedido = await aprovar(d, { turnoId: plano.turnoId, agenteId: plano.agenteId, conversaId: plano.conversaId, resumo: t.texto, itens: [{ texto: t.titulo, destino: { conector: "navegador", ferramenta: "executar", argumentos: { acaoId: randomUUID(), acao: o.cifrar(JSON.stringify(acao)) } } }] });
    if (pedido.events?.length) await d.repos.events.gravarComOutbox(pedido.events);
    if (pedido.data.estado === "recusada") return resposta({ erro: "recusada", erros: pedido.data.erros, instrucao: pedido.data.instrucao }, true);
    if (pedido.data.estado !== "pendente") throw new ErroDeDominio("estado_invalido");
    mudar(est, { controle: "precisa_de_voce", passo: null, pedido: { tipo: "combinar", decisaoId: pedido.data.decisao_id, titulo: t.titulo, texto: t.texto, sim: t.sim, nao: t.nao, touchId: ateCentavos !== null && (o.mac?.maquina(escopo) ?? null) !== null } });
    return { aguardar: pedido.data.decisao_id };
  }

  /** O pedido aberto para a pessoa já foi respondido (ou venceu): o controle volta ao bot. */
  async function pedidoResolvido(d: Deps, est: Estado): Promise<boolean> {
    if ((est.vista.controle !== "precisa_de_voce" && est.vista.controle !== "pessoa") || !est.vista.pedido) return false;
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
      type Entrar = { entrar: { est: Estado; site: string; motivo: string } };
      const r = await o.dentro(escopo, async (d): Promise<ResultadoChamada | Entrar | Contexto & { ferramenta: NomeFerramentaNavegador; args: Record<string, unknown> }> => {
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
        est.turnoId = plano.turnoId;
        const lugar = await decidirLugar(d, est);
        if (lugar.tipo === "espera") {
          let instrucao = lugar.instrucao;
          if (lugar.motivo === "aparelho_desligado" && !cartoesDaEspera.has(plano.turnoId)) {
            cartoesDaEspera.add(plano.turnoId);
            if (cartoesDaEspera.size > 500) { const velho = cartoesDaEspera.values().next().value; if (velho) cartoesDaEspera.delete(velho); }
            instrucao = (await (o.cartaoDaEspera ?? cartaoDaEspera)(d, plano)) ?? instrucao;
          }
          return { ok: true, isError: true, conteudo: JSON.stringify({ erro: "espera", instrucao }), confianca: "confiavel" };
        }
        const motor = motorDe(est);
        if (!motor) return { ok: true, isError: true, conteudo: JSON.stringify({ erro: "indisponivel", instrucao: `${o.motivoIndisponivel ?? "O navegador do bot não está ligado neste servidor."} Nada foi executado; siga com o que dá sem ele e diga em uma frase o que ficou de fora.` }), confianca: "confiavel" };
        const agente = await d.repos.agentes.buscar(plano.agenteId);
        if (agente?.soLeitura === true && !PERMITIDAS_EM_SO_LEITURA.has(ferramenta)) return negar("capacidade_desligada");
        if (await pedidoResolvido(d, est)) mudar(est, { controle: "bot", pedido: null });
        // 2026-11-22 (teste do dono): a mensagem nova da pessoa, mandada depois de ela assumir à mão, devolve o navegador —
        // como a mensagem nova já dispensa o pedido de login e de ajuda (ADR-191). Só o turno da conversa (a mensagem dela);
        // a retomada de um turno antigo não tira o navegador da mão dela.
        if (est.vista.controle === "pessoa" && !est.vista.pedido && !est.gravacao && est.assumidoEm !== null) {
          const turno = await d.repos.turnos.buscar(plano.turnoId);
          if (turno?.origem === "conversa" && turno.criadoEm > est.assumidoEm) soltarDaPessoa(est);
        }
        if (!botPodeAgir(est.vista.controle)) {
          if (est.vista.controle === "pessoa" && !est.vista.pedido) {
            est.turnoEsperando = plano.turnoId;
            return { ok: true, conteudo: JSON.stringify(PESSOA_NO_CONTROLE), confianca: "confiavel" };
          }
          return { ok: true, conteudo: JSON.stringify(AGUARDANDO_PESSOA), confianca: "confiavel" };
        }
        // L1: o cartão de login monta as opções fora da transação (o Mac pode levar uns segundos para listar o cofre).
        if (ferramenta === "navegador_entrar") return { entrar: { est, site: String(args.site).slice(0, 300), motivo: String(args.motivo).slice(0, 300) } };
        if (ferramenta === "navegador_pedir_ajuda") {
          const p = await pedirAjuda(d, plano, est, String(args.motivo).slice(0, 300), args.codigo === true);
          return { ok: true, conteudo: JSON.stringify(p), confianca: "confiavel" };
        }
        if (ferramenta === "navegador_combinar") return combinar(d, escopo, plano, est, argsDaFerramenta);
        const modo = modoNoTurno(agente?.modoAprovacao, plano.autoria) ?? "manual";
        const liberacoes = await d.repos.navegadorPreferencias.liberacoes(plano.agenteId);
        return { escopo, plano, est, motor, modo, liberacoes, ferramenta, args: argsDaFerramenta };
      });
      if ("entrar" in r) return pedirLogin(escopo, plano, r.entrar.est, r.entrar.site, r.entrar.motivo);
      if (!("est" in r)) return r;
      if (!(await vaga(r.est))) return { ok: true, conteudo: JSON.stringify(NA_FILA), confianca: "confiavel" };
      // O bot voltou a mexer depois de terminar (D3, 5): a vista volta ao vivo.
      if (r.est.vista.estado === "terminou") mudar(r.est, { estado: "ao_vivo", atividadeEm: agora() });
      try {
        if (r.ferramenta === "navegador_rodar_script") return await script(r, Array.isArray(r.args.passos) ? r.args.passos : []);
        const desfecho = await passo(r, r.ferramenta, r.args);
        if ("saida" in desfecho && desfecho.saida.isError !== true && CONFEREM_DESAFIO.has(r.ferramenta)) await conferirDesafio(r, desfecho.saida);
        return comoResultado(desfecho);
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
    async executarAprovado(p: Escopo & { agenteId: string; turnoId: string; acaoId: string; acao: string; lembrar?: boolean }): Promise<void> {
      const acao = JSON.parse(o.decifrar(p.acao)) as AcaoPendente;
      if (acao.agenteId !== p.agenteId || acao.turnoId !== p.turnoId || (acao.tipo !== "combinar" && !Object.hasOwn(FERRAMENTAS_NAVEGADOR, acao.ferramenta))) throw new ErroDeDominio("nao_permitido");
      const escopo = { tenantId: p.tenantId, pessoaId: p.pessoaId };
      const guardarResultado = (conteudo: unknown) => {
        if (resultados.size >= RESULTADOS_MAX) resultados.delete(resultados.keys().next().value!);
        resultados.set(p.acaoId, { pessoaId: p.pessoaId, cifrado: o.cifrar(JSON.stringify(conteudo)) });
      };
      const plano = await o.dentro(escopo, async (d) => {
        if (!await turnoPermitido(d, p.turnoId, p.agenteId, true)) throw new ErroDeDominio("nao_permitido");
        const t = await d.repos.turnos.buscar(p.turnoId);
        return { turnoId: p.turnoId, agenteId: p.agenteId, conversaId: t?.conversaId ?? "" };
      });
      const devolverAoBot = () => {
        const e = estados.get(p.agenteId);
        if (e && e.escopo.pessoaId === p.pessoaId && e.escopo.tenantId === p.tenantId && e.vista.controle !== "pessoa") mudar(e, { controle: "bot", pedido: null });
      };
      // A1/A2 (ADR-177): dinheiro passa pelo Touch ID do Mac antes de qualquer efeito; recusado, nada roda.
      if (acao.touchId && o.mac) {
        const t = await o.mac.touchId(escopo, p.agenteId, acao.pergunta ?? "Confirmar o pagamento");
        if (t === "recusado") {
          guardarResultado({ erro: "touch_id_recusado", instrucao: "A pessoa não confirmou no Touch ID. Nada foi pago nem combinado; não tente de novo sem ela pedir." });
          devolverAoBot();
          throw new ErroDeDominio("nao_permitido", { cause: "touch_id_recusado" });
        }
      }
      if (acao.tipo === "combinar") {
        // A2: a resposta "Pode" grava o teto (ou o destino) do site; o bot segue sem perguntar de novo dentro dele.
        await o.dentro(escopo, async (d) => {
          const atual = await d.repos.navegadorPreferencias.liberacoes(p.agenteId);
          const nova = juntarLiberacoes(atual, { ...(acao.ateCentavos !== null ? { pagar: { host: acao.host, ateCentavos: acao.ateCentavos } } : {}), ...(acao.destino ? { enviar: { host: acao.host, destino: acao.destino } } : {}) });
          if (!(await d.repos.navegadorPreferencias.gravar(p.agenteId, { liberacoes: nova }, d.agora()))) throw new ErroDeDominio("nao_encontrado");
        });
        devolverAoBot();
        guardarResultado({ ok: true, combinado: { site: acao.host, ...(acao.ateCentavos !== null ? { ate_valor_centavos: acao.ateCentavos } : {}), ...(acao.destino ? { destino: acao.destino } : {}) }, instrucao: "Combinado. Dentro do teto (ou para este destino) você segue sem perguntar; valor acima ou destino diferente pergunta de novo." });
        return;
      }
      const est = estadoDe(escopo, p.agenteId);
      if (est.vista.controle === "pessoa") throw new ErroDeDominio("nao_permitido");
      mudar(est, { controle: "bot", pedido: null });
      const motor = motorDe(est);
      const guardar = guardarResultado;
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
        // A3: "Não perguntar de novo para o Pedro" — só o destino que o servidor viu na página, nunca dinheiro.
        const lembrar = acao.lembrar;
        if (p.lembrar === true && lembrar) {
          await o.dentro(escopo, async (d) => {
            const atual = await d.repos.navegadorPreferencias.liberacoes(p.agenteId);
            await d.repos.navegadorPreferencias.gravar(p.agenteId, { liberacoes: juntarLiberacoes(atual, { enviar: lembrar }) }, d.agora());
          }).catch((e: unknown) => log("aviso", "navegador_lembrar_falhou", { agente_id: p.agenteId, erro: e instanceof Error ? e.name : "desconhecido" }));
        }
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
    /**
     * ADR-191 no navegador (ponto 02 dos cenários de 2026-11-22): a mensagem nova da pessoa dispensou estes pedidos (login,
     * código, ajuda). A vista solta o pedido e o navegador volta à Ada: o cartão vira linha, o painel deixa de dizer
     * "Precisa de você" e a barra lateral sai de "Aguardando você". Assumido à mão sem pedido, fica com a pessoa.
     */
    pedidosDispensados(escopo: Escopo, decisaoIds: readonly string[]): void {
      const ids = new Set(decisaoIds);
      for (const est of estados.values()) {
        if (est.escopo.pessoaId !== escopo.pessoaId || est.escopo.tenantId !== escopo.tenantId || !est.vista.pedido || !ids.has(est.vista.pedido.decisaoId)) continue;
        est.assumidoEm = null;
        est.entradaPessoaEm = null;
        est.turnoEsperando = null;
        limparCaptura(est);
        // O pedido só se dispensa com o turno que pediu já acabado (seguir-conversando.ts): a vista vai a "terminou".
        const terminou = est.vivo && est.vista.estado === "ao_vivo" && !est.gravacao;
        if (terminou) est.turnoId = null;
        mudar(est, { controle: "bot", pedido: null, devolveEm: null, atividadeEm: agora(), ...(terminou ? { estado: "terminou" as const, passo: est.ultimoPasso } : {}) });
      }
    },
    /**
     * Ponto 10 dos cenários (2026-11-22): o turno que mexeu por último acabou (o frame turno.encerrado/interrompido). A vista
     * vai a "terminou" na hora, com o último passo: a aba e a tela cheia deixam de dizer "ao vivo" e "lendo…". Com pedido,
     * com a pessoa ou gravando, nada muda (como no varredor, marcarTerminados).
     */
    turnoAcabou(pessoaId: string, turnoId: string): void {
      for (const est of estados.values()) {
        if (est.escopo.pessoaId !== pessoaId || est.turnoId !== turnoId || !est.vivo || est.vista.estado !== "ao_vivo" || est.vista.controle !== "bot" || est.vista.pedido || est.gravacao) continue;
        est.turnoId = null;
        mudar(est, { estado: "terminou", passo: est.ultimoPasso });
      }
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
    async desligar(escopo: Escopo, agenteId: string, o2: { apagarPerfil?: boolean } = {}): Promise<void> {
      const est = estados.get(agenteId);
      if (o2.apagarPerfil) {
        // O bot excluído: o perfil do lugar "nod" sai do disco mesmo sem estado na memória (o servidor reiniciou).
        if (est && est.escopo.pessoaId !== escopo.pessoaId) return;
        const motor = est ? motorDe(est) : o.motor({ tipo: "nod" }, escopo);
        if (est?.vivo) await motor?.fechar(sessao(agenteId)).catch(() => undefined);
        if (est) { est.vivo = false; mudar(est, { estado: "desligado", passo: null, abas: [] }); estados.delete(agenteId); }
        if (motor?.lugar.tipo === "nod") await motor.apagarPerfil?.(sessao(agenteId));
        return;
      }
      if (!est || est.escopo.pessoaId !== escopo.pessoaId) return;
      est.vivo = false;
      est.refs = null; est.refsPorTamanho = false;
      await motorDe(est)?.fechar(sessao(agenteId));
      mudar(est, { estado: "desligado", passo: null, abas: [] });
    },
    /** Ponto 09 dos cenários (2026-11-22): o espaço do navegador do bot no disco do nod (null = noutro lugar ou sem perfil). */
    async espaco(escopo: Escopo, agenteId: string): Promise<number | null> {
      await conferirDona(escopo, agenteId);
      const motor = o.motor({ tipo: "nod" }, escopo);
      return motor?.espaco ? motor.espaco(sessao(agenteId)) : null;
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
        // Prova real (2026-11-20): assumir depois de o bot terminar deixava a vista em "terminou", e a pessoa mexia na
        // página com o quadro esmaecido (opacidade .55). Com ela no controle a imagem é ao vivo.
        est.assumidoEm = agora();
        est.entradaPessoaEm = agora();
        mudar(est, { controle: "pessoa", atividadeEm: agora(), ...(est.vista.estado === "terminou" ? { estado: "ao_vivo" as const } : {}) });
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
        const esperando = soltarDaPessoa(est);
        if (pedido && pedido.tipo !== "aprovacao") await (o.retomarPedido ?? retomarDoPedido)(escopo, pedido.decisaoId, RETOMADA[op]);
        else if (!pedido && esperando) await retomarDevolvido(escopo, esperando, false);
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
        est.refs = null; est.refsPorTamanho = false;
        est.abasGuardadas = [];
        await motorDe(est)?.fechar(sessao(agenteId));
        est.assumidoEm = null; est.entradaPessoaEm = null; est.turnoEsperando = null;
        mudar(est, { estado: "desligado", passo: null, abas: [], devolveEm: null, controle: est.vista.controle === "pessoa" ? "bot" : est.vista.controle });
        return est.vista;
      }
      // Recarregar vale assistindo (D1c: "Recarregar e copiar funcionam assistindo, sem assumir"); voltar é da barra no
      // controle (D2 B). A leitura do bot cai nos dois: a referência velha ouve "leia de novo".
      const motor = op === "recarregar" ? exigirVivo(est) : exigirPessoa(est);
      marcarEntrada(est);
      await motor.historico(sessao(agenteId), op === "voltar" ? "voltar" : "recarregar").catch((e: unknown) => { throw ehFalhaNavegador(e) ? new ErroDeDominio("estado_invalido", { cause: "acao_falhou" }) : e; });
      est.refs = null; est.refsPorTamanho = false;
      return est.vista;
    },
    /** POST /agentes/:id/navegador/endereco: a pessoa no controle digita na barra (a mesma validação do portão). */
    async irPara(escopo: Escopo, agenteId: string, url: string): Promise<VistaNavegador> {
      await conferirDona(escopo, agenteId);
      const est = estadoDe(escopo, agenteId);
      if (!enderecoPermitido(url)) throw new ErroDeDominio("entrada_invalida", { cause: "endereco_recusado" });
      const motor = exigirPessoa(est);
      marcarEntrada(est);
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
      marcarEntrada(est);
      const abas = await motor.abas(sessao(agenteId));
      if (!abas.some((a) => a.id === aba)) throw new ErroDeDominio("nao_encontrado", { cause: "aba" });
      await motor.abaTrocar(sessao(agenteId), aba);
      await atualizarAbasDe(est, motor);
      return est.vista;
    },
    /**
     * POST /agentes/:id/navegador/ensinar (T). Começar só com a pessoa no controle; salvar grava a tarefa e manda, em nome
     * dela, "Ensinei: <nome>." com `passos-gravados (N passos).txt` na conversa do bot (o turno normal do bot vem dessa mensagem).
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
        await mandar(d, { agenteId, texto: mensagemDoEnsinado(nomeFinal), arquivo: { nome: nomeDoArquivoDosPassos(g), conteudo: arquivoDosPassos(nomeFinal, g) } });
        return t;
      });
      est.gravacao = null;
      est.parou = null;
      est.campo = null;
      mudar(est, { gravacao: null });
      return { vista: est.vista, tarefa };
    },
    /**
     * POST /agentes/:id/navegador/login (L1, L2). Cofre do nod: o servidor decifra e preenche na hora. 1Password/Bitwarden:
     * o app do Mac lê (o 1Password pede o Touch ID sozinho) e preenche lá, se o navegador roda nele, ou devolve ao
     * servidor, que preenche; a resposta já volta com "Confirme no seu Mac" e o preenchimento segue em segundo plano.
     * "chrome": os cookies do site no Chrome da pessoa (o macOS pede o Keychain). "eu_mesmo": o controle vai para ela.
     * A página tem de estar no mesmo site de quando o cartão foi montado.
     */
    async escolherLogin(escopo: Escopo, agenteId: string, decisaoId: string, escolha: EscolhaLoginNavegador): Promise<{ vista: VistaNavegador; aviso: string | null }> {
      await conferirDona(escopo, agenteId);
      const est = estadoDe(escopo, agenteId);
      const pedido = await pedidoAberto(escopo, est, decisaoId, ["login"] as const);
      if (est.loginEmCurso) throw new ErroDeDominio("estado_invalido", { cause: "login_em_curso" });
      if (escolha === "eu_mesmo") {
        comecarCaptura(est, est.loginHost ?? hostDoSite(pedido.site));
        mudar(est, { controle: "pessoa", pedido: { ...pedido, etapa: "eu_mesmo", erro: null }, atividadeEm: agora() });
        return { vista: est.vista, aviso: null };
      }
      const { motor, url } = await motorAberto(est);
      const host = hostDe(url);
      if (!est.loginHost || !host || !itemCasaComHost(host, est.loginHost)) { erroNoLogin(est, decisaoId, "site_mudou"); throw new ErroDeDominio("estado_invalido", { cause: "site_mudou" }); }
      const s = sessao(agenteId);
      if (escolha !== "chrome" && escolha.fonte === "nod") {
        const item = await o.dentro(escopo, (d) => d.repos.cofreLogins.paraPreencher(escolha.ref));
        if (!item || !itemCasaComHost(item.site, host)) throw new ErroDeDominio("nao_encontrado", { cause: "login" });
        let r: { usuario: boolean; senha: boolean };
        try {
          r = await preencherLogin(motor, s, { usuario: item.usuario, senha: o.decifrar(item.senhaCifrada) });
        } catch (e) {
          if (!ehFalhaNavegador(e)) throw e;
          erroNoLogin(est, decisaoId, e.motivo);
          throw new ErroDeDominio("estado_invalido", { cause: "nao_preencheu" });
        }
        await depoisDePreencher(est, decisaoId, url, r);
        return { vista: est.vista, aviso: null };
      }
      const mac = o.mac;
      const macId = mac?.maquina(escopo) ?? null;
      if (!mac || !macId) { erroNoLogin(est, decisaoId, "indisponivel"); throw new ErroDeDominio("estado_invalido", { cause: "precisa_do_mac" }); }
      // O navegador roda neste mesmo Mac: o segredo e os cookies não saem dele.
      const noMac = est.vista.lugar.tipo === "mac" && o.maquinaDoLugar?.(est.vista.lugar, escopo) === macId;
      mudar(est, { pedido: { ...pedido, etapa: "confirme_no_mac", erro: null } });
      est.loginEmCurso = (async () => {
        try {
          if (escolha === "chrome") {
            let n = 0;
            if (noMac) n = Number(await mac.cookies(escopo, agenteId, host, true));
            else {
              const cookies = await mac.cookies(escopo, agenteId, host, false);
              if (typeof cookies !== "number" && cookies.length) {
                await motor.definirCookies(s, cookies);
                await motor.historico(s, "recarregar");
                n = cookies.length;
              }
            }
            if (!n) { erroNoLogin(est, decisaoId, "sem_cookies"); return; }
            est.refs = null; est.refsPorTamanho = false;
            await fecharPedido(est, decisaoId, DO_CHROME(siteLegivel(host), n));
            return;
          }
          const fonte = escolha.fonte === "1password" ? "1password" : "bitwarden";
          const r = noMac
            ? await mac.preencher(escopo, agenteId, fonte, escolha.ref, host)
            : await preencherLogin(motor, s, await mac.ler(escopo, agenteId, fonte, escolha.ref, host));
          await depoisDePreencher(est, decisaoId, url, r);
        } catch (e) {
          // A máquina ligada diz o que fazer com o Chrome (instalar a extensão, fechar o Chrome): a frase vai ao cartão.
          const daMaquina = escolha === "chrome" && ehFalhaNavegador(e) && e.motivo === "indisponivel" && mac.maquina(escopo) ? fraseDaMaquina(e.detalhe) : undefined;
          erroNoLogin(est, decisaoId, ehFalhaNavegador(e) ? e.motivo : "acao_falhou", daMaquina);
          if (!ehFalhaNavegador(e)) log("aviso", "navegador_login_falhou", { agente_id: agenteId, erro: e instanceof Error ? e.name : "desconhecido" });
        } finally {
          est.loginEmCurso = null;
        }
      })();
      return { vista: est.vista, aviso: textos(escopo).confirmeNoAparelho };
    },
    /**
     * POST /agentes/:id/navegador/trazer-do-chrome (2026-11-23, o ⋯ e a recusa do Google): a sessão de um site do Chrome da
     * pessoa para o navegador do bot, sem pedido de login aberto. O site é o pedido, o de origem da recusa do Google ou o da
     * aba. Na recusa, o navegador volta ao site; senão, recarrega. Um pedido de login ou de ajuda aberto fecha com a frase do
     * Chrome e o bot segue. A espera é a do aparelho (o macOS pede o Keychain); a resposta diz o que aconteceu, em uma frase.
     */
    async trazerDoChrome(escopo: Escopo, agenteId: string, site?: string): Promise<{ vista: VistaNavegador; trazidos: number; aviso: string }> {
      await conferirDona(escopo, agenteId);
      const est = estadoDe(escopo, agenteId);
      if (est.loginEmCurso) throw new ErroDeDominio("estado_invalido", { cause: "login_em_curso" });
      const { motor, url } = await motorAberto(est);
      const recusa = est.vista.googleRecusou ?? null;
      const host = site ? hostDoSite(site) : recusa?.site ? hostDoSite(recusa.site) : /^https?:/iu.test(url) ? hostDe(url) : "";
      if (!host) throw new ErroDeDominio("estado_invalido", { cause: "sem_site" });
      const mac = o.mac;
      const macId = mac?.maquina(escopo) ?? null;
      if (!mac || !macId) throw new ErroDeDominio("estado_invalido", { cause: "precisa_do_mac" });
      const noMac = est.vista.lugar.tipo === "mac" && o.maquinaDoLugar?.(est.vista.lugar, escopo) === macId;
      const s = sessao(agenteId);
      const nome = siteLegivel(host);
      let n = 0;
      const trazer = (async () => {
        if (noMac) { n = Number(await mac.cookies(escopo, agenteId, host, true)); return; }
        const cookies = await mac.cookies(escopo, agenteId, host, false);
        if (typeof cookies !== "number" && cookies.length) { await motor.definirCookies(s, cookies); n = cookies.length; }
      })();
      est.loginEmCurso = trazer.catch(() => undefined);
      try {
        await trazer;
      } catch (e) {
        if (!ehFalhaNavegador(e)) throw e;
        const frase = e.motivo === "indisponivel" && mac.maquina(escopo) ? fraseDaMaquina(e.detalhe) : undefined;
        return { vista: est.vista, trazidos: 0, aviso: frase ?? (e.motivo === "indisponivel" ? textos(escopo).aparelhoDesligado : ERRO_LOGIN[e.motivo] ?? ERRO_LOGIN.acao_falhou!) };
      } finally {
        est.loginEmCurso = null;
      }
      if (!n) return { vista: est.vista, trazidos: 0, aviso: CHROME_SEM_SESSAO(nome) };
      // Na recusa do Google (ou noutro site), a página de agora não é do site: o navegador vai a ele, já com a sessão.
      if (!itemCasaComHost(hostDe(url), host)) await motor.abrir(s, `https://${host}/`, false).catch(() => undefined);
      else await motor.historico(s, "recarregar").catch(() => undefined);
      est.refs = null; est.refsPorTamanho = false;
      await atualizarAbasDe(est, motor);
      const p = est.vista.pedido;
      if (p && (p.tipo === "login" || p.tipo === "ajuda")) await fecharPedido(est, p.decisaoId, DO_CHROME(nome, n)).catch(() => undefined);
      return { vista: est.vista, trazidos: n, aviso: TROUXE_DO_CHROME(nome) };
    },
    /** Só testes: espera o preenchimento em segundo plano (L2) terminar. */
    esperarLogin: async (agenteId: string): Promise<void> => { await estados.get(agenteId)?.loginEmCurso; },
    /**
     * POST /agentes/:id/navegador/codigo (L4): o código vai do campo privado do cartão direto para o campo de código da
     * página (ou o focado), como digitação pelo relay; nunca para a conversa, a trilha, o log ou o bot. O pedido fecha com
     * "Código enviado" e o bot segue.
     */
    async enviarCodigo(escopo: Escopo, agenteId: string, decisaoId: string, codigo: string): Promise<VistaNavegador> {
      await conferirDona(escopo, agenteId);
      if (!codigoValido(codigo)) throw new ErroDeDominio("entrada_invalida", { cause: "codigo" });
      const est = estadoDe(escopo, agenteId);
      await pedidoAberto(escopo, est, decisaoId, ["ajuda", "login"] as const);
      const { motor, url } = await motorAberto(est);
      try {
        await inserirCodigo(motor, sessao(agenteId), codigo);
      } catch (e) {
        if (!ehFalhaNavegador(e)) throw e;
        throw new ErroDeDominio("estado_invalido", { cause: "nao_preencheu" });
      }
      est.urlDoSegredo = url;
      mudar(est, { segredoNaPagina: true });
      await fecharPedido(est, decisaoId, CODIGO_ENVIADO);
      return est.vista;
    },
    /**
     * POST /agentes/:id/navegador/guardar-login (L5): guarda (cofre do nod cifrado; 1Password ou Bitwarden pelo app do Mac)
     * ou descarta o login que a pessoa digitou. Nos dois casos o texto sai da memória.
     */
    async guardarLogin(escopo: Escopo, agenteId: string, guardar: boolean, destino: FonteCofre): Promise<VistaNavegador> {
      await conferirDona(escopo, agenteId);
      const est = estadoDe(escopo, agenteId);
      const c = capturaViva(est);
      const oferta = est.vista.ofertaGuardar;
      const senhaCifrada = c?.senha;
      if (!c || !senhaCifrada || !oferta) throw new ErroDeDominio("estado_invalido", { cause: "sem_oferta" });
      if (!guardar) { limparCaptura(est); return est.vista; }
      if (!oferta.destinos.includes(destino)) throw new ErroDeDominio("estado_invalido", { cause: destino === "nod" ? "sem_oferta" : "precisa_do_mac" });
      const usuario = c.usuario ? o.decifrar(c.usuario) : "";
      const site = c.host.replace(/^www\./, "");
      if (destino === "nod") {
        // A senha já está cifrada com a chave do servidor (a mesma do cofre): vai ao banco sem voltar a texto.
        await o.dentro(escopo, (d) => d.repos.cofreLogins.criar({ site, usuario, senhaCifrada }));
      } else {
        const mac = o.mac;
        if (!mac?.maquina(escopo)) throw new ErroDeDominio("estado_invalido", { cause: "precisa_do_mac" });
        await mac.guardar(escopo, agenteId, destino, site, usuario, o.decifrar(senhaCifrada)).catch((e: unknown) => { throw ehFalhaNavegador(e) ? new ErroDeDominio("estado_invalido", { cause: "nao_guardou" }) : e; });
      }
      limparCaptura(est);
      return est.vista;
    },
    /**
     * A área da vista de quem assiste (o `{t:"tamanho"}` do canal ao vivo, emenda de 2026-11-20 da ADR-190): o Chrome do
     * bot passa a `viewportDeQuemAssiste`. Sem Chrome vivo, fica guardado para quando ele ligar; sem ninguém assistindo, o
     * último fica.
     */
    tamanho(escopo: Escopo, agenteId: string, area: { w: number; h: number }): void {
      let est: Estado;
      try { est = estadoDe(escopo, agenteId); } catch { return; }
      est.tamanho.pedido = viewportDeQuemAssiste(area);
      void aplicarTamanho(est);
    },
    /** Só testes: espera a troca de tamanho em curso. */
    esperarTamanho: async (agenteId: string): Promise<void> => { for (let i = 0; i < 50 && estados.get(agenteId)?.tamanho.mudando; i++) await new Promise((r) => setTimeout(r, 2)); },
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
      if (!est || est.vista.controle !== "pessoa" || est.escopo.pessoaId !== escopo.pessoaId) return;
      marcarEntrada(est);
      const captura = capturaViva(est);
      const capturando = captura !== null && !captura.ofertada ? captura : null;
      if (!est.gravacao && !capturando) return;
      const motor = motorDe(est);
      if (!motor) return;
      const s = sessao(agenteId);
      if (e.t === "mouse") {
        if (e.evento !== "mousePressed") return;
        const el = await motor.descreverElemento(s, { x: e.x, y: e.y }).catch(() => null);
        if (capturando) capturando.campo = campoDoLogin(el);
        if (!est.gravacao) return;
        if (el?.editavel) { est.campo = campoDoElemento(el, campoEhSecreto); return; }
        est.campo = null;
        const clique = eventoDoClique(el);
        if (clique) registrar(est, clique);
        return;
      }
      if (e.t !== "tecla") return;
      if (e.evento === "keyDown" && e.tecla === "Enter") { if (est.gravacao) registrar(est, { tipo: "tecla", tecla: "Enter" }); return; }
      if (e.evento === "keyDown" && e.tecla === "Tab") { est.campo = null; if (capturando) capturando.campo = null; return; }
      // L5: a tecla no campo de usuário ou de senha do login dela (o campo focado, se o clique não disse qual).
      if (capturando && e.evento !== "keyUp") {
        if (!capturando.campo) capturando.campo = campoDoLogin(await motor.descreverElemento(s, null).catch(() => null));
        if (capturando.campo) capturar(est, capturando.campo, e);
      }
      if (!est.gravacao || !entradaDigita(e)) return;
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
