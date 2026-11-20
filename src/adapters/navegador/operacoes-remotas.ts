import { OPERACOES_MOTOR_NAVEGADOR, type OperacaoMotorNavegador } from "../../contracts/navegador-maquina.ts";
import type { ElementoNaPagina } from "../../domain/navegador-ensinar.ts";
import type { CookieNavegador } from "../../contracts/navegador-maquina.ts";
import { FalhaNavegador, type AbaMotor, type AlvoProcurar, type LeituraNavegador, type MotorNavegador, type RefLida, type SessaoNavegador } from "./motor-agent-browser.ts";

/**
 * As chamadas do `MotorNavegador` que atravessam a fila da máquina (ADR-190, decisão 5), dos dois lados:
 * - a máquina confere os argumentos de cada operação e chama o motor local (`executarOperacao`): nada além da lista e dos
 *   tipos de cada método chega ao agent-browser dela;
 * - o servidor confere a forma do que volta (`lerValor`) antes de o portão usar, como faria com a saída do processo local.
 * Sem nada do servidor: o app do Mac e o motor do Linux importam este arquivo.
 */

const obj = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export const ehOperacao = (v: unknown): v is OperacaoMotorNavegador => typeof v === "string" && (OPERACOES_MOTOR_NAVEGADOR as readonly string[]).includes(v);

/** definido em 2026-11-20: o texto de um argumento (alvo, texto, expressão) tem um teto; a página inteira vai por `texto`. */
const ARG_MAX = 64 * 1024;
const invalido = (op: string) => new FalhaNavegador("alvo_invalido", `argumentos inválidos para ${op}`);
function texto(op: string, v: unknown, vazio = true): string {
  if (typeof v !== "string" || v.length > ARG_MAX || (!vazio && v === "")) throw invalido(op);
  return v;
}
function talvezTexto(op: string, v: unknown): string | undefined {
  return v === undefined || v === null ? undefined : texto(op, v);
}
function numero(op: string, v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) > 1_000_000) throw invalido(op);
  return v;
}
function um<T extends string>(op: string, v: unknown, aceitos: readonly T[]): T {
  if (typeof v !== "string" || !(aceitos as readonly string[]).includes(v)) throw invalido(op);
  return v as T;
}
/** Só abre http(s) e about:blank na máquina da pessoa (o portão do servidor já recusou a rede de dentro). */
function url(op: string, v: unknown): string {
  const u = texto(op, v, false);
  if (u === "about:blank") return u;
  let p: URL;
  try { p = new URL(u); } catch { throw invalido(op); }
  if (p.protocol !== "http:" && p.protocol !== "https:") throw invalido(op);
  return u;
}
function textos(op: string, v: unknown): string[] {
  if (!Array.isArray(v) || v.length > 50) throw invalido(op);
  return v.map((x) => texto(op, x));
}

/** definido em 2026-11-20: um site com mais de 200 cookies é raro; o resto cai (o login costuma estar nos primeiros). */
export const COOKIES_MAX = 200;
const SAME_SITE = ["Strict", "Lax", "None"] as const;
/** Os cookies conferidos (forma do `CookieNavegador`); um fora da forma derruba o lote inteiro. */
export function lerCookies(op: string, v: unknown): CookieNavegador[] {
  if (!Array.isArray(v) || v.length > COOKIES_MAX) throw invalido(op);
  return v.map((c) => {
    const o = obj(c);
    const nome = texto(op, o.name, false);
    const valor = texto(op, o.value);
    const dominio = texto(op, o.domain, false);
    const caminho = typeof o.path === "string" && o.path.startsWith("/") ? texto(op, o.path) : "/";
    if (nome.length > 4096 || valor.length > 8192 || !/^\.?[a-z0-9.-]+$/i.test(dominio) || typeof o.expires !== "number" || !Number.isFinite(o.expires)) throw invalido(op);
    return { name: nome, value: valor, domain: dominio.toLowerCase(), path: caminho, expires: o.expires, secure: o.secure === true, httpOnly: o.httpOnly === true, sameSite: um(op, o.sameSite ?? "Lax", SAME_SITE) };
  });
}

