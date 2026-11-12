import type { FamiliaMac } from "../contracts/desktop-mac.ts";
import { CAPACIDADES_MAC, type NomeCapacidadeMac } from "../contracts/mac.ts";
import type { ResultadoSonda } from "../contracts/servicos.ts";

/**
 * ADR-171: a validação das ferramentas do Mac (pura). Nada malformado chega ao osascript: cada argumento é conferido
 * aqui e vira um valor de `argv` do script, nunca texto colado no código do script.
 */
export class ArgumentoMacInvalido extends Error {
  readonly campo: string;
  constructor(campo: string, mensagem: string) {
    super(mensagem);
    this.name = "ArgumentoMacInvalido";
    this.campo = campo;
  }
}

export function ehCapacidadeMac(nome: string): nome is NomeCapacidadeMac {
  return CAPACIDADES_MAC.some((c) => c.nome === nome);
}

export function familiaDaCapacidade(nome: NomeCapacidadeMac): FamiliaMac {
  const c = CAPACIDADES_MAC.find((x) => x.nome === nome);
  if (!c) throw new ArgumentoMacInvalido("capacidade", `capacidade desconhecida: ${nome}`);
  return c.familia;
}

export type ArgsMac =
  | { capacidade: "mail_ler" | "notas_ler"; busca: string; limite: number }
  | { capacidade: "mail_enviar"; para: string[]; assunto: string; corpo: string }
  | { capacidade: "notas_criar"; titulo: string; corpo: string }
  | { capacidade: "calendario_ler"; de: string; ate: string }
  | { capacidade: "calendario_criar"; titulo: string; inicio: string; fim: string; calendario: string }
  | { capacidade: "lembretes_ler"; lista: string }
  | { capacidade: "lembretes_criar"; titulo: string; lista: string; quando: string }
  | { capacidade: "contatos_buscar"; busca: string }
  | { capacidade: "imessage_ler"; limite: number }
  | { capacidade: "imessage_enviar"; para: string; texto: string }
  | { capacidade: "tela_ver" }
  | { capacidade: "tela_clicar"; x: number; y: number; botao: "esquerdo" | "direito"; vezes: 1 | 2 }
  | { capacidade: "tela_digitar"; texto: string }
  | { capacidade: "tela_tecla"; tecla: string; modificadores: ModificadorMac[] }
  | { capacidade: "tela_rolar"; x: number; y: number; delta: number };

export type ModificadorMac = "comando" | "shift" | "opcao" | "controle";
/** As teclas com nome e o key code do macOS (Carbon, kVK_*); letras e números vão pelo `keystroke`. */
export const TECLAS_MAC: Readonly<Record<string, number>> = { enter: 36, tab: 48, esc: 53, apagar: 51, espaco: 49, esquerda: 123, direita: 124, baixo: 125, cima: 126, home: 115, end: 119, pageup: 116, pagedown: 121 };
/** definido em 2026-11-12: 10.000 pontos cobre qualquer arranjo de monitores; fora disso é erro do modelo. */
const MAX_COORDENADA = 10_000;

const EMAIL = /^[^\s@<>"',;]{1,64}@[^\s@<>"',;]{1,190}\.[A-Za-z]{2,24}$/;
const E164 = /^\+[1-9]\d{7,14}$/;
/** definido em 2026-11-12: 31 dias é o teto do calendario_ler (um mês de agenda cabe no orçamento do turno). */
export const MAX_DIAS_CALENDARIO = 31;

function temControle(v: string): boolean {
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i);
    if ((c < 32 && c !== 9 && c !== 10 && c !== 13) || c === 127) return true;
  }
  return false;
}

