import type { FormaTrabalho, ResumoFrente } from "../contracts/frente.ts";
import type { CapacidadesHarness } from "../contracts/harness.ts";
import type { TipoDecisao } from "../contracts/decisao.ts";
import type { EstadoTrabalho } from "../contracts/trabalho.ts";
import type { ErroResumo } from "./resumo-da-frente.ts";

/**
 * Regras puras das frentes (definido em 2026-10-12, ADR-099, partes 3/4, issue I2): o que a frente recebe ao nascer, a
 * linha única do lote na conversa do dono, o catálogo dela e o resumo que o servidor monta quando ela termina sem
 * `devolver_resumo`. Quem lê o banco e grava é o caso de uso (src/use-cases/frentes.ts).
 */

/** A frente é um trabalho com `forma = 'frente'` (0071). Sem forma (montado fora do repositório) = task. */
export function ehFrente(t: { forma?: string | null } | null | undefined): boolean {
  return t?.forma === "frente";
}

/**
 * definido em 2026-10-12 (ADR-099, I10): a forma que vale para o comportamento — o catálogo, o prompt, o histórico e a
 * limpeza `sem_trabalho`. A task aberta antes das frentes vira `frente` na 0072 mas fica sem lote: sem ninguém para
 * receber o resumo, ela segue como task (o resultado continua sendo o balão na conversa, como hoje).
 */
export function formaEfetiva(t: { forma?: string | null; loteId?: string | null } | null | undefined): FormaTrabalho {
  return ehFrente(t) && t?.loteId ? "frente" : "task";
}

/**
 * definido em 2026-10-12 (ADR-099 §5, decisão 10): a frente devolve o fato e termina; quem espera é o dono. Sem
 * `me_chame_as` nem `esperar_comando` (Parte 2) no catálogo dela — o nome que ainda não existir no catálogo não muda nada.
 */
export const FERRAMENTAS_FORA_DA_FRENTE: readonly string[] = ["me_chame_as", "esperar_comando"];

/** A ferramenta só da frente. */
export const FERRAMENTA_DA_FRENTE = "devolver_resumo" as const;

/** O começo da entrada da frente: quem a abriu e o que se espera dela. O pedido vem logo depois, na linha seguinte. */
export function molduraDaFrente(titulo: string, deRotina: boolean, pedidoDe: string | null = null): string {
  // revisto em 2026-10-12 (ADR-099, I7 revista): a frente aberta na triagem de um pedido de colega diz de quem é o pedido;
  // o resultado vai direto a ele (decisão 7), sem acordar o dono.
  if (pedidoDe) return `[nod] Frente "${titulo}", aberta por você (o dono) para um pedido de ${pedidoDe}. O resultado volta a ${pedidoDe}; faça o trabalho até o fim e devolva o que fez com devolver_resumo.\n`;
  return deRotina
    ? `[nod] Frente "${titulo}", aberta pela sua rotina. Faça o trabalho até o fim e devolva o que fez com devolver_resumo.\n`
    : `[nod] Frente "${titulo}", aberta por você (o dono) para um pedido da conversa com a pessoa. Ela acompanha pela tela da task; faça o trabalho até o fim e devolva o que fez com devolver_resumo.\n`;
}

/**
 * A entrada do primeiro turno da frente: a moldura, o pedido autocontido (a frente não vê a conversa) e, quando o dono
 * disse, o repositório e o branch de onde partir; por fim, a linha que diz se ela pode empurrar o próprio branch.
 */
export function entradaDaFrente(p: { titulo: string; pedido: string; deRotina: boolean; pedidoDe?: string | null; repo?: string; branchBase?: string; podeEmpurrar?: boolean }): string {
  const repo = p.repo?.trim();
  const base = p.branchBase?.trim();
  const onde = repo ? `\n\nRepositório: ${repo}. Parta de ${base || "origin/main"}.` : base ? `\n\nParta do branch ${base}.` : "";
  const empurrar = linhaDeEmpurrar(p.podeEmpurrar === true, onde !== "");
  return `${molduraDaFrente(p.titulo, p.deRotina, p.pedidoDe ?? null)}${p.pedido.trim()}${onde ? `${onde}\n` : "\n\n"}${empurrar}`;
}

