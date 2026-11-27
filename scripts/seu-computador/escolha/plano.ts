// ADR-197 (item 9): o prompt e as ferramentas REAIS de um turno de conversa com app conectado (Slack), navegador,
// computador do bot e o Mac da pessoa, para a avaliação da escolha do lugar (rodar.sh).
import { writeFileSync } from "node:fs";
import { montarPlano, type EntradaPlano } from "../../../src/domain/plano-turno.ts";
const D = process.argv[2]!;
const agora = Date.now();
const agente = { tenantId: "t", id: "a1", ownerId: "p", visibility: "privado", nome: "Ada", titulo: "PM", descricao: "Assistente de produto e operações do Marlon", dono: "pessoa", forma: "shape-square", cor: "c-red", fixado: false, oculto: false, confirmado: true, modelo: "claude-sonnet-4-5", duplicadoDe: null, criadoEm: 0 } as const;
const turno = { executor: "catcher", tenantId: "t", id: "t1", conversaId: "c1", agenteId: "a1", ownerId: "p", origem: "conversa", estado: "despachando", sinais: { attempted: true, rejected: false, promptSubmitted: false, producedOutput: false }, machineId: null, leaseAte: null, prazoEm: agora + 86_400_000, motivoInterrupcao: null, motivoFalha: null, semNovidadeMotivo: null, retomaTurnoId: null, profundidade: 0, reenvios: 0, pararSolicitadoEm: null, entradaTexto: "x", entradaAnexos: [], entradaConfianca: "confiavel", custoUsd: null, modelo: "claude-sonnet-4-5", criadoEm: agora, mensagemOrigemId: "m0" } as const;
const slack = { tenantId: "t", id: "k1", ownerId: "p", visibility: "privado", nome: "Slack", slug: "slack", transporte: "stdio", comando: "node", args: [], url: null, env: {}, declaracao: "nao-toca", habilitado: true, catalogo: [
  { nome: "SLACK_SEND_MESSAGE", descricao: "Envia uma mensagem num canal do Slack", schema: { type: "object", properties: { channel: { type: "string" }, text: { type: "string" } }, required: ["channel", "text"] }, readOnlyHint: false },
  { nome: "SLACK_LIST_CHANNELS", descricao: "Lista os canais do Slack", schema: { type: "object" }, readOnlyHint: true },
], sondadoEm: agora, ultimaFalha: null, criadoEm: 0 };
const concessoes = slack.catalogo.map((c, i) => ({ tenantId: "t", id: `g${i}`, ownerId: "p", agenteId: "a1", conectorId: "k1", capacidade: c.nome, mensagemId: "m", criadoEm: 0 }));
const base = { turno, agente, memorias: [], concessoes, conectores: [slack], modo: "conversa", confianca: "confiavel", profundidade: 0, inventario: { estado: "pronto", versao: "2.1.332", em: agora }, executor: "local", sessaoCli: null, pessoaNome: "Marlon", agora, navegador: true, computador: true, seuComputador: { plataforma: "darwin", nome: "MacBook" } } as unknown as EntradaPlano;
const p = montarPlano(base);
writeFileSync(`${D}/prompt.txt`, p.promptSistema);
writeFileSync(`${D}/ferramentas.json`, JSON.stringify(p.catalogo.ferramentas.map((f) => ({ name: f.nome, description: f.schema.description ?? "", inputSchema: f.schema }))));
process.stdout.write(`${p.catalogo.ferramentas.length} ferramentas; ${p.promptSistema.length} caracteres de prompt\n`);