function texto(a: Readonly<Record<string, unknown>>, campo: string, max: number, obrigatorio: boolean): string {
  const v = a[campo];
  if (v === undefined || v === null || v === "") {
    if (obrigatorio) throw new ArgumentoMacInvalido(campo, `${campo} é obrigatório`);
    return "";
  }
  if (typeof v !== "string") throw new ArgumentoMacInvalido(campo, `${campo} deve ser texto`);
  if (v.length > max) throw new ArgumentoMacInvalido(campo, `${campo} passa de ${max} caracteres`);
  // Caracteres de controle (menos quebra de linha e tab) não têm uso legítimo aqui.
  if (temControle(v)) throw new ArgumentoMacInvalido(campo, `${campo} tem caractere de controle`);
  return v;
}

function limite(a: Readonly<Record<string, unknown>>): number {
  const v = a["limite"];
  if (v === undefined || v === null) return 20;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 50) throw new ArgumentoMacInvalido("limite", "limite deve ser inteiro de 1 a 50");
  return v;
}

function data(a: Readonly<Record<string, unknown>>, campo: string, obrigatorio: boolean): string {
  const v = texto(a, campo, 40, obrigatorio);
  if (v === "") return "";
  if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?)?$/.test(v) || Number.isNaN(Date.parse(v))) throw new ArgumentoMacInvalido(campo, `${campo} deve ser data ISO 8601`);
  return v;
}

function coordenada(a: Readonly<Record<string, unknown>>, campo: string): number {
  const v = a[campo];
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > MAX_COORDENADA) throw new ArgumentoMacInvalido(campo, `${campo} deve ser inteiro de 0 a ${MAX_COORDENADA}`);
  return v;
}

export function validarArgsMac(capacidade: string, a: Readonly<Record<string, unknown>>): ArgsMac {
  switch (capacidade) {
    case "mail_ler":
    case "notas_ler":
      return { capacidade, busca: texto(a, "busca", 200, false), limite: limite(a) };
    case "mail_enviar": {
      const para = a["para"];
      if (!Array.isArray(para) || para.length === 0 || para.length > 10) throw new ArgumentoMacInvalido("para", "para deve ter de 1 a 10 e-mails");
      const lista = para.map((p) => (typeof p === "string" ? p.trim() : ""));
      if (lista.some((p) => !EMAIL.test(p))) throw new ArgumentoMacInvalido("para", "para tem endereço de e-mail inválido");
      return { capacidade, para: lista, assunto: texto(a, "assunto", 300, true), corpo: texto(a, "corpo", 20_000, true) };
    }
    case "notas_criar":
      return { capacidade, titulo: texto(a, "titulo", 200, true), corpo: texto(a, "corpo", 20_000, true) };
    case "calendario_ler": {
      const de = data(a, "de", true);
      const ate = data(a, "ate", true);
      const dias = (Date.parse(ate) - Date.parse(de)) / 86_400_000;
      if (dias < 0) throw new ArgumentoMacInvalido("ate", "ate deve ser depois de de");
      if (dias > MAX_DIAS_CALENDARIO) throw new ArgumentoMacInvalido("ate", `o intervalo passa de ${MAX_DIAS_CALENDARIO} dias`);
      return { capacidade, de, ate };
    }
    case "calendario_criar": {
      const inicio = data(a, "inicio", true);
      const fim = data(a, "fim", true);
      if (Date.parse(fim) < Date.parse(inicio)) throw new ArgumentoMacInvalido("fim", "fim deve ser depois do início");
      return { capacidade, titulo: texto(a, "titulo", 200, true), inicio, fim, calendario: texto(a, "calendario", 100, false) };
    }
    case "lembretes_ler":
      return { capacidade, lista: texto(a, "lista", 100, false) };
    case "lembretes_criar":
      return { capacidade, titulo: texto(a, "titulo", 300, true), lista: texto(a, "lista", 100, false), quando: data(a, "quando", false) };
    case "contatos_buscar":
      return { capacidade, busca: texto(a, "busca", 100, true) };
    case "imessage_ler":
      return { capacidade, limite: limite(a) };
    case "imessage_enviar": {
      const para = texto(a, "para", 120, true).trim();
      if (!E164.test(para) && !EMAIL.test(para)) throw new ArgumentoMacInvalido("para", "para deve ser telefone no formato +5511999999999 ou e-mail");
      return { capacidade, para, texto: texto(a, "texto", 4_000, true) };
    }
    case "tela_ver":
      return { capacidade };
    case "tela_clicar": {
      const botao = a["botao"] ?? "esquerdo";
      const vezes = a["vezes"] ?? 1;
      if (botao !== "esquerdo" && botao !== "direito") throw new ArgumentoMacInvalido("botao", "botao deve ser esquerdo ou direito");
      if (vezes !== 1 && vezes !== 2) throw new ArgumentoMacInvalido("vezes", "vezes deve ser 1 ou 2");
      return { capacidade, x: coordenada(a, "x"), y: coordenada(a, "y"), botao, vezes };
    }
    case "tela_digitar":
      return { capacidade, texto: texto(a, "texto", 2_000, true) };
    case "tela_tecla": {
      const tecla = texto(a, "tecla", 20, true).toLowerCase();
      if (!(tecla in TECLAS_MAC) && !/^[a-z0-9]$/.test(tecla)) throw new ArgumentoMacInvalido("tecla", "tecla desconhecida");
      const mods = a["modificadores"] ?? [];
      if (!Array.isArray(mods) || mods.length > 4 || mods.some((m) => m !== "comando" && m !== "shift" && m !== "opcao" && m !== "controle")) throw new ArgumentoMacInvalido("modificadores", "modificadores: comando, shift, opcao ou controle");
      return { capacidade, tecla, modificadores: [...new Set(mods as ModificadorMac[])] };
    }
    case "tela_rolar": {
      const d = a["delta"];
      if (typeof d !== "number" || !Number.isInteger(d) || d < -50 || d > 50 || d === 0) throw new ArgumentoMacInvalido("delta", "delta deve ser inteiro de -50 a 50, sem zero");
      return { capacidade, x: coordenada(a, "x"), y: coordenada(a, "y"), delta: d };
    }
    default:
      throw new ArgumentoMacInvalido("capacidade", `capacidade desconhecida: ${capacidade}`);
  }
}

