import type { ReactNode } from "react";
import type { ContextoSecao } from "../comum.tsx";
import type { IdSecao } from "../rotas.ts";
import { SecaoPessoas } from "./pessoas.tsx";
import { SecaoProblemas } from "./problemas.tsx";
import { SecaoUso } from "./uso.tsx";

/**
 * O registro das seções do backoffice (ADR-194). Seção nova (uso de IA, auditoria…) = um módulo em secoes/, uma rota
 * GET em src/adapters/http/rotas/backoffice.ts (que audita o acesso) e uma linha aqui; o shell desenha o menu e o
 * cabeçalho a partir desta lista.
 */
export type DefinicaoSecao = {
  id: IdSecao;
  rotulo: string;
  descricao: string;
  icone: ReactNode;
  Componente: (c: ContextoSecao) => ReactNode;
};

const svg = (d: string) => (
  <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

export const SECOES: readonly DefinicaoSecao[] = [
  { id: "uso", rotulo: "Uso", descricao: "Crescimento, ativação, engajamento e saúde", icone: svg("M3 16.5h14M5.5 13.5v-4M10 13.5V5.5M14.5 13.5v-6"), Componente: SecaoUso },
  { id: "problemas", rotulo: "Problemas", descricao: "O que dá errado durante o uso, do mais frequente ao menos", icone: svg("M10 3.5 17 16H3L10 3.5ZM10 8.5v3M10 13.8v.2"), Componente: SecaoProblemas },
  { id: "pessoas", rotulo: "Pessoas", descricao: "Quem usa o nod e como", icone: svg("M7.5 9a2.75 2.75 0 1 0 0-5.5 2.75 2.75 0 0 0 0 5.5ZM2.5 16.5c.5-2.8 2.5-4.5 5-4.5s4.5 1.7 5 4.5M13 4a2.5 2.5 0 0 1 0 5M15 12.3c1.3.6 2.2 2 2.5 4.2") , Componente: SecaoPessoas },
];
