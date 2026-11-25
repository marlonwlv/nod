/**
 * Backoffice interno (ADR-194; o painel de uso nasceu no ADR-193, em 2026-11-23). Só leitura, só metadados e contagens: nenhum texto de
 * mensagem, nenhum erro cru, nenhum segredo. Instantes em ISO UTC; dias em `AAAA-MM-DD` (UTC).
 */

/** As fontes de problema que o painel conhece. A `chave` de um problema é `fonte:motivo`. */
export type FonteProblema =
  | "turno_falhou"
  | "turno_interrompido"
  | "tarefa_cancelada"
  | "ferramenta_negada"
  | "decisao_expirou"
  | "aprovacao_recusada"
  | "item_falhou"
  | "pedido_recusado"
  | "conector_auth"
  | "conector_falha"
  | "rotina_falhou"
  | "mac_sem_contato"
  | "sem_resposta"
  | "resposta_lenta"
  | "onboarding_abandonado"
  | "relato";

/** Um caso concreto de problema de uma pessoa. Só ids e motivos fechados (enum do banco), nunca texto livre. */
export type CasoProblemaDto = {
  fonte: FonteProblema;
  motivo: string;
  em: string;
  conversaId: string | null;
  turnoId: string | null;
  tarefaId: string | null;
  /** Nome curto do que deu errado quando ajuda (nome da ferramenta, slug do app, tipo do pedido). Nunca argumentos. */
  alvo: string | null;
};

export type PessoaRefDto = { tenantId: string; pessoaId: string; nome: string; iniciais: string };

export type ProblemaRankDto = {
  chave: string;
  fonte: FonteProblema;
  motivo: string;
  rotulo: string;
  ocorrencias: number;
  pessoasAfetadas: number;
  /** Ocorrências por dia da janela, na mesma ordem de `dias` do painel. */
  tendencia: number[];
  /** Os casos mais recentes (até 20), cada um com a pessoa. */
  casos: (CasoProblemaDto & { pessoa: PessoaRefDto })[];
};

export type PassoFunilDto = { passo: "cadastro" | "onboarding" | "primeiro_bot" | "primeiro_app" | "primeira_tarefa"; rotulo: string; pessoas: number };

export type TempoAteDto = { passo: "primeiro_bot" | "primeiro_app" | "primeira_tarefa"; rotulo: string; pessoas: number; medianaHoras: number | null; p90Horas: number | null };

export type ContagemDto = { nome: string; total: number };

export type ResumoPessoaDto = PessoaRefDto & {
  cadastroEm: string | null;
  ultimoUsoEm: string | null;
  mensagens: number;
  turnos: number;
  tarefas: number;
  rotinasAtivas: number;
  bots: number;
  apps: number;
  problemas: number;
  travadas: number;
  macsSemContato: number;
};

export type PainelUsoDto = {
  geradoEm: string;
  dias: string[];
  crescimento: {
    totalPessoas: number;
    cadastrosPorDia: number[];
    ativosPorDia: number[];
    /** Ativos nos últimos 7 e 30 dias contados do fim da janela. */
    ativosSemana: number;
    ativosMes: number;
  };
  ativacao: { funil: PassoFunilDto[]; tempos: TempoAteDto[] };
  engajamento: {
    mensagensPorPessoa: number;
    turnosPorPessoa: number;
    tarefasPorPessoa: number;
    rotinasAtivasPorPessoa: number;
    tiposDeBot: ContagemDto[];
    conectores: ContagemDto[];
    /** Das pessoas que se cadastraram na janela até 7 dias antes do fim, quantas voltaram na semana seguinte. */
    retencao: { coorte: number; voltaram: number };
  };
  saude: { travadas: number; macsSemContato: number; pessoasComProblema: number };
  problemas: ProblemaRankDto[];
  pessoas: ResumoPessoaDto[];
};

export type TipoEventoLinhaDto = "cadastro" | "onboarding_concluido" | "bot_criado" | "app_conectado" | "tarefa_criada" | "tarefa_entregue" | "rotina_criada" | "problema";

export type EventoLinhaDto = {
  tipo: TipoEventoLinhaDto;
  em: string;
  rotulo: string;
  conversaId: string | null;
  turnoId: string | null;
  tarefaId: string | null;
  /** Só em `problema`. */
  problema: { chave: string; fonte: FonteProblema; motivo: string } | null;
};

export type PainelPessoaDto = {
  pessoa: ResumoPessoaDto;
  onboarding: { etapa: string | null; concluidoEm: string | null };
  diasAtivos: string[];
  problemas: { chave: string; rotulo: string; ocorrencias: number }[];
  linhaDoTempo: EventoLinhaDto[];
};

/** ADR-194: quem está entrando no backoffice. `dono` e `leitura` veem o mesmo hoje; `dono` é quem poderá gerir a equipe. */
export type BackofficeEuDto = { papel: "dono" | "leitura"; nome: string; iniciais: string };

export type BackofficeProblemasDto = { geradoEm: string; dias: string[]; problemas: ProblemaRankDto[] };

export type BackofficePessoasDto = { geradoEm: string; dias: string[]; pessoas: ResumoPessoaDto[] };
