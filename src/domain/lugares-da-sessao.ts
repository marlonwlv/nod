/**
 * definido em 2026-11-27 (ADR-198): a sessão do CLI só é retomada enquanto os LUGARES onde o bot trabalha não melhoraram.
 *
 * Origem: um bot passou cinco dias com "seu computador está fora do ar… não tente contornar" no prompt. Quando o
 * navegador entrou no plano e o aviso saiu, a mesma sessão seguiu respondendo "o navegador continua indisponível" sem
 * chamar ferramenta nenhuma: a memória da sessão (as tentativas que falharam, os avisos, as próprias recusas) pesava mais
 * que o prompt novo. Convencer o modelo a esquecer depende de ele obedecer; largar a sessão não depende.
 *
 * A regra é assimétrica de propósito:
 * - um lugar que ENTRA no plano (não estava, estava desligado ou fora do ar) larga a sessão;
 * - um aviso de "desligado" ou "fora do ar" que SOME do prompt também larga (a sessão guardou a proibição);
 * - um lugar que SAI não larga nada: o prompt do turno diz o estado e não há crença errada a desfazer.
 *
 * O computador da pessoa (ADR-197) fica gravado na marca mas não dispara a regra: ele entra e sai com a tampa do
 * laptop, e uma sessão nova por dia custaria mais memória do que o risco que evita. O alarme da ADR-198 mede se isso
 * precisa mudar.
 */

/** `ausente`: fora do plano e sem aviso. `no_plano`: as ferramentas estão no turno. Os outros dois: fora, com o aviso no prompt. */
export const ESTADOS_DO_LUGAR = ["ausente", "no_plano", "desligado", "fora_do_ar"] as const;
export type EstadoDoLugar = (typeof ESTADOS_DO_LUGAR)[number];

export type LugaresDoTurno = {
  computador: EstadoDoLugar;
  navegador: "ausente" | "no_plano";
  seuComputador: "ausente" | "no_plano";
};

export type LugarQueMudou = { lugar: "computador" | "navegador"; mudanca: "entrou" | "aviso_saiu" };

const ORDEM = ["computador", "navegador", "seuComputador"] as const;
const comAviso = (e: EstadoDoLugar): boolean => e === "desligado" || e === "fora_do_ar";

/** A marca gravada no turno (`turnos.lugares`): texto curto, estável e legível numa consulta. */
export function marcaDosLugares(l: LugaresDoTurno): string {
  return ORDEM.map((k) => `${k}=${l[k]}`).join(";");
}

/** Lê a marca. Texto que esta versão não entende (servidor mais novo, lixo) volta null: sem comparação, sem largar sessão. */
export function lerMarcaDosLugares(marca: string | null | undefined): LugaresDoTurno | null {
  if (!marca) return null;
  const pares = new Map(marca.split(";").map((p) => p.split("=") as [string, string | undefined]));
  const ler = (k: string): EstadoDoLugar | null => {
    const v = pares.get(k);
    return (ESTADOS_DO_LUGAR as readonly string[]).includes(v ?? "") ? (v as EstadoDoLugar) : null;
  };
  const computador = ler("computador");
  const navegador = ler("navegador");
  const seuComputador = ler("seuComputador");
  if (!computador || (navegador !== "ausente" && navegador !== "no_plano") || (seuComputador !== "ausente" && seuComputador !== "no_plano")) return null;
  return { computador, navegador, seuComputador };
}

/**
 * O que melhorou entre o último turno da sessão e o turno de agora. Lista vazia = a sessão pode ser retomada.
 * `antes` nulo (turno de antes da coluna) = não se sabe: nada a largar.
 */
export function lugaresQueMelhoraram(antes: LugaresDoTurno | null, agora: LugaresDoTurno): LugarQueMudou[] {
  if (!antes) return [];
  const mudou: LugarQueMudou[] = [];
  for (const lugar of ["computador", "navegador"] as const) {
    const a: EstadoDoLugar = antes[lugar];
    const b: EstadoDoLugar = agora[lugar];
    if (b === "no_plano" && a !== "no_plano") mudou.push({ lugar, mudanca: "entrou" });
    else if (comAviso(a) && !comAviso(b)) mudou.push({ lugar, mudanca: "aviso_saiu" });
  }
  return mudou;
}

