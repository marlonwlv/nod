/**
 * O erro do cliente REST e a classificação da falha (definido em 2026-10-13, NOD-215). Separado de api.ts para o reducer
 * e os testes (tsconfig do servidor, sem DOM) importarem sem puxar `fetch`/`XMLHttpRequest`.
 */
/** NOD-174: quando o servidor não manda frase (proxy, corpo vazio), a pessoa lê isto — nunca "falha" solta. */
export const FALHA_SEM_FRASE = "Algo deu errado. Tente de novo; se repetir, relate o problema.";
/** NOD-215: a falha de transporte diz a causa — nunca mais "confira a conexão" para um servidor reiniciando. */
export const FRASE_SEM_INTERNET = "Seu dispositivo está sem internet. Assim que voltar, tentamos de novo.";
export const FRASE_SERVIDOR_INDISPONIVEL = "O servidor está reiniciando. Tentamos de novo sozinhos.";
/**
 * 2026-11-19: o GET que estourou o prazo (PRAZO_GET_MS) não é servidor fora — o nod respondeu tarde. Dizer "reiniciando"
 * mandava a pessoa procurar um deploy que não houve. O código continua `servidor_indisponivel` (repete e reconecta igual).
 */
export const FRASE_SERVIDOR_DEMOROU = "O nod está demorando para responder. Tentamos de novo sozinhos.";
/** Proxy/balanceador respondendo no lugar do nod enquanto ele sobe (deploy): sem corpo do nod, é servidor fora. */
const STATUS_DE_PROXY = new Set([502, 503, 504]);

export class ErroApi extends Error {
  readonly status: number;
  readonly codigo: string;
  readonly correlationId: string | null;
  /** Método + caminho sem o tenant e sem query (NOD-215): vai para "Detalhes", nunca para a frase. */
  readonly rota: string | null;
  /** NOD-346: o porquê, quando o servidor manda um da lista branca (ex.: `reautenticar`); nunca vai para a frase. */
  motivo: string | null = null;
  /** NOD-408: prova de trabalho pública; não contém segredo nem dado pessoal. */
  desafio: string | null = null;
  bits: number | null = null;
  constructor(status: number, codigo: string, mensagem: string, correlationId: string | null = null, rota: string | null = null) {
    super(mensagem);
    this.name = "ErroApi";
    this.status = status;
    this.codigo = codigo;
    this.correlationId = correlationId;
    this.rota = rota;
  }
}

/** Navegação/troca de tela cancelou a chamada: não é falha, ninguém precisa de aviso. */
export const ehAbort = (e: unknown): boolean => typeof e === "object" && e !== null && (e as { name?: string }).name === "AbortError";

export function rotaDe(metodo: string, url: string): string {
  const caminho = (url.split("?")[0] ?? url).replace(/^\/api\/t\/[^/]+/, "");
  return `${metodo.toUpperCase()} ${caminho === "" ? "/" : caminho}`;
}

/** O prazo da leitura venceu (`AbortSignal.timeout`): o `fetch` rejeita com `TimeoutError`, não com `AbortError`. */
export const ehPrazoVencido = (e: unknown): boolean => typeof e === "object" && e !== null && (e as { name?: string }).name === "TimeoutError";

/**
 * O `fetch` rejeitou (ou o XHR deu onerror): o nod não respondeu. `onLine === false` é a única prova de sem internet;
 * `causa` é o que o `fetch` lançou — o prazo vencido diz que o nod demorou, não que caiu.
 */
export function falhaDeTransporte(rota: string, causa?: unknown): ErroApi {
  const semInternet = typeof navigator !== "undefined" && (navigator as { onLine?: boolean }).onLine === false;
  if (semInternet) return new ErroApi(0, "sem_internet", FRASE_SEM_INTERNET, null, rota);
  return new ErroApi(0, "servidor_indisponivel", ehPrazoVencido(causa) ? FRASE_SERVIDOR_DEMOROU : FRASE_SERVIDOR_INDISPONIVEL, null, rota);
}

/** Resposta de erro → ErroApi. 502/503/504 sem o corpo do nod viram servidor fora; com corpo, o código do servidor manda. */
export function erroDaResposta(status: number, lido: unknown, rota: string): ErroApi {
  const e = (typeof lido === "object" && lido !== null ? lido : {}) as { codigo?: string; mensagem?: string; correlation_id?: string | null; motivo?: unknown; desafio?: unknown; bits?: unknown };
  if (e.codigo === undefined && STATUS_DE_PROXY.has(status)) return new ErroApi(status, "servidor_indisponivel", FRASE_SERVIDOR_INDISPONIVEL, null, rota);
  const erro = new ErroApi(status, e.codigo ?? "falha_interna", e.mensagem ?? FALHA_SEM_FRASE, e.correlation_id ?? null, rota);
  if (typeof e.motivo === "string") erro.motivo = e.motivo;
  if (typeof e.desafio === "string" && e.desafio.length <= 200) erro.desafio = e.desafio;
  if (typeof e.bits === "number" && Number.isInteger(e.bits) && e.bits >= 1 && e.bits <= 30) erro.bits = e.bits;
  return erro;
}


/**
 * NOD-345 (revisão do PR 504): o app do Mac de antes não tem a ponte que troca a chave de máquina. Entrar numa conta por
 * ele deixaria a tela numa conta e o executor na outra; o pedido nem sai, e a pessoa é chamada a atualizar o app.
 */
export class AppDesatualizado extends Error {
  constructor() {
    super("app sem a ponte de troca de conta");
    this.name = "AppDesatualizado";
  }
}

/**
 * ADA-4 (revisão 9 do #646): o servidor recusou pela regra (4xx): tentar o mesmo falha igual. A rede (status 0), o 5xx,
 * o 408 e o 429 não são recusa: esses ganham o "Tentar de novo".
 */
export function ehRecusaDoServidor(e: unknown): boolean {
  return e instanceof ErroApi && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429;
}
