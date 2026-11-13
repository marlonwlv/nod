import type { JsonSchema } from "../contracts/json-schema.ts";
import { FERRAMENTAS_QUADRO, PROPRIEDADES_QUADRO } from "../contracts/ferramentas-quadro.ts";
import type { OrigemTrabalho } from "../contracts/trabalho.ts";

/**
 * definido em 2026-11-13 (estudo chat x quadro, decisão 3 aprovada pelo Marlon em 03/11: dividir por contexto). Até aqui
 * todo bot com o experimento Quadro carregava o gerir_quadro inteiro (descrição de ~9 mil caracteres e schema de ~25 mil)
 * em toda conversa, até quando ninguém falava do quadro. Agora o catálogo leva um de três kits, todos com o mesmo nome
 * (o caso de uso e o MCP não mudam; o proxy valida pelo schema do plano, então o kit também é a cerca):
 *
 * - `tarefa`: o turno de uma tarefa do quadro só vê as saídas da etapa — terminei, mudar_tarefa (status, pr_url,
 *   pergunta, motivo), comentar e nao_e_comigo. Sem criar_coluna, definir_passagem, pessoas nem importar.
 * - `gestao`: o gerir_quadro de sempre, quando a fala do turno é sobre o quadro (ou a pessoa pede algo dele).
 * - `leve`: o resto (conversa, rotina, pedido de colega sem assunto de quadro). Aceita TODOS os tipos (nada que funciona
 *   pelo chat deixa de funcionar), mas com uma descrição curta e as propriedades sem o texto de ajuda.
 *
 * Gatilho de revisão: um pedido de quadro em que o bot recebeu o kit leve e errou o uso (falta de assunto detectado);
 * aí o caminho é ampliar `assuntoDeQuadro`, não voltar ao kit inteiro em toda conversa.
 */
export type KitQuadro = "tarefa" | "gestao" | "leve";

/** Os tipos do kit da etapa (o turno de tarefa); `acoes: []` (consultar) vale em qualquer kit. */
export const TIPOS_DA_TAREFA = ["terminei", "mudar_tarefa", "comentar", "nao_e_comigo"] as const;

const PROPS_DA_TAREFA = ["tarefa", "status", "pr_url", "pergunta", "motivo", "texto", "responder_a"] as const satisfies readonly (keyof typeof PROPRIEDADES_QUADRO)[];

/** No kit leve, só estas propriedades guardam a descrição (as que o bot usa sem pensar no quadro). */
const PROPS_COM_AJUDA_NO_LEVE = ["tarefa", "status", "pr_url", "pergunta", "agente"] as const satisfies readonly (keyof typeof PROPRIEDADES_QUADRO)[];

/**
 * Palavras que fazem a fala ser "sobre o quadro" (sem acento e em minúsculas). Fora daqui ficam palavras comuns demais
 * no português do dia a dia ("feito", "fazendo", "mover") — um falso positivo só custa tokens, um falso negativo cai no
 * kit leve, que ainda aceita tudo.
 */
const PALAVRAS_DO_QUADRO = /\b(quadros?|tarefas?|tasks?|colunas?|cards?|backlog|kanban|passagens?|handoff|esteira|labels?|etiquetas?|importa\w*|linear|board|issues?|responsave(l|is)|atribu\w*|bloquead[oa]s?|swimlanes?)\b/;
/** O código de uma tarefa do quadro ou do Linear (ADA-12, NOD-491). */
const CODIGO_DE_TAREFA = /\b[A-Z]{2,6}-\d{1,5}\b/i;

const semAcento = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** A fala do turno é sobre o quadro (ou pede algo dele)? */
export function assuntoDeQuadro(texto: string | null | undefined): boolean {
  if (!texto) return false;
  return CODIGO_DE_TAREFA.test(texto) || PALAVRAS_DO_QUADRO.test(semAcento(texto));
}

/** O kit do turno: a tarefa do quadro manda; senão, o assunto da fala. */
export function kitDoQuadro(p: { trabalho?: { origem: OrigemTrabalho } | null; texto?: string | null }): KitQuadro {
  if (p.trabalho?.origem === "quadro") return "tarefa";
  return assuntoDeQuadro(p.texto) ? "gestao" : "leve";
}