/**
 * ADR-187 §7 (lote B, passo 2, definido em 2026-11-18): a tarefa que a pessoa abriu pela tela (⌘N, o "+" da aba), sem o
 * dono no meio. O pedido é a primeira mensagem dela, escrita na própria tarefa; a conversa com o dono não a viu.
 */
export function molduraDaTarefaDaPessoa(titulo: string): string {
  return `[nod] Tarefa "${titulo}", aberta pela pessoa direto na tela de tarefas: o pedido abaixo é a primeira mensagem dela, escrita aqui, e a conversa com você não o viu. Ela acompanha por esta tela; faça o trabalho até o fim e devolva o que fez com devolver_resumo.\n`;
}

/**
 * "Levar o contexto da conversa" (Paper 3e, definido em 2026-11-18): as últimas falas da conversa com o dono, cada uma
 * cortada, com um teto no total. Sem isso a tarefa nasce limpa (Paper 3d), que é o padrão.
 */
export const FALAS_DO_CONTEXTO = 12;
export const CARACTERES_POR_FALA_DO_CONTEXTO = 600;
export const CARACTERES_DO_CONTEXTO = 6000;

export type FalaDoContexto = { autor: string; texto: string };

/** O bloco do contexto: as falas mais novas cabem primeiro; vazio quando não há fala. */
export function blocoDoContexto(falas: readonly FalaDoContexto[]): string {
  const linhas: string[] = [];
  let total = 0;
  for (const f of [...falas].slice(-FALAS_DO_CONTEXTO).reverse()) {
    const texto = f.texto.replace(/\s+/g, " ").trim();
    if (!texto) continue;
    const cortado = texto.length > CARACTERES_POR_FALA_DO_CONTEXTO ? `${texto.slice(0, CARACTERES_POR_FALA_DO_CONTEXTO - 1)}…` : texto;
    const linha = `- ${f.autor}: ${cortado}`;
    if (total + linha.length > CARACTERES_DO_CONTEXTO) break;
    total += linha.length;
    linhas.unshift(linha);
  }
  if (!linhas.length) return "";
  return `[nod] A pessoa trouxe para esta tarefa as últimas falas da conversa com você (contexto, não pedido novo):\n${linhas.join("\n")}`;
}

/** A entrada do primeiro turno da tarefa da pessoa: a moldura, o pedido, o contexto (se ela levou) e a linha de empurrar. */
export function entradaDaTarefaDaPessoa(p: { titulo: string; pedido: string; contexto?: readonly FalaDoContexto[] }): string {
  const contexto = blocoDoContexto(p.contexto ?? []);
  return `${molduraDaTarefaDaPessoa(p.titulo)}${p.pedido.trim()}\n\n${contexto ? `${contexto}\n\n` : ""}${linhaDeEmpurrar(false, false)}`;
}

/**
 * Como o dono segue depois que a rede de 2 min promove o turno dele a frente (definido em 2026-10-12, ADR-099, I8). Só
 * as capacidades declaradas e o anúncio da máquina decidem, nunca o nome do harness:
 * - `bifurcar`: o harness bifurca e a máquina do turno anunciou isso — a frente fica com a sessão e a próxima fala do
 *   dono segue numa cópia dela (`--fork-session`), como desde a #193;
 * - `largar_sessao`: retoma sessão mas a máquina não bifurca — a sessão vai com a frente e a conversa do dono a larga;
 *   o próximo turno do dono recebe o histórico recente (dois CLIs nunca dividem uma sessão);
 * - `historico`: o harness nem retoma sessão (Codex) — nada a largar, o dono já segue com o histórico.
 */
export type SeguimentoNaRede = "bifurcar" | "largar_sessao" | "historico";

export function seguimentoNaRede(capacidades: Pick<CapacidadesHarness, "retomaSessao" | "bifurcaSessao">, maquinaBifurca: boolean): SeguimentoNaRede {
  if (capacidades.bifurcaSessao && maquinaBifurca) return "bifurcar";
  return capacidades.retomaSessao ? "largar_sessao" : "historico";
}

/**
 * definido em 2026-10-12 (ADR-099, I4; decisão 5): a frente só empurra o branch que ela criou, e só quando o dono pede
 * (`pode_empurrar` de abrir_frentes, padrão false). A linha vai sempre na entrada, para a frente nunca ter de adivinhar.
 */