/** A máquina: confere os argumentos da operação e chama o motor local. Falha de argumento é `alvo_invalido`. */
export async function executarOperacao(m: MotorNavegador, s: SessaoNavegador, op: OperacaoMotorNavegador, a: readonly unknown[]): Promise<unknown> {
  switch (op) {
    case "abrir": return m.abrir(s, url(op, a[0]), a[1] === true);
    case "ler": {
      const l = obj(a[0]);
      return m.ler(s, { ...(l.soInterativos === false ? { soInterativos: false } : {}), ...(typeof l.dentro === "string" && l.dentro ? { dentro: texto(op, l.dentro) } : {}) });
    }
    case "clicar": return m.clicar(s, texto(op, a[0], false), a[1] === true);
    case "preencher": return m.preencher(s, texto(op, a[0], false), texto(op, a[1]));
    case "digitar": return m.digitar(s, texto(op, a[0], false), texto(op, a[1]));
    case "tecla": return m.tecla(s, texto(op, a[0], false));
    case "rolar": {
      const r = obj(a[0]);
      return m.rolar(s, { ...(r.direcao !== undefined ? { direcao: um(op, r.direcao, ["cima", "baixo", "esquerda", "direita"] as const) } : {}), ...(r.pixels !== undefined ? { pixels: numero(op, r.pixels) } : {}), ...(r.alvo !== undefined ? { alvo: texto(op, r.alvo, false) } : {}) });
    }
    case "esperar": {
      const e = obj(a[0]);
      return m.esperar(s, { ...(e.alvo !== undefined ? { alvo: texto(op, e.alvo, false) } : {}), ...(e.texto !== undefined ? { texto: texto(op, e.texto) } : {}), ...(e.ms !== undefined ? { ms: numero(op, e.ms) } : {}) });
    }
    case "print": return m.print(s, { paginaInteira: obj(a[0]).paginaInteira === true });
    case "texto": return m.texto(s, talvezTexto(op, a[0]));
    case "obter": return m.obter(s, um(op, a[0], ["url", "titulo", "valor", "atributo", "html", "quantos", "caixa"] as const), talvezTexto(op, a[1]), talvezTexto(op, a[2]));
    case "estilos": return m.estilos(s, texto(op, a[0], false));
    case "selecionar": return m.selecionar(s, texto(op, a[0], false), textos(op, a[1]));
    case "marcar": return m.marcar(s, texto(op, a[0], false), a[1] === true);
    case "passarMouse": return m.passarMouse(s, texto(op, a[0], false));
    case "arrastar": return m.arrastar(s, texto(op, a[0], false), texto(op, a[1], false));
    case "mouse": {
      const p = obj(a[0]);
      return m.mouse(s, { acao: um(op, p.acao, ["mover", "clicar", "rolar"] as const), x: numero(op, p.x), y: numero(op, p.y), ...(p.delta !== undefined ? { delta: numero(op, p.delta) } : {}) });
    }
    case "historico": return m.historico(s, um(op, a[0], ["voltar", "avancar", "recarregar"] as const));
    case "abas": return m.abas(s);
    case "abaNova": return m.abaNova(s, a[0] === undefined || a[0] === null ? undefined : url(op, a[0]));
    case "abaTrocar": return m.abaTrocar(s, texto(op, a[0], false));
    case "abaFechar": return m.abaFechar(s, talvezTexto(op, a[0]));
    case "quadro": return m.quadro(s, a[0] === null ? null : texto(op, a[0], false));
    case "dialogo": return m.dialogo(s, a[0] === true, talvezTexto(op, a[1]));
    case "baixar": return m.baixar(s, texto(op, a[0], false), texto(op, a[1], false));
    case "enviarArquivo": return m.enviarArquivo(s, texto(op, a[0], false), textos(op, a[1]));
    case "pdf": return m.pdf(s, texto(op, a[0], false));
    case "procurar": {
      const p = obj(a[0]);
      const alvo: AlvoProcurar = { por: um(op, p.por, ["papel", "texto", "rotulo", "placeholder"] as const), valor: texto(op, p.valor), acao: um(op, p.acao, ["clicar", "preencher", "passar_mouse"] as const), ...(p.texto !== undefined ? { texto: texto(op, p.texto) } : {}), ...(p.nome !== undefined ? { nome: texto(op, p.nome) } : {}) };
      return m.procurar(s, alvo);
    }
    case "avaliar": return m.avaliar(s, texto(op, a[0], false));
    case "focado": return m.focado(s);
    case "descreverElemento": {
      if (a[0] === null) return m.descreverElemento(s, null);
      const p = obj(a[0]);
      return m.descreverElemento(s, { x: numero(op, p.x), y: numero(op, p.y) });
    }
    case "url": return m.url(s);
    case "fechar": return m.fechar(s);
    case "camposDeLogin": return m.camposDeLogin(s);
    case "inserirTexto": {
      const t = texto(op, a[1], false);
      if (t.length > 4096) throw invalido(op);
      return m.inserirTexto(s, a[0] === null ? null : texto(op, a[0], false), t);
    }
    case "definirCookies": return m.definirCookies(s, lerCookies(op, a[0]));
    case "tamanho": {
      // definido em 2026-11-20: o portão manda de 800 a 1440 de largura e até 2400 de altura; a máquina aceita 320–4096.
      const w = numero(op, a[0]);
      const h = numero(op, a[1]);
      if (!Number.isInteger(w) || !Number.isInteger(h) || w < 320 || h < 200 || w > 4096 || h > 4096) throw invalido(op);
      return m.tamanho(s, w, h);
    }
  }
}

