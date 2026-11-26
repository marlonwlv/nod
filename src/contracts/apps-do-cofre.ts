/**
 * Os apps que o Cofre conhece (ADR-195 §6, Entrega 3): o `pedir_credencial` com alvo `app` e a "Nova chave" da tela
 * (Paper C3) usam este catálogo para o nome da variável, o texto do cartão e o teste da chave antes de guardar. Começa
 * pela Orgo; um app novo entra aqui com o seu teste em src/adapters/cofre/testar-chave.ts.
 */
export type IdAppDoCofre = "orgo";

export type AppDoCofre = {
  id: IdAppDoCofre;
  /** O nome que a pessoa lê ("Orgo"). */
  nome: string;
  /** "a" ou "o": "Chave da Orgo", "A Orgo recusou essa chave". */
  artigo: "a" | "o";
  /** A variável que o bot vê e que o programa lê (Paper C3: "É o único que o bot vê"). */
  variavel: string;
  /** O "para" padrão do cartão quando o bot não escreveu um (Paper O1). */
  para: string;
  /** Onde a pessoa acha a chave (Paper O1: "Onde achar: orgo.ai › API keys"). */
  ondeAchar: { rotulo: string; url: string };
  /** O começo da chave, no campo vazio. */
  dica: string;
};