export function linhaDeEmpurrar(podeEmpurrar: boolean, temRepositorio: boolean): string {
  if (podeEmpurrar) return "O dono autorizou empurrar o seu branch e abrir PR.";
  return temRepositorio ? "Não empurre: devolva o branch e o SHA." : "Se mexer num repositório, não empurre: devolva o branch e o SHA.";
}

/** A moldura do pedido da task de antes das frentes (ADR-099, I2): o "Fazer aqui" de uma task antiga ainda a tira. */
function entradaDaTask(titulo: string, pedido: string, deRotina: boolean): string {
  return deRotina
    ? `[nod] Task "${titulo}", aberta pela sua rotina. Faça o trabalho até o fim e entregue o resultado.\n${pedido}`
    : `[nod] Task "${titulo}", aberta por você na conversa com a pessoa. Ela acompanha pela tela da task; faça o trabalho até o fim e entregue o resultado.\n${pedido}`;
}

/**
 * O pedido sem a moldura da task (definido em 2026-10-08, QA do épico): o "Fazer aqui" manda o pedido para a CONVERSA, e
 * a moldura dizia ao bot que a pessoa "acompanha pela tela da task" — que ele estava numa task que acabou de ser
 * desfeita. Entrada sem a moldura (a da rede é a mensagem da pessoa) volta como está.
 */
export function pedidoSemMoldura(titulo: string, entrada: string): string {
  for (const deRotina of [false, true]) {
    // revisto em 2026-10-12 (ADR-099, I2): a frente nasce com a moldura dela (molduraDaFrente); a task de antes, com esta.
    // ADR-187 §7 (2026-11-18): e a tarefa que a pessoa abriu pela tela (o contexto da conversa, se levou, fica no pedido).
    for (const moldura of [entradaDaTask(titulo, "", deRotina), molduraDaFrente(titulo, deRotina), molduraDaTarefaDaPessoa(titulo)]) {
      // revisto em 2026-10-12 (ADR-099, I4): a linha de empurrar é da frente; no dono ela não faz sentido.
      if (entrada.startsWith(moldura)) return semLinhaDeEmpurrar(entrada.slice(moldura.length));
    }
  }
  return entrada;
}

/**
 * ADR-187 §6 (definido em 2026-11-18, Paper 4k): o pedido que o dono escreveu ao abrir a frente, para o cartão "Pedido" da
 * tela da tarefa — a entrada do primeiro turno sem a linha de moldura do nod (uma linha só, que começa em "[nod] "; pela
 * linha e não pelo texto dela, porque a aba renomeia a tarefa e a moldura leva o título de antes) e sem a de empurrar.
 * Entrada sem moldura (a fala da pessoa na rede, a tarefa que ela abriu) não é pedido do dono: null.
 */
export function pedidoDoDono(entrada: string): string | null {
  const quebra = entrada.indexOf("\n");
  if (!entrada.startsWith("[nod] ") || quebra < 0) return null;
  const pedido = semLinhaDeEmpurrar(entrada.slice(quebra + 1)).trim();
  return pedido === "" ? null : pedido;
}

/** O pedido da frente sem a linha de empurrar (o "Fazer aqui" o devolve ao dono, que não devolve resumo nem branch). */
export function semLinhaDeEmpurrar(texto: string): string {
  for (const pode of [true, false]) {
    for (const temRepositorio of [true, false]) {
      const linha = linhaDeEmpurrar(pode, temRepositorio);
      if (texto.endsWith(linha)) return texto.slice(0, -linha.length).trimEnd();
    }
  }
  return texto;
}

/** definido em 2026-10-12 (ADR-099, I4): o branch da frente sai do slug da pasta dela (`<bot>/<slug>`): único por frente. */
export function branchDaFrente(pastaDaFrente: string): string {
  return `frente/${pastaDaFrente.slice(pastaDaFrente.lastIndexOf("/") + 1)}`;
}

/**
 * definido em 2026-10-12 (ADR-099 §6, I4): o incidente de 11/10 — várias tasks do mesmo bot empurravam no branch do PR
 * #845 e cancelavam a CI umas das outras. A saída é de forma, não trava (o hook não muda): cada frente na própria
 * worktree e no próprio branch, a partir do `branch_base`; empurra só o dela e só com autorização; o dono integra.
 */
