import type { Dinheiro } from "../contracts/assistente.ts";
import { MAX_CARTOES, type CartaoRico, type PontoNoMapa } from "../contracts/ferramentas-cartoes.ts";
import { semInvisiveis } from "./acoes-do-modo.ts";
import type { Validacao } from "./assistente.ts";
import { formatarDinheiro } from "./pagamento.ts";

/**
 * Os cartões ricos (ADR-173): o que o bot mandou em `mostrar_cartoes` vira `CartaoRico[]` limpo, ou a frase do que
 * corrigir. Tudo é dado não confiável (o bot pode ter copiado de uma página): texto sem invisíveis e cortado, número
 * finito e no intervalo, data no formato, link só `https:` sem usuário/senha. A web escapa tudo e nunca carrega nada de
 * fora (o mapa é desenhado com os números, sem tiles). Puro.
 */
const TEXTO_MAX = 120;
const RESUMO_MAX = 200;
const PONTOS_MAX = 12;
const DIAS_MAX = 10;
const ITENS_MAX = 30;
const PREVIA_MAX = 6;

class Invalido extends Error {}
const falhar = (m: string): never => { throw new Invalido(m); };

function txt(o: Record<string, unknown>, k: string, onde: string, obrigatorio = true): string | undefined {
  const v = o[k];
  if (v === undefined || v === null || v === "") return obrigatorio ? falhar(`${onde}: falta ${k}`) : undefined;
  if (typeof v !== "string") return falhar(`${onde}: ${k} tem de ser texto`);
  const l = semInvisiveis(v);
  if (!l) return obrigatorio ? falhar(`${onde}: falta ${k}`) : undefined;
  return l.length > TEXTO_MAX ? `${l.slice(0, TEXTO_MAX - 1).trimEnd()}…` : l;
}
function num(o: Record<string, unknown>, k: string, onde: string, min: number, max: number, obrigatorio = true, inteiro = false): number | undefined {
  const v = o[k];
  if (v === undefined || v === null) return obrigatorio ? falhar(`${onde}: falta ${k}`) : undefined;
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max || (inteiro && !Number.isInteger(v))) return falhar(`${onde}: ${k} tem de ser número${inteiro ? " inteiro" : ""} de ${min} a ${max}`);
  return v;
}
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const DATA_HORA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
function data(o: Record<string, unknown>, k: string, onde: string, re: RegExp = DATA): string {
  const v = txt(o, k, onde) ?? "";
  return re.test(v) ? v : falhar(`${onde}: ${k} tem de ser ${re === DATA ? "AAAA-MM-DD" : "AAAA-MM-DDTHH:MM"}`);
}
function dinheiro(o: Record<string, unknown>, k: string, onde: string, obrigatorio = false): Dinheiro | undefined {
  const v = o[k];
  if (v === undefined || v === null) return obrigatorio ? falhar(`${onde}: falta ${k}`) : undefined;
  if (typeof v !== "object" || Array.isArray(v)) return falhar(`${onde}: ${k} tem de ser {centavos, moeda}`);
  const d = v as Record<string, unknown>;
  const centavos = num(d, "centavos", `${onde}.${k}`, 0, 1e11, true, true) ?? 0;
  const moeda = typeof d.moeda === "string" && /^[A-Z]{3}$/.test(d.moeda) ? d.moeda : falhar(`${onde}: ${k}.moeda tem de ser o código de 3 letras (BRL)`);
  return { centavos, moeda };
}
/**
 * Só `https:` e sem usuário/senha na URL: o cartão abre o link num toque, e um `javascript:` ou `http:` não tem vez. Sem
 * `URL` (o domínio não tem os globais do Node nem do navegador): o host é letras, números, ponto e hífen, a porta opcional,
 * e o resto sem espaço, aspas nem sinais de tag.
 */
