import type { AppDoCofre } from "./apps-do-cofre.ts";

/**
 * O Cofre (Paper 07, rodada 2 da casca): as credenciais que a pessoa guardou pelo cartão de `pedir_credencial` (NOD-50).
 * Só o NOME da chave, o app e quando foi guardada — o valor nunca sai do cofre (nem cifrado). Cada credencial é a proposta
 * `credencial` confirmada; a mesma chave guardada de novo aparece uma vez, com a data mais nova.
 */
export type CredencialNoCofre = {
  /** O nome da chave do env/header ("EXEMPLO_API_KEY"), ou "Token do GitHub" / "Chave do Composio". */
  nome: string;
  /** O nome legível do app ("Exemplo", "GitHub", "Composio"). */
  app: string;
  /** Quando foi guardada (ms). */
  guardadaEm: number;
};

/** ADR-195 §3: `sempre` usa sem perguntar; `perguntar` abre "Permitir uma vez / Negar" no chat a cada uso. */
export type ModoDeUsoDaChave = "sempre" | "perguntar";

export type QuemUsaAChave = { agenteId: string; nome: string; modo: ModoDeUsoDaChave };

/**
 * ADR-195 (Entrega 3, Paper C1 e C2): uma chave do cofre em envelope (`cofre_itens`, tipo `chave`). Nunca o valor: só a
 * variável, o app, de quem é, quem pode usar e quando foi usada.
 */
export type ChaveDoCofreNaTela = {
  id: string;
  /** A variável que o bot vê (ORGO_API_KEY). */
  nome: string;
  app: string | null;
  /** O app conhecido do Cofre ("orgo"): com ele, a chave é testada antes de guardar e de trocar. */
  appId: string | null;
  dono: "pessoa" | "time";
  /** A pessoa guardou (só ela troca, dá acesso e remove). */
  sua: boolean;
  quem: QuemUsaAChave[];
  ultimoUsoEm: number | null;
  guardadaEm: number;
  /** Quando o app aceitou esta versão (só com app conhecido). */
  testadaEm: number | null;
  /** O que o bot lê sobre quando usar a chave (Paper C3, "Dicas"). */
  dicas: string | null;
  /** O bot do cartão que pediu a chave ("guardada pelo cartão do Chico"); null quando entrou pela tela. */
  pedidaPor: string | null;
};

/** Uma linha do "Uso recente" (Paper C2). O texto é montado na tela; aqui só o fato. */
export type UsoDaChave = {
  tipo: "guardado" | "trocado" | "pedido" | "aprovado" | "negado" | "entregue" | "revogado";
  /** O bot do fato (quem usou, pediu ou foi negado); null quando foi a pessoa. */
  agente: string | null;
  quando: number;
  /** Onde o bot usou, quando se sabe ("no computador da Orgo"). */
  onde?: string;
  /** Guardada pelo cartão de um bot. */
  peloCartaoDe?: string;
};

export type DetalheDaChaveDto = { chave: ChaveDoCofreNaTela; uso: UsoDaChave[] };

/** O catálogo dos apps que o Cofre conhece (Paper C3, "App"): vem pela API, a web não tem o catálogo. */
export type CofreDto = { credenciais: CredencialNoCofre[]; chaves?: ChaveDoCofreNaTela[]; apps?: AppDoCofre[] };

/** POST /cofre/chaves (Paper C3). O valor vai direto ao cofre; a resposta nunca o devolve. */
export type NovaChaveDoCofre = {
  appId?: string | null;
  /** O nome do app quando não é um conhecido ("Outro app"). */
  app?: string | null;
  nome: string;
  valor: string;
  quem?: { agenteId: string; modo: ModoDeUsoDaChave }[];
  dicas?: string | null;
};
