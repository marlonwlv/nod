/**
 * ADA-26: a recusa do gerir_quadro diz à pessoa o que fazer, numa frase, sem a regra interna (turno limpo, deFora,
 * limite). Puro: o erro e o código da tarefa que o passo citou (só se tiver a forma de um código, como ADA-17: o título
 * pode ter vindo de fora e não entra na frase, ADR-047).
 */

export type ErroDoQuadro =
  | "experimento_desligado" | "sem_quadro" | "entrada_invalida" | "nao_encontrado" | "nao_permitido" | "estado_invalido" | "conflito"
  | "sem_conector" | "linear_indisponivel" | "importacao_indisponivel" | "importacao_em_andamento" | "demais";

const FORMA_DE_CODIGO = /^[A-Za-z]{1,10}-\d{1,7}$/;

/** O código da tarefa do primeiro passo que cita uma (`tarefa`), se tiver a forma de código. */
export function codigoDoPasso(acoes: unknown): string | null {
  if (!Array.isArray(acoes)) return null;
  for (const a of acoes) {
    const ref = typeof a === "object" && a !== null ? (a as { tarefa?: unknown }).tarefa : undefined;
    if (typeof ref === "string" && FORMA_DE_CODIGO.test(ref.trim())) return ref.trim().toUpperCase();
  }
  return null;
}

/** A frase para a pessoa; null = a recusa já tem instrução própria (a importação do Linear). */
export function fraseParaPessoa(erro: ErroDoQuadro, codigo: string | null): string | null {
  switch (erro) {
    case "nao_permitido":
    case "entrada_invalida":
    case "estado_invalido":
      return codigo
        ? `Para eu mudar a ${codigo}, me peça aqui citando o código (ex.: "cancela a ${codigo}"), ou mude direto no quadro.`
        : "Para eu mudar o quadro, me peça aqui citando o código da tarefa (ex.: \"cancela a ADA-17\"), ou mude direto no quadro.";
    case "conflito":
      return "Alguém mudou o quadro ao mesmo tempo; vou ler de novo e tentar outra vez.";
    case "experimento_desligado":
      return "O quadro está desligado para você: ligue em Ajustes → Experimentos → Quadro.";
    case "sem_quadro":
      return "Ainda não há quadro aqui; se quiser, me peça para criar um.";
    case "nao_encontrado":
      return codigo ? `Não achei a ${codigo} no quadro; confira o código da tarefa.` : "Não achei essa tarefa no quadro; me diga o código dela (ex.: ADA-17).";
    default:
      return null;
  }
}
