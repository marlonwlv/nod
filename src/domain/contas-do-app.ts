/**
 * Duas contas do mesmo app (ADR-196). Cada conta a mais de um app do Composio é um conector com o slug `<app>--<conta>`
 * ("gmail--pessoal"); a primeira conta segue com o slug do app ("gmail"). A mesma chave anda pela rota do Marketplace
 * (`/marketplace/gmail--pessoal/conectar`), pelo login que a web acompanha e pelo nome da ferramenta
 * (`gmail--pessoal__GMAIL_SEND_EMAIL`). O `--` só fica livre porque o slug do Composio com `__` é recusado
 * (`toolkitAceito`): a tradução `_`→`-` nunca chega a ele.
 *
 * A web repete `normalizarConta` e `separarChave` em web/react/marketplace/contas.ts (ela não importa valor de src,
 * ADR-018); tests/unit/domain/contas-do-app.test.ts confere que as duas dão o mesmo resultado.
 */

export const SEPARADOR_DE_CONTA = "--";

/** definido em 2026-11-24 (ADR-196 §7): o padrão do Composio para `multi_account`; a primeira conta conta. */
export const LIMITE_CONTAS_POR_APP = 5;

/** definido em 2026-11-24 (spec apps-duas-contas): o nome curto cabe na linha e no nome da ferramenta. */
export const TAMANHO_MAXIMO_DA_CONTA = 20;

/** O nome da conta depois de normalizado: letras e números, separados por um hífen (nunca dois, nem na ponta). */
export const FORMATO_DA_CONTA = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function contaValida(conta: string): boolean {
  return conta.length >= 1 && conta.length <= TAMANHO_MAXIMO_DA_CONTA && FORMATO_DA_CONTA.test(conta);
}

/**
 * "Família Silva" → "familia-silva": sem acento, sem caixa, espaço e pontuação viram um hífen só. Vazio quando não
 * sobra letra nem número; quem chama confere com `contaValida` (o tamanho não é cortado aqui: cortar trocaria o nome
 * que a pessoa escolheu sem avisar).
 */
export function normalizarConta(rotulo: string): string {
  return rotulo
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** `gmail--pessoal` → { app: "gmail", conta: "pessoal" }; `gmail` → { app: "gmail", conta: null }. Null se a forma não fecha. */
export function separarChave(chave: string): { app: string; conta: string | null } | null {
  const i = chave.indexOf(SEPARADOR_DE_CONTA);
  if (i < 0) return chave ? { app: chave, conta: null } : null;
  const app = chave.slice(0, i);
  const conta = chave.slice(i + SEPARADOR_DE_CONTA.length);
  if (!app || !contaValida(conta)) return null;
  return { app, conta };
}

export function chaveDaConta(app: string, conta: string | null): string {
  return conta ? `${app}${SEPARADOR_DE_CONTA}${conta}` : app;
}

/** "Gmail (pessoal)": o nome que a pessoa digitou, aparado, entre parênteses depois do nome do app. */
export function nomeDaConta(nomeDoApp: string, rotulo: string): string {
  return `${nomeDoApp} (${rotulo.trim()})`;
}

/** O rótulo que vai entre parênteses: 1 a 20 caracteres visíveis, uma linha, e que normaliza para um nome válido. */
export function rotuloValido(rotulo: string): boolean {
  const r = rotulo.trim();
  return r.length >= 1 && r.length <= TAMANHO_MAXIMO_DA_CONTA && !/[\p{Cc}\p{Cf}()]/u.test(r) && contaValida(normalizarConta(r));
}
