/**
 * ADR-179 (fase 6, o campo de mensagem, por pedaços): o módulo das peças do campo já em componentes, baixado pelo main
 * depois do boot (`?composer-react=0` o deixa de fora). Pedaço 1: a fila de anexos; pedaço 2: o topo do campo.
 */
export { criarFilasNoReact, type FilasNoReact } from "./fila-de-anexos.tsx";
export { criarTopoNoReact, type TopoNoReact, type TopoDoCampo } from "./topo-do-campo.tsx";