export function worktreeDaFrente(pastaDaFrente: string, cloneDaMaquina?: string): string {
  // revisto em 2026-10-22 (NOD-315, ADR-119): com o clone da máquina (bare), a worktree nasce dele e a base é a ref remota
  // (origin/<branch_base>): no bare o branch nu não existe. O fetch quem fez foi o nod, antes do turno.
  const deOnde = cloneDaMaquina
    ? `a partir desse clone: git -C ${cloneDaMaquina} worktree add ~/nod/${pastaDaFrente}/<repo> -b ${branchDaFrente(pastaDaFrente)} origin/<branch_base> (o branch de onde a entrada mandou partir; sem ele, origin/HEAD). `
    : `a partir do clone que ela já tem: git -C <clone> fetch origin && git -C <clone> worktree add ~/nod/${pastaDaFrente}/<repo> -b ${branchDaFrente(pastaDaFrente)} <branch_base> (o branch de onde a entrada mandou partir; sem ele, origin/main). `;
  return `Para mexer num repositório, trabalhe numa worktree dentro da pasta desta frente, num branch só seu, ${deOnde}Commite só nesse branch e nunca empurre um branch que você não criou — nem o do PR que o pedido citar: nele quem empurra é o dono, depois de integrar. Empurre o seu branch ou abra PR só se a entrada disser que o dono autorizou; com ou sem isso, devolva o branch e o SHA no devolver_resumo. Quando a frente acaba, o nod apaga a worktree que não tem alteração por commitar (o branch fica no clone); a worktree fora desta pasta e o git que troca de branch ou grava fora dela são negados, para não atropelar o trabalho dela e dos colegas.`;
}

/** definido em 2026-10-12 (ADR-099, I4): o lembrete na linha "Frente atual", com ou sem terminal. */
export const BRANCH_NA_FRENTE_ATUAL = "Num repositório, o seu trabalho fica no seu branch: devolva o branch e o SHA, e empurre só se a entrada disser que o dono autorizou.";

/**
 * definido em 2026-10-12 (ADR-099 §6, I4): quem abre frentes (o dono, ou a execução de rotina) integra. Os branches das
 * frentes estão no mesmo clone: integrar é um merge na própria worktree, sem push; e só quem integra empurra no branch
 * do PR. `pode_empurrar` é para a frente que entrega o próprio PR, nunca para duas no mesmo branch.
 */
// revisto em 2026-10-22 (NOD-315, ADR-119): na máquina Linux a frente pode nascer do clone da máquina, não do seu: o
// branch dela fica no clone de onde a worktree nasceu, e o dono busca de lá.
export const DONO_INTEGRA = "Num repositório, dê a cada frente o repo e o branch_base de onde ela parte; cada uma trabalha no próprio branch (frente/…) e devolve o branch e o SHA. O branch da frente fica no clone de onde a worktree dela nasceu (o clone da máquina, ~/nod/.clones/<dono>/<repo>.git, quando houver). Ao receber os resultados, integre esses branches na sua worktree (git merge, sem push; se a sua worktree não nasceu desse clone, traga o branch antes com git fetch <esse clone> <branch>) e só você empurra no branch do PR. pode_empurrar: true só para a frente que deve empurrar o próprio branch e abrir o PR dela; nunca peça a duas frentes que empurrem no mesmo branch.";

/** "Começou a frente X" ou "Começou 3 frentes: A, B e C" (texto da mensagem `sistema`; a web desenha pelo payload). */
export function textoFrentesAbertas(titulos: readonly string[]): string {
  if (titulos.length === 1) return `Começou a tarefa ${titulos[0]}`;
  const lista = titulos.length === 2 ? `${titulos[0]} e ${titulos[1]}` : `${titulos.slice(0, -1).join(", ")} e ${titulos.at(-1)}`;
  return `Começou ${titulos.length} tarefas: ${lista}`;
}

/**
 * O título do lote (definido em 2026-10-18, plano chat limpo, PR 5, decisão 17): o `titulo_do_lote` que o modelo mandou
 * (`lotes_de_frentes.titulo`, 0092; null = não mandou ou sem letra); sem ele, uma frente dá o título dela e várias dão
 * "N frentes". É o que a pílula do PR 8 e o progresso na fala do PR 7 mostram, mesmo com a fala que abriu o lote fora da
 * janela.
 */