/** O corpo de uma nota é HTML no app Notas: o texto da pessoa entra escapado, com as quebras de linha. */
export function htmlDaNota(titulo: string, corpo: string): string {
  const e = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<div><b>${e(titulo)}</b></div>${corpo.split("\n").map((l) => `<div>${l === "" ? "<br>" : e(l)}</div>`).join("")}`;
}

/**
 * O plano do turno (ADR-171): as ferramentas do conector `mac` DA PESSOA do turno rodam na máquina do turno quando ela
 * é um Mac (`execucao: "maquina"`); fora do macOS (VM Linux, Windows, servidor) elas SAEM do catálogo — não existe
 * Mail nem Mensagens ali, e o servidor nunca as executa. `conectorId` null = a pessoa não tem o conector.
 */
export function ferramentasMacNoPlano<F extends { origem: string; conectorId?: string | null; execucao?: "maquina" }>(ferramentas: readonly F[], conectorId: string | null, maquinaEhMac: boolean): F[] {
  if (conectorId === null) return [...ferramentas];
  const doMac = (f: F) => f.origem === "conector" && f.conectorId === conectorId;
  if (!maquinaEhMac) return ferramentas.filter((f) => !doMac(f));
  return ferramentas.map((f) => (doMac(f) ? { ...f, execucao: "maquina" as const } : f));
}

/** A "sonda" do conector `mac` (ADR-171): não spawna nada; o catálogo é o contrato, e o efeito só existe no Mac. */
export function sondaMacNativa(): ResultadoSonda {
  return { ok: true, ferramentas: CAPACIDADES_MAC.map((c) => ({ nome: c.nome, descricao: c.descricao, schema: c.schema, readOnlyHint: c.readOnlyHint })) };
}
