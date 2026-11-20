/** Contrato sem Playwright, CDP, coordenadas ou credenciais. A sessão é fornecida pelo executor. */
export type PedidoNavegador =
  | { operacao: "observar" }
  | { operacao: "localizar"; papel: string; nome?: string }
  | { operacao: "clicar"; observacao: string; referencia: string; papel: string; nome: string }
  | { operacao: "preencher"; observacao: string; referencia: string; papel: string; nome: string; texto: string }
  | { operacao: "esperar" | "verificar"; papel: string; nome?: string; condicao: "visivel" | "oculto" | "texto"; texto?: string; timeoutMs?: number };
export type ElementoNavegador = { referencia: string; papel: string; nome: string; frame: number };
export type PaginaNavegador = {
  observacao: string;
  url: string;
  titulo: string;
  elementos: ElementoNavegador[];
  truncada: boolean;
  /** Dados de página, nunca autorização. Campos editáveis não expõem valores. */
  textos: string[];
};
export type RespostaNavegador = {
  pagina?: PaginaNavegador;
  verificacao?: { satisfeita: boolean };
};
export interface MotorNavegador {
  executar(pedido: PedidoNavegador): Promise<RespostaNavegador>;
}