type SchemaGerirQuadro = typeof FERRAMENTAS_QUADRO.gerir_quadro;
const ITENS = FERRAMENTAS_QUADRO.gerir_quadro.properties.acoes.items;
const TODOS_OS_TIPOS = ITENS.properties.tipo.enum;

function comAcoes(description: string, tipos: readonly string[], properties: Record<string, JsonSchema>, permiteEscolherQuadro = true): JsonSchema {
  const g: SchemaGerirQuadro = FERRAMENTAS_QUADRO.gerir_quadro;
  const acoes: JsonSchema = { ...g.properties.acoes, items: { ...ITENS, properties: { tipo: { type: "string", enum: [...tipos] }, ...properties } } };
  return {
    ...g,
    description,
    // O trabalho já carrega o quadro que o originou. Aceitar `quadro` aqui deixaria um turno de tarefa usar as quatro
    // operações permitidas contra outro quadro, escapando do escopo que o kit pretende cercar.
    properties: permiteEscolherQuadro ? { ...g.properties, acoes } : { acoes },
  };
}

const DESCRICAO_DA_TAREFA =
  "O quadro da tarefa deste turno. Uma chamada = um lote atômico; acoes vazio ([]) só consulta. Saídas da etapa: terminei {tarefa?} (etapa concluída: vai para a próxima coluna e quem cuida dela começa); mudar_tarefa {tarefa, status?, pr_url?, pergunta?, motivo?} (pr_url grava o PR; pergunta sem status pergunta à pessoa e a tarefa fica na coluna, com você; status bloqueado pede a pergunta com o motivo e do que você precisa; status cancelado pede o motivo); comentar {tarefa, texto, responder_a?} (sozinho; @Nome aciona aquele bot); nao_e_comigo {tarefa, motivo} (você sai de responsável e o quadro passa a tarefa adiante). Colunas, passagens, pessoas e importar não são do turno de tarefa: são da conversa da pessoa.";

const DESCRICAO_LEVE =
  "Mexe no quadro de tarefas da pessoa (a aba Quadro de um bot), como ela faria na tela. Uma chamada = um lote atômico com Desfazer; acoes vazio ([]) só consulta e devolve o quadro. Os tipos mais usados: criar_tarefa {titulo, descricao?, status?, agente?} (status afazer faz o responsável começar), mudar_tarefa {tarefa, status?, agente?, pr_url?, pergunta?}, comentar {tarefa, texto}, terminei {tarefa?}, desfazer {lote?}. Também há colunas, passagens (responsável por coluna), pessoas, labels, vários quadros, importar do Linear e exibir: quando a conversa for sobre o quadro, o manual completo de cada tipo vem junto; se precisar de um deles agora, consulte o quadro antes ([]) e siga o que a recusa disser.";

function semAjuda(props: Record<string, JsonSchema>, manter: readonly string[]): Record<string, JsonSchema> {
  return Object.fromEntries(Object.entries(props).map(([k, s]) => {
    if (manter.includes(k) || typeof s !== "object" || s === null || !("description" in s)) return [k, s];
    const { description: _d, ...resto } = s as JsonSchema & { description?: string };
    return [k, resto as JsonSchema];
  }));
}

const { tipo: _tipo, ...PROPS_DOS_ITENS } = ITENS.properties;

/** O schema do gerir_quadro por kit (o `gestao` é o de sempre, do contrato). */
export const SCHEMA_DO_KIT: Record<KitQuadro, JsonSchema> = {
  gestao: FERRAMENTAS_QUADRO.gerir_quadro,
  tarefa: comAcoes(DESCRICAO_DA_TAREFA, TIPOS_DA_TAREFA, Object.fromEntries(PROPS_DA_TAREFA.map((k) => [k, PROPRIEDADES_QUADRO[k]])), false),
  leve: comAcoes(DESCRICAO_LEVE, TODOS_OS_TIPOS, semAjuda(PROPS_DOS_ITENS as Record<string, JsonSchema>, PROPS_COM_AJUDA_NO_LEVE)),
};