export function linkSeguro(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length <= 2048 && /^https:\/\/[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?::\d{1,5})?(?:[/?#][^\s"'<>`\\]*)?$/.test(t) ? t : undefined;
}
function lista(o: Record<string, unknown>, k: string, onde: string, max: number): Record<string, unknown>[] {
  const v = o[k];
  if (!Array.isArray(v) || v.length === 0) return falhar(`${onde}: ${k} tem de ser uma lista com pelo menos um item`);
  if (v.length > max) return falhar(`${onde}: ${k} tem no máximo ${max} itens`);
  return v.map((x, i) => (typeof x === "object" && x !== null && !Array.isArray(x) ? (x as Record<string, unknown>) : falhar(`${onde}: ${k}[${i}] tem de ser um objeto`)));
}
const com = <T extends object>(base: T, extra: Record<string, unknown>): T => ({ ...base, ...Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== undefined)) });

function umCartao(c: Record<string, unknown>, i: number): CartaoRico {
  const onde = `cartoes[${i}]`;
  switch (c.tipo) {
    case "voo":
      return com({ tipo: "voo" as const, companhia: txt(c, "companhia", onde) ?? "", numero: txt(c, "numero", onde) ?? "", origem: txt(c, "origem", onde) ?? "", destino: txt(c, "destino", onde) ?? "", partida: data(c, "partida", onde, DATA_HORA), chegada: data(c, "chegada", onde, DATA_HORA), paradas: num(c, "paradas", onde, 0, 5, true, true) ?? 0 }, { preco: dinheiro(c, "preco", onde), link: linkSeguro(c.link) });
    case "hotel":
      return com({ tipo: "hotel" as const, nome: txt(c, "nome", onde) ?? "", endereco: txt(c, "endereco", onde) ?? "", entrada: data(c, "entrada", onde), saida: data(c, "saida", onde) }, { nota: num(c, "nota", onde, 0, 10, false), diaria: dinheiro(c, "diaria", onde), link: linkSeguro(c.link) });
    case "carro":
      return com({ tipo: "carro" as const, locadora: txt(c, "locadora", onde) ?? "", modelo: txt(c, "modelo", onde) ?? "", local: txt(c, "local", onde) ?? "", retirada: data(c, "retirada", onde), devolucao: data(c, "devolucao", onde) }, { total: dinheiro(c, "total", onde), link: linkSeguro(c.link) });
    case "mapa": {
      const pontos: PontoNoMapa[] = lista(c, "pontos", onde, PONTOS_MAX).map((p, j) => com({ nome: txt(p, "nome", `${onde}.pontos[${j}]`) ?? "", lat: num(p, "lat", `${onde}.pontos[${j}]`, -90, 90) ?? 0, lng: num(p, "lng", `${onde}.pontos[${j}]`, -180, 180) ?? 0 }, { endereco: txt(p, "endereco", onde, false), nota: num(p, "nota", onde, 0, 10, false) }));
      return { tipo: "mapa", titulo: txt(c, "titulo", onde) ?? "", pontos };
    }
    case "clima":
      return { tipo: "clima", local: txt(c, "local", onde) ?? "", dias: lista(c, "dias", onde, DIAS_MAX).map((d, j) => ({ data: data(d, "data", `${onde}.dias[${j}]`), minimaC: num(d, "minimaC", `${onde}.dias[${j}]`, -90, 60) ?? 0, maximaC: num(d, "maximaC", `${onde}.dias[${j}]`, -90, 60) ?? 0, chuvaPct: num(d, "chuvaPct", `${onde}.dias[${j}]`, 0, 100) ?? 0, resumo: txt(d, "resumo", `${onde}.dias[${j}]`) ?? "" })) };
    case "carrinho": {
      const itens = lista(c, "itens", onde, ITENS_MAX).map((it, j) => ({ nome: txt(it, "nome", `${onde}.itens[${j}]`) ?? "", quantidade: num(it, "quantidade", `${onde}.itens[${j}]`, 1, 999, true, true) ?? 1, unitario: dinheiro(it, "unitario", `${onde}.itens[${j}]`, true) ?? { centavos: 0, moeda: "BRL" } }));
      const estado = c.estado === "aguardando_passkey" || c.estado === "pago" ? c.estado : c.estado === undefined || c.estado === "aberto" ? "aberto" : falhar(`${onde}: estado é aberto, aguardando_passkey ou pago`);
      return com({ tipo: "carrinho" as const, itens, total: dinheiro(c, "total", onde, true) ?? { centavos: 0, moeda: "BRL" }, estado }, { loja: txt(c, "loja", onde, false) });
    }
    case "arquivo": {
      const formato = c.formato === "pdf" || c.formato === "planilha" ? c.formato : falhar(`${onde}: formato é pdf ou planilha`);
      const bruta = c.previa;
      const previa = Array.isArray(bruta) ? bruta.slice(0, PREVIA_MAX).map((l) => (Array.isArray(l) ? l.slice(0, PREVIA_MAX).map((x) => (typeof x === "string" || typeof x === "number" ? semInvisiveis(String(x)).slice(0, 40) : "")) : [])) : undefined;
      return com({ tipo: "arquivo" as const, formato, nome: txt(c, "nome", onde) ?? "" }, { paginas: num(c, "paginas", onde, 1, 100_000, false, true), previa: formato === "planilha" ? previa : undefined, link: linkSeguro(c.link) });
    }
    default:
      return falhar(`${onde}: tipo é voo, hotel, carro, mapa, clima, carrinho ou arquivo`);
  }
}