export function tituloDoLote(titulo: string | null, frentes: number, primeira: string): string {
  if (titulo) return titulo;
  return frentes === 1 ? primeira : `${frentes} tarefas`;
}

/** definido em 2026-10-12 (I2): da última fala da frente, o resumo sem chamada leva até isto (o teto do texto é 1000). */
export const CORTE_DA_ULTIMA_FALA = 600;

function cortar(texto: string): string {
  const limpo = texto.replace(/\s+/g, " ").trim();
  // Validação de 2026-11-17 (ADR-187): o corte diz que é do nod. Sem isso o dono lia a fala cortada como texto que veio
  // pela metade e dizia à pessoa que faltava o fim (a tarefa da rede tinha entregue 9.262 caracteres inteiros).
  return limpo.length > CORTE_DA_ULTIMA_FALA ? `${limpo.slice(0, CORTE_DA_ULTIMA_FALA - 1).trimEnd()}… [o nod cortou este resumo aqui; a fala original tem ${texto.trim().length} caracteres e não veio cortada]` : limpo;
}

/**
 * definido em 2026-10-12 (ADR-099, I2): a frente acabou sem chamar `devolver_resumo` — o servidor monta o resumo com a
 * última fala dela (cortada) e o estado, para o dono nunca receber um lote com buraco. Só para estado final.
 */
/** NOD-264 (C21): o texto do motivo `pergunta_vencida`, no resumo e no retorno do lote. */
export const TEXTO_PERGUNTA_VENCIDA = "a pergunta à pessoa venceu sem resposta";

/** NOD-282 (G5): o texto do mesmo motivo quando o que venceu foi um pedido de aprovação. */
export const TEXTO_APROVACAO_VENCIDA = "o pedido de aprovação venceu sem resposta";

/** NOD-282 (G5): o texto da decisão que venceu, pelo tipo dela (sem tipo: o da pergunta, o de antes). */
export function textoDaDecisaoVencida(tipo: TipoDecisao | null | undefined): string {
  return tipo === "aprovacao" ? TEXTO_APROVACAO_VENCIDA : TEXTO_PERGUNTA_VENCIDA;
}

export function resumoSemChamada(p: { estado: EstadoTrabalho; ultimaFala: string | null; perguntaVencida?: boolean; vencidaTipo?: TipoDecisao | null }): ResumoFrente {
  // NOD-264 (C21): a pergunta venceu sem resposta — o resumo leva o motivo, nunca a pergunta (a última fala é ela).
  if (p.estado === "falhou" && p.perguntaVencida) return { feito: `A frente parou: ${textoDaDecisaoVencida(p.vencidaTipo)}.`, falta: "Decidir com a pessoa se abre a frente de novo." };
  const fala = p.ultimaFala && p.ultimaFala.trim() !== "" ? cortar(p.ultimaFala) : null;
  if (p.estado === "falhou") {
    return { feito: fala ? `A frente falhou antes de devolver o resumo. Última fala: ${fala}` : "A frente falhou antes de devolver o resumo.", falta: "Conferir o que ficou pela metade e decidir se abre de novo." };
  }
  if (p.estado === "parado") return { feito: fala ? `A pessoa parou a frente antes do fim. Última fala: ${fala}` : "A pessoa parou a frente antes do fim." };
  return { feito: fala ?? "A frente terminou sem dizer o que fez." };
}

/** O que o bot lê quando o resumo volta recusado: o campo e o jeito de corrigir, nunca um corte silencioso. */
export function instrucaoDoResumoInvalido(erro: ErroResumo, campo?: string): string {
  const qual = campo ? ` (${campo})` : "";
  const como: Record<ErroResumo, string> = {
    nao_e_objeto: "mande os campos feito, pr, sha, branch e falta",
    campo_desconhecido: "use só feito, pr, sha, branch e falta",
    feito_vazio: "diga em feito o que você fez",
    texto_invalido: "os textos são strings",
    texto_longo: "cada texto tem até 1000 caracteres; escreva mais curto",
    pr_invalido: "pr é o número do PR, inteiro positivo",
    sha_invalido: "sha é o commit, de 7 a 40 caracteres hexadecimais minúsculos",
    resumo_grande: "o resumo passou do tamanho; escreva mais curto",
  };
  return `O resumo não foi guardado${qual}: ${como[erro]}. Chame devolver_resumo de novo.`;
}
