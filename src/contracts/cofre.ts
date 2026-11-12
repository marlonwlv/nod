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

export type CofreDto = { credenciais: CredencialNoCofre[] };
