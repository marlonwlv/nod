// XUM-11 (catálogo de apps sob demanda): bots típicos com os catálogos REAIS do Composio (raspados de
// docs.composio.dev por raspar.py, em catalogos/*.json, fora do git) para medir o plano (medir.ts) e avaliar a escolha de
// ferramenta com um modelo de verdade (avaliar.ts). Cada app vai concedido INTEIRO, como o nível "escrita" concede.
// Antes da primeira vez: python3 -I scripts/catalogo-apps/raspar.py outlook gmail slack linear github notion googlecalendar googledrive googlesheets clickup supabase
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Conector } from "../../src/contracts/conector.ts";
import type { EntradaPlano } from "../../src/domain/plano-turno.ts";

const AQUI = dirname(fileURLToPath(import.meta.url));

type ItemCatalogo = { nome: string; descricao: string; readOnlyHint: boolean; destructiveHint: boolean; schema: Record<string, unknown> };

export const APPS = ["outlook", "gmail", "slack", "linear", "github", "notion", "googlecalendar", "googledrive", "googlesheets", "clickup", "supabase"] as const;
export type App = (typeof APPS)[number];

const NOMES: Record<App, string> = { outlook: "Outlook", gmail: "Gmail", slack: "Slack", linear: "Linear", github: "GitHub", notion: "Notion", googlecalendar: "Google Calendar", googledrive: "Google Drive", googlesheets: "Google Sheets", clickup: "ClickUp", supabase: "Supabase" };

export function catalogoDe(app: App): ItemCatalogo[] {
  const arquivo = join(AQUI, "catalogos", `${app}.json`);
  if (!existsSync(arquivo)) throw new Error(`falta ${arquivo}: rode python3 -I scripts/catalogo-apps/raspar.py ${app}`);
  return JSON.parse(readFileSync(arquivo, "utf8")) as ItemCatalogo[];
}

/** O conector como a sonda o grava: o esquema leva a descrição (probe.ts), o readOnlyHint vem da anotação. */
export function conectorDe(app: App, i: number): Conector {
  // github: o do Composio (o nativo `github` é outro conector, com o gh da máquina).
  const slug = app === "github" ? "github_mcp" : app;
  return {
    tenantId: "t", id: `k${i}`, ownerId: "p", visibility: "privado", nome: NOMES[app], slug, transporte: "http", comando: null, args: [], url: "https://backend.composio.dev/mcp", env: {}, declaracao: "toca", habilitado: true,
    catalogo: catalogoDe(app).map((c) => ({ nome: c.nome, descricao: c.descricao, readOnlyHint: c.readOnlyHint, ...(c.destructiveHint ? { destructiveHint: true } : {}), schema: { ...c.schema, description: c.descricao } as never })),
    sondadoEm: 0, ultimaFalha: null, criadoEm: 0,
  } as unknown as Conector;
}

export type Cenario = { id: string; titulo: string; apps: readonly App[]; rotina?: Record<string, readonly string[]>; usadas?: Record<string, readonly string[]> };

export const CENARIOS: readonly Cenario[] = [
  { id: "outlook", titulo: "Bot do Outlook (o caso de produção)", apps: ["outlook"], rotina: { outlook: ["OUTLOOK_LIST_MESSAGES", "OUTLOOK_LIST_MAIL_FOLDERS", "OUTLOOK_BATCH_MOVE_MESSAGES"] } },
  { id: "gmail", titulo: "Bot do Gmail", apps: ["gmail"] },
  { id: "slack", titulo: "Bot do Slack", apps: ["slack"] },
  { id: "linear", titulo: "Bot do Linear", apps: ["linear"] },
  { id: "github", titulo: "Bot do GitHub (Composio)", apps: ["github"] },
  { id: "notion", titulo: "Bot do Notion", apps: ["notion"] },
  { id: "assistente", titulo: "Assistente: Outlook + Slack + Agenda + Notion", apps: ["outlook", "slack", "googlecalendar", "notion"] },
  { id: "eng", titulo: "Engenharia: GitHub + Linear + Slack", apps: ["github", "linear", "slack"] },
  { id: "operacoes", titulo: "Operações: Gmail + Slack + Agenda + ClickUp + Drive + Sheets", apps: ["gmail", "slack", "googlecalendar", "clickup", "googledrive", "googlesheets"] },
];

const agora = Date.UTC(2026, 10, 27, 12);
const agente = { tenantId: "t", id: "a1", ownerId: "p", visibility: "privado", nome: "Lia", titulo: "Assistente", descricao: "Assistente pessoal da Marlon: organiza e-mails, agenda, mensagens e tarefas.", dono: "pessoa", forma: "shape-square", cor: "c-red", fixado: false, oculto: false, confirmado: true, modelo: "claude-sonnet-4-5", duplicadoDe: null, criadoEm: 0, modoAprovacao: "automatico" } as const;

/** A entrada do plano de um turno de conversa com o cenário, com navegador e computador (a escolha de lugar). */
export function entradaDoCenario(c: Cenario, opcoes: { texto?: string; harness?: "claude-cli" | "codex-cli"; modo?: "conversa" | "rotina"; extra?: Partial<EntradaPlano> } = {}): EntradaPlano {
  const conectores = c.apps.map((a, i) => conectorDe(a, i));
  const concessoes = conectores.flatMap((k) => k.catalogo.map((cap, j) => ({ tenantId: "t", id: `${k.id}g${j}`, ownerId: "p", agenteId: "a1", conectorId: k.id, capacidade: cap.nome, mensagemId: "m", criadoEm: 0 })));
  const turno = { executor: "local", tenantId: "t", id: "t1", conversaId: "c1", agenteId: "a1", ownerId: "p", origem: opcoes.modo === "rotina" ? "rotina" : "conversa", estado: "despachando", sinais: { attempted: true, rejected: false, promptSubmitted: false, producedOutput: false }, machineId: null, leaseAte: null, prazoEm: agora + 86_400_000, motivoInterrupcao: null, motivoFalha: null, semNovidadeMotivo: null, retomaTurnoId: null, profundidade: 0, reenvios: 0, pararSolicitadoEm: null, entradaTexto: opcoes.texto ?? "oi", entradaAnexos: [], entradaConfianca: "confiavel", custoUsd: null, modelo: "claude-sonnet-4-5", criadoEm: agora, mensagemOrigemId: "m0" };
  return {
    turno, agente, memorias: [], concessoes, conectores, modo: opcoes.modo ?? "conversa", confianca: "confiavel", profundidade: 0,
    inventario: { estado: "pronto", versao: "2.1.312", em: agora }, executor: "local", sessaoCli: null, pessoaNome: "Marlon", agora,
    navegador: true, computador: true, harness: opcoes.harness ?? "codex-cli",
    ...opcoes.extra,
  } as unknown as EntradaPlano;
}
