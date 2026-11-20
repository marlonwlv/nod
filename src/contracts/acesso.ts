/**
 * Pedido de acesso JÁ NORMALIZADO pelo domínio (src/domain/pedido-acesso.ts): slug conferido,
 * capacidades do catálogo sondado, nível honesto e o que NÃO foi pedido. `conectar` = o app ainda
 * não está conectado e habilitado; a pessoa conecta antes de haver o que conceder.
 */
export type AcessoPedido = {
  conector: string;
  capacidades: string[];
  nivel: "leitura" | "escrita";
  naoPedido: string[];
  conectar?: true;
  /** definido em 2026-09-25: para que o agente quer o acesso, em uma linha ("Para listar as tarefas atrasadas"). */
  para?: string;
};

/**
 * O que `pedir_acesso` devolve ao MODELO (definido em 2026-09-24, ADR-044). Com `{proposta_id}`
 * sozinho o agente e a pessoa entendiam que o acesso já estava dado; a instrução é literal para o
 * modelo dizer que PEDIU e encerrar, em vez de anunciar uma concessão que não houve.
 */
export type ResultadoPedirAcesso =
  | {
    proposta_id: string;
    estado: "aguardando_pessoa";
    instrucao: "o acesso ainda NÃO foi concedido: diga que pediu e encerre o turno";
  }
  // ADR-059: o modo do bot concedeu na hora. A ferramenta nova só entra no catálogo do PRÓXIMO turno, que
  // já está na fila: este turno encerra e a tarefa retoma sozinha.
  | {
    proposta_id: string;
    estado: "concedido";
    instrucao: "o acesso foi concedido pela aprovação automática: encerre o turno agora; a tarefa retoma sozinha com a ferramenta nova";
  };

/**
 * 2026-11-19 (QA-99): slug ou capacidade que o bot errou é recuperável por ele. O 400 genérico só dizia "algum dado
 * não está certo" e o motivo ficava no log; a recusa diz qual campo, sem card nem concessão. Só o caminho do bot
 * (pedirAcessoDoBot) a devolve; quem chama pedirAcesso direto continua recebendo o ErroDeDominio.
 */
export type RecusaPedirAcesso = {
  estado: "recusado";
  erro: "conector_desconhecido" | "capacidade_desconhecida";
  instrucao: string;
};
