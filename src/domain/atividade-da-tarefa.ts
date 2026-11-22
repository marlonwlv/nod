import type { EstadoTrabalho } from "../contracts/trabalho.ts";
import type { MotivoInterrupcao } from "../contracts/motivos.ts";
import type { AtividadeTarefa, EstadoTarefa } from "../contracts/tarefa.ts";
import type { EstadoTurno } from "../contracts/turno.ts";

/**
 * ADR-192 (definido em 2026-11-22, etapa 0 da especificação "Tarefa com Thread"): a atividade atual de uma Tarefa. Não é
 * estado gravado nem entidade — é a projeção dos fatos que `turnos`, `decisoes` e as esperas já registram, ortogonal ao
 * estado do objetivo (`nao_iniciada`, `em_andamento`, `entregue`, `resolvida`, `arquivada`). Sem sinal nenhum, `null`.
 */
export type AtividadeDaTarefa = AtividadeTarefa;

export const ATIVIDADES_DA_TAREFA = ["trabalhando", "precisa_de_voce", "em_espera", "interrompida"] as const satisfies readonly AtividadeDaTarefa[];

/**
 * O que a projeção lê. Os nomes são os de `FatosTrabalho` (trabalhosRepo.fatos) para o adaptador legado passar os fatos
 * de um trabalho sem tradução; a Thread monta os mesmos campos a partir dos turnos dela.
 */
export type FatosDaAtividade = {
  /** Turnos `despachando` sem o Parar pedido. */
  despachando: number;
  /** Turnos `pendente` na fila. */
  pendentes: number;
  /** Turnos ainda rodando com o Parar já pedido (o processo está acabando). */
  parando?: number;
  /** O turno na fila espera outro trabalho acabar ("Fazer depois da …"): não é elegível. */
  esperandoOutro?: boolean;
  /** Pergunta, aprovação, acesso ou "Retomar" pendente dirigida à dona. */
  decisaoPendente: boolean;
  aguardandoColega: boolean;
  aguardandoDespertar?: boolean;
  aguardandoComando?: boolean;
  /** A última pergunta à pessoa venceu sem resposta (NOD-264): o trabalho parou sem retomada. */
  perguntaVencida?: boolean;
  /**
   * ADR-192 (emenda 5, achado das jornadas de QA): a pessoa apertou Parar (trabalho `parado`). Quando o bot esperava um
   * comando em segundo plano, o último turno já tinha "concluído" e o Parar só cancelava a espera — a projeção não via
   * interrupção nenhuma, e a lista dizia "Em andamento" enquanto a tela dizia "Você parou a tarefa".
   */
  paradoPelaPessoa?: boolean;
  /** O turno terminal mais recente. */
  ultimo: { estado: EstadoTurno; motivo: MotivoInterrupcao | null } | null;
};

/**
 * O algoritmo da especificação, na ordem de precedência (decisão > turno vivo > espera > interrupção > ausente):
 *
 * 1. decisão/pergunta pendente à dona → `precisa_de_voce` (mesmo com o turno vivo parado nela);
 * 2. turno `despachando`, ou `pendente` elegível → `trabalhando`;
 * 3. pendente esperando outro trabalho, pedido a colega aberto, volta marcada ou comando esperando → `em_espera`;
 * 4. o Parar pedido com o processo acabando, o trabalho parado pela pessoa, a pergunta vencida ou o último turno terminal
 *    `interrompido` → `interrompida`;
 * 5. senão `null` — um turno concluído não produz atividade "concluída": conclusão é do turno, resolução é da Tarefa.
 */
export function atividadeDaTarefa(f: FatosDaAtividade): AtividadeDaTarefa | null {
  if (f.decisaoPendente) return "precisa_de_voce";
  if (f.despachando > 0) return "trabalhando";
  if (f.pendentes > 0 && !f.esperandoOutro) return "trabalhando";
  if (f.pendentes > 0 || f.aguardandoColega || f.aguardandoDespertar || f.aguardandoComando) return "em_espera";
  if ((f.parando ?? 0) > 0 || f.paradoPelaPessoa || f.perguntaVencida) return "interrompida";
  if (f.ultimo?.estado === "interrompido") return "interrompida";
  return null;
}

/**
 * ADR-192 (emenda 5): a atividade que a tela mostra ao lado do objetivo. Na Tarefa resolvida ou arquivada, a pessoa já
 * decidiu: só "trabalhando" (o "deixar terminar") ainda diz algo; interrupção, espera e pergunta sobrando viram ruído
 * ("Resolvida · interrompida"). As perguntas pendentes são fechadas ao resolver e arquivar (tarefas-acoes.ts).
 */
export function atividadeNoObjetivo(estado: EstadoTarefa, atividade: AtividadeDaTarefa | null): AtividadeDaTarefa | null {
  if (estado === "resolvida" || estado === "arquivada") return atividade === "trabalhando" ? atividade : null;
  return atividade;
}

/**
 * Shadow read (etapa 0): a atividade que o estado legado do trabalho implica, para comparar com a projeção nova sem mudar a
 * tela. `rodando` e `na_fila` dependem dos fatos (turno vivo ou espera); os demais estados determinam uma só atividade.
 * `parado` e `falhou` implicam `interrompida` ou ausência, conforme o último turno (a especificação, etapa 4: o `parado`
 * fica parado mesmo quando o turno que acabou depois do Parar concluiu); `terminado` implica ausência.
 */
export function atividadesEsperadasDoLegado(estado: EstadoTrabalho): readonly (AtividadeDaTarefa | null)[] {
  switch (estado) {
    case "rodando":
      return ["trabalhando", "em_espera"];
    case "na_fila":
      return ["trabalhando", "em_espera", null];
    case "precisa_de_voce":
    case "fechado_ocioso":
      return ["precisa_de_voce"];
    case "terminado":
      return [null];
    case "parado":
    case "falhou":
      return ["interrompida", null];
  }
}

/** A divergência entre a projeção nova e o estado legado, ou `null` quando as duas concordam. */
export function divergenciaDaAtividade(estado: EstadoTrabalho, atividade: AtividadeDaTarefa | null): { estado: EstadoTrabalho; atividade: AtividadeDaTarefa | null } | null {
  return atividadesEsperadasDoLegado(estado).includes(atividade) ? null : { estado, atividade };
}
