/**
 * NOD-415 (ADR-141): a flag do servidor que libera os quadros. `NOD_QUADROS` = desligado | admins | todos; sem ela,
 * `admins` em produção (NOD_ADMINS, hoje só o Marlon) e `todos` fora dela. Quem não está liberado não vê a chave em
 * Experimentos, a pílula Conversa | Quadro, a tela do quadro nem o `gerir_quadro` — a chave guardada fica, mas lê desligada.
 * Exceção (ADR-143, NOD-455): o quadro de outra dona em que a pessoa participa segue a flag e a chave da DONA.
 * Emenda de 2026-11-13 (ADR-141): `NOD_QUADROS_PESSOAS` (e-mails ou ids, vírgula) soma pessoas ao modo `admins` sem
 * torná-las admins (a NOD_ADMINS também abre o Marketplace de admin e a ligação). Não vale para a NOD_QUADROS_N.
 */
export type ModoQuadros = "desligado" | "admins" | "todos";
export type LiberacaoQuadros = { modo: ModoQuadros; admins: readonly string[] };

export const QUADROS_PARA_TODOS: LiberacaoQuadros = { modo: "todos", admins: [] };

const lista = (v: string | undefined): string[] => (v ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);

export function lerLiberacaoQuadros(env: { NOD_QUADROS?: string; NOD_ADMINS?: string; NOD_QUADROS_PESSOAS?: string; NODE_ENV?: string }): LiberacaoQuadros {
  const bruto = (env.NOD_QUADROS ?? "").trim().toLowerCase();
  const modo: ModoQuadros = bruto === "desligado" || bruto === "admins" || bruto === "todos" ? bruto : env.NODE_ENV === "production" ? "admins" : "todos";
  // `admins` é quem o modo `admins` libera: os admins mais as pessoas liberadas só para o quadro.
  const admins = [...new Set([...lista(env.NOD_ADMINS), ...lista(env.NOD_QUADROS_PESSOAS)])];
  return { modo, admins };
}

/** Admin por id da pessoa ou e-mail, sem caixa (a mesma regra de NOD_LIGACAO). */
export function quadroLiberadoPara(l: LiberacaoQuadros, pessoa: { id: string; email?: string | null }): boolean {
  if (l.modo === "todos") return true;
  if (l.modo === "desligado") return false;
  const admins = l.admins.map((a) => a.trim().toLowerCase());
  const email = pessoa.email?.trim().toLowerCase();
  return admins.includes(pessoa.id.toLowerCase()) || (!!email && admins.includes(email));
}

/**
 * ADA-14 (ADR-153 §7): `NOD_QUADROS_N` libera o 2º quadro de um bot (e o vínculo a outro bot). Mesmos valores e o mesmo
 * padrão da NOD_QUADROS (admins em produção, todos fora dela); desligado, cada bot segue com um quadro e tudo lê igual.
 */
export function lerLiberacaoQuadrosN(env: { NOD_QUADROS_N?: string; NOD_ADMINS?: string; NODE_ENV?: string }): LiberacaoQuadros {
  return lerLiberacaoQuadros({ ...(env.NOD_QUADROS_N !== undefined ? { NOD_QUADROS: env.NOD_QUADROS_N } : {}), ...(env.NOD_ADMINS !== undefined ? { NOD_ADMINS: env.NOD_ADMINS } : {}), ...(env.NODE_ENV !== undefined ? { NODE_ENV: env.NODE_ENV } : {}) });
}