const vazio = (): undefined => undefined;
function refLida(v: unknown): RefLida | null {
  const r = obj(v);
  return typeof r.papel === "string" ? { papel: r.papel.slice(0, 200), nome: str(r.nome).slice(0, 500) } : null;
}
const LEITORES: { [K in OperacaoMotorNavegador]: (v: unknown) => unknown } = {
  abrir: (v) => ({ url: str(obj(v).url), titulo: str(obj(v).titulo) }),
  ler: (v): LeituraNavegador => {
    const l = obj(v);
    const refs: Record<string, RefLida> = {};
    for (const [k, r] of Object.entries(obj(l.refs))) { const x = refLida(r); if (/^e\d+$/.test(k) && x) refs[k] = x; }
    return { url: str(l.url), arvore: str(l.arvore), refs };
  },
  clicar: vazio, preencher: vazio, digitar: vazio, tecla: vazio, rolar: vazio, esperar: vazio, selecionar: vazio, marcar: vazio, passarMouse: vazio,
  arrastar: vazio, mouse: vazio, historico: vazio, abaNova: vazio, abaTrocar: vazio, abaFechar: vazio, quadro: vazio, dialogo: vazio, enviarArquivo: vazio,
  procurar: vazio, fechar: vazio, inserirTexto: vazio, definirCookies: vazio, tamanho: vazio,
  camposDeLogin: (v) => ({ usuario: obj(v).usuario === true, senha: obj(v).senha === true, codigo: obj(v).codigo === true }),
  print: (v) => {
    const jpeg = str(obj(v).jpeg);
    if (!/^\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(jpeg)) throw new FalhaNavegador("acao_falhou", "o print da máquina veio sem imagem");
    return { jpeg };
  },
  texto: str, url: str,
  obter: (v) => v ?? null,
  avaliar: (v) => v ?? null,
  estilos: (v) => Object.fromEntries(Object.entries(obj(v)).filter(([, x]) => typeof x === "string")),
  abas: (v): AbaMotor[] => (Array.isArray(v) ? v.slice(0, 100).map(obj).filter((a) => typeof a.id === "string").map((a) => ({ id: str(a.id), titulo: str(a.titulo), url: str(a.url), ativa: a.ativa === true })) : []),
  baixar: (v) => ({ nome: str(obj(v).nome), bytes: num(obj(v).bytes) }),
  pdf: (v) => ({ nome: str(obj(v).nome), bytes: num(obj(v).bytes) }),
  focado: refLida,
  descreverElemento: (v): ElementoNaPagina | null => {
    const r = obj(v);
    if (typeof r.papel !== "string") return null;
    return { papel: r.papel, nome: str(r.nome), rotulo: str(r.rotulo), tipo: typeof r.tipo === "string" ? r.tipo : null, autocomplete: typeof r.autocomplete === "string" ? r.autocomplete : null, editavel: r.editavel === true };
  },
};

/** O servidor: a forma do que a máquina devolveu, como o motor local daria. */
export function lerValor(op: OperacaoMotorNavegador, v: unknown): unknown {
  return LEITORES[op](v);
}