const NOME: Record<LugarQueMudou["lugar"], { nome: string; ferramentas: string }> = {
  computador: { nome: "o seu computador", ferramentas: "computador_*" },
  navegador: { nome: "o seu navegador", ferramentas: "navegador_*" },
};

/**
 * A frase que vai na entrada do turno que recomeçou por causa dos lugares, depois do aviso de recomeço. Fala só do que
 * está NESTE turno e manda conferir pela ferramenta: o histórico que acompanha a sessão nova ainda traz as recusas antigas.
 */
export function avisoDosLugares(mudou: readonly LugarQueMudou[], agora: LugaresDoTurno): string | null {
  if (!mudou.length) return null;
  const entrou = mudou.filter((m) => m.mudanca === "entrou").map((m) => `${NOME[m.lugar].nome} (${NOME[m.lugar].ferramentas})`);
  const noPlano = (["navegador", "computador"] as const).filter((l) => agora[l] === "no_plano").map((l) => `${NOME[l].nome} (${NOME[l].ferramentas})`);
  const lista = (l: readonly string[]) => (l.length > 1 ? `${l.slice(0, -1).join(", ")} e ${l.at(-1)}` : l[0] ?? "");
  const oQueTem = entrou.length
    ? `Agora você tem ${lista(entrou)} neste turno.`
    : noPlano.length ? `O aviso de indisponibilidade de antes saiu; neste turno você tem ${lista(noPlano)}.` : "O aviso de indisponibilidade de antes saiu.";
  return `[nod] Os lugares onde você trabalha mudaram desde as últimas falas. ${oQueTem} O que o histórico diz sobre navegador ou computador indisponível, fora do ar ou desligado descreve aquele momento e não vale mais: quem diz se um lugar funciona é a ferramenta deste turno. Se a tarefa pedir, chame a ferramenta e relate o que ela devolver; não responda "indisponível" sem ter chamado.`;
}

// ---------------------------------------------------------------------------------------------------------------------
// O alarme (ADR-198): o bot disse que um lugar não funciona sem ter chamado a ferramenta dele

const SEM_ACENTO = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const QUEM: Record<LugarQueMudou["lugar"], RegExp> = {
  navegador: /\b(navegador|web|internet|chrome|site|pagina|aba)\b/,
  computador: /\b(computador|maquina)\b/,
};
const RECUSA = /\b(indisponivel|indisponiveis|fora do ar|nao esta disponivel|nao estao disponiveis|nao esta acessivel|sem acesso|nao tenho (acesso|como)|nao (consigo|consegui|foi possivel|pode ser abert[ao])|desligad[ao]|desconectad[ao])\b/;

/**
 * Os lugares que estavam no plano do turno, que o bot não chamou nenhuma vez, e sobre os quais a fala dele diz
 * "indisponível", "fora do ar", "desligado" ou "não consigo" na mesma frase. É heurística de alarme, não regra de produto:
 * conta para o painel e para o log, nunca muda o turno. Com uma chamada ao lugar, a frase é relato do que a ferramenta
 * devolveu e não conta.
 */
export function lugaresRecusadosSemTentar(p: { texto: string; chamadas: readonly string[]; lugares: LugaresDoTurno | null }): LugarQueMudou["lugar"][] {
  if (!p.lugares || !p.texto) return [];
  const frases = SEM_ACENTO(p.texto).split(/[.!?\n;]+/);
  // Com o navegador no plano e o computador fora dele, a recusa que culpa "o computador" ou "a máquina" é a mesma
  // recusa: foi com essas palavras que o Codex recusou na sonda de 2026-11-27, sem dizer "navegador" nenhuma vez.
  const fala = (lugar: LugarQueMudou["lugar"], f: string): boolean =>
    QUEM[lugar].test(f) || (lugar === "navegador" && p.lugares!.computador !== "no_plano" && QUEM.computador.test(f));
  return (["navegador", "computador"] as const).filter((lugar) =>
    p.lugares![lugar] === "no_plano"
    && !p.chamadas.some((c) => c.includes(`${lugar}_`))
    && frases.some((f) => fala(lugar, f) && RECUSA.test(f)));
}