export function normalizarCartoes(args: { resumo?: unknown; cartoes?: unknown }): Validacao<{ resumo: string; cartoes: CartaoRico[] }> {
  try {
    const resumo = typeof args.resumo === "string" ? semInvisiveis(args.resumo).slice(0, RESUMO_MAX) : "";
    if (!resumo) return { ok: false, motivo: "falta resumo. Corrija e chame mostrar_cartoes de novo." };
    const brutos = lista({ cartoes: args.cartoes }, "cartoes", "mostrar_cartoes", MAX_CARTOES);
    return { ok: true, valor: { resumo, cartoes: brutos.map(umCartao) } };
  } catch (e) {
    if (e instanceof Invalido) return { ok: false, motivo: `${e.message}. Corrija e chame mostrar_cartoes de novo.` };
    throw e;
  }
}

/** Uma linha por cartão, para quem não desenha cartões (notificação, busca, celular antigo) e para o histórico do modelo. */
export function textoDosCartoes(resumo: string, cartoes: readonly CartaoRico[]): string {
  const linha = (c: CartaoRico): string => {
    switch (c.tipo) {
      case "voo": return `Voo ${c.companhia} ${c.numero}: ${c.origem} → ${c.destino}, ${c.partida.replace("T", " ")}${c.preco ? `, ${formatarDinheiro(c.preco)}` : ""}`;
      case "hotel": return `Hotel ${c.nome}, ${c.entrada} a ${c.saida}${c.diaria ? `, ${formatarDinheiro(c.diaria)} a diária` : ""}`;
      case "carro": return `Carro ${c.modelo} (${c.locadora}), ${c.retirada} a ${c.devolucao}${c.total ? `, ${formatarDinheiro(c.total)}` : ""}`;
      case "mapa": return `Mapa: ${c.titulo} (${c.pontos.map((p) => p.nome).join(", ")})`;
      case "clima": return `Tempo em ${c.local}: ${c.dias.map((d) => `${d.data} ${Math.round(d.minimaC)}–${Math.round(d.maximaC)} °C`).join("; ")}`;
      case "carrinho": return `Carrinho: ${c.itens.length} ${c.itens.length === 1 ? "item" : "itens"}, ${formatarDinheiro(c.total)}`;
      case "arquivo": return `${c.formato === "pdf" ? "PDF" : "Planilha"}: ${c.nome}`;
    }
  };
  return [resumo, ...cartoes.map((c) => `- ${linha(c)}`)].join("\n");
}
