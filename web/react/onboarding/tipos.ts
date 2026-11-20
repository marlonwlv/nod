/**
 * ADR-179 (fase 5): como as telas do onboarding em React falam com o controlador (web/telas/onboarding-controle.ts).
 * `executar` chama a ação pelo nome, com os dados que antes iam nos `data-*` do botão (ia, id, slug, índice…). É o mesmo
 * mapa de ações do controlador, sem a delegação por `data-act`: o clique é prop.
 */
export type DadosDaAcao = Readonly<Record<string, string | undefined>>;
export type Executar = (acao: string, dados?: DadosDaAcao) => void;
