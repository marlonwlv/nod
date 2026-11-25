import type { LugarNavegador } from "../contracts/navegador-do-bot.ts";

/**
 * Onde o Chrome do bot roda (ADR-190; quadros M e N do Paper). Puro.
 *
 * definido em 2026-11-20 (Marlon: "Pro usuário só deveria se importar se continua funcionando com computador fechado
 * ou não"): a pessoa responde UMA pergunta por bot, "Continuar com o seu Mac desligado".
 * - Desligado (padrão): o navegador roda no Mac dela, pelo app do nod.
 * - Ligado: roda fora do Mac. Sem máquina sempre ligada, "no nod" (o servidor). Com uma, nela. Com várias, na mesma em
 *   que o computador do bot já mora; se ele não mora em nenhuma, na primeira que a pessoa conectou.
 * - Quem não tem o app no computador (só web ou celular) não tem Mac para desligar: é sempre fora do Mac.
 * - A máquina escolhida fora do ar (ou cheia) na hora: roda no nod daquela vez, a não ser que a pessoa tenha travado
 *   "Só na <máquina>" — aí espera.
 */
export type MaquinaSempreLigada = { id: string; nome: string; ligada: boolean };

export type EntradaLugar = {
  /** A pessoa tem o app do nod num computador (Mac ou PC). */
  temApp: boolean;
  /** O nome do aparelho da pessoa ("seu Mac", "seu PC"). */
  nomeDoAparelho: string;
  /** O app está conectado agora. */
  aparelhoLigado: boolean;
  /** A resposta da pergunta (o interruptor). */
  continuaSemMac: boolean;
  /** As máquinas sempre ligadas da pessoa, na ordem em que ela conectou. */
  maquinas: readonly MaquinaSempreLigada[];
  /** A máquina onde o computador do bot mora, se é uma das sempre ligadas. */
  maquinaDoComputador: string | null;
  /** Escolha explícita na lista ("Na vm-rio"), ou "nod" para forçar o servidor. */
  escolha: string | null;
  /** "Só na vm-sp, mesmo que atrase". */
  soNaMaquina: boolean;
};

export type ResolucaoLugar =
  | { tipo: "roda"; lugar: LugarNavegador; desvio: null | { de: string; motivo: "fora_do_ar" } }
  /** Mac desligado com o interruptor desligado, ou máquina travada fora do ar: a Ada espera. */
  | { tipo: "espera"; motivo: "aparelho_desligado" | "maquina_fora_do_ar"; nome: string };

/** A máquina que vale quando o bot continua sem o Mac (antes de olhar se está ligada). */
export function maquinaPreferida(e: Pick<EntradaLugar, "maquinas" | "maquinaDoComputador" | "escolha">): MaquinaSempreLigada | null {
  if (e.escolha === "nod") return null;
  if (e.escolha) {
    const m = e.maquinas.find((x) => x.id === e.escolha);
    if (m) return m;
  }
  if (e.maquinaDoComputador) {
    const m = e.maquinas.find((x) => x.id === e.maquinaDoComputador);
    if (m) return m;
  }
  return e.maquinas[0] ?? null;
}

export function resolverLugar(e: EntradaLugar): ResolucaoLugar {
  const foraDoMac = e.continuaSemMac || !e.temApp;
  if (!foraDoMac) {
    if (!e.aparelhoLigado) return { tipo: "espera", motivo: "aparelho_desligado", nome: e.nomeDoAparelho };
    return { tipo: "roda", lugar: { tipo: "mac", nome: e.nomeDoAparelho }, desvio: null };
  }
  const m = maquinaPreferida(e);
  if (!m) return { tipo: "roda", lugar: { tipo: "nod" }, desvio: null };
  if (m.ligada) return { tipo: "roda", lugar: { tipo: "maquina", maquinaId: m.id, nome: m.nome }, desvio: null };
  if (e.soNaMaquina) return { tipo: "espera", motivo: "maquina_fora_do_ar", nome: m.nome };
  return { tipo: "roda", lugar: { tipo: "nod" }, desvio: { de: m.nome, motivo: "fora_do_ar" } };
}

/**
 * O bot como sujeito no começo da frase (M e N no Paper: "A Ada continua no nod"). Sem o gênero no agente, nome terminado
 * em "a" é feminino: a mesma régua de web/lib/navegador-vista.ts (feminino).
 */
export function sujeitoDoBot(nome: string): string {
  const n = nome.trim();
  // A primeira palavra decide (2026-11-25): "Leitor QA" é "O Leitor QA".
  return `${/a$/u.test((n.split(/\s+/u)[0] ?? "").toLowerCase()) ? "A" : "O"} ${n}`;
}

/** "ela"/"ele" a partir do sujeito ("A Ada" → "ela"); sem artigo, nada (a frase segue sem o pronome). */
function pronomeDoSujeito(bot: string): string {
  return bot.startsWith("A ") ? "ela " : bot.startsWith("O ") ? "ele " : "";
}

/** "no nod", "na vm-sp", "no seu Mac": o fim da linha que diz onde (N, item 4). */
export function fraseDoLugar(lugar: LugarNavegador): string {
  if (lugar.tipo === "nod") return "no nod";
  if (lugar.tipo === "mac") return `no ${lugar.nome}`;
  return `na ${lugar.nome}`;
}

/** O subtítulo da linha "Com o Mac desligado" no painel do bot (M1, J2, N2). */
export function subtituloDoInterruptor(e: Pick<EntradaLugar, "continuaSemMac" | "maquinas" | "maquinaDoComputador" | "escolha" | "nomeDoAparelho">, bot: string): string {
  if (!e.continuaSemMac) return `${bot} espera o ${e.nomeDoAparelho.replace(/^seu /, "")} ligar`;
  const m = maquinaPreferida(e);
  return m ? `${bot} continua na ${m.nome}` : `${bot} continua no nod`;
}

/** A frase de baixo da pergunta (N, item 1). */
export function fraseDaPergunta(e: Pick<EntradaLugar, "maquinas" | "maquinaDoComputador" | "escolha">, bot: string): { texto: string; lugar: string; resto: string; trocar: boolean } {
  const m = maquinaPreferida(e);
  if (!m) return { texto: `${bot} continua`, lugar: "no nod", resto: "", trocar: false };
  if (e.maquinas.length === 1) return { texto: `${bot} continua`, lugar: `na ${m.nome}`, resto: ", que fica sempre ligada", trocar: false };
  const jaMora = e.maquinaDoComputador === m.id;
  // N (Paper YSO-0): "A Ada continua na vm-sp, onde ela já trabalha."
  return { texto: `${bot} continua`, lugar: `na ${m.nome}`, resto: jaMora ? `, onde ${pronomeDoSujeito(bot)}já trabalha` : "", trocar: true };
}

/** Avisos da conversa quando algo muda (N, "Quando algo muda"). Nenhum pergunta antes; os que dá para desfazer dizem. */
export type AvisoDeLugar =
  | { tipo: "passou_para_maquina"; texto: string; desfazer: true }
  | { tipo: "fez_no_nod"; texto: string; travar: string }
  | { tipo: "maquina_saiu"; texto: string };

export function avisoPrimeiraMaquina(nome: string): AvisoDeLugar {
  return { tipo: "passou_para_maquina", texto: `Com o Mac desligado, agora continuo na ${nome}.`, desfazer: true };
}

export function avisoForaDoAr(nome: string, hora: string): AvisoDeLugar {
  return { tipo: "fez_no_nod", texto: `A ${nome} estava fora do ar às ${hora}. Fiz no nod.`, travar: `Só na ${nome}, mesmo que atrase` };
}

export function avisoMaquinaSaiu(nome: string): AvisoDeLugar {
  return { tipo: "maquina_saiu", texto: `A ${nome} saiu da sua conta. Continuo no nod.` };
}

/** O que a espera diz (ADR-190, N): a causa que a vista mostra e a instrução que o bot lê (sem "servidor", "VM" nem "nuvem"). */
export type EsperaDoNavegador = { motivo: "aparelho_desligado" | "maquina_fora_do_ar" | "app_sem_navegador"; causa: string; instrucao: string };

const maiuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * definido em 2026-11-20: a espera em palavras. `appSemNavegador` = o app do aparelho está conectado mas não roda o
 * navegador (versão antiga): a causa pede para atualizar, em vez de dizer que o Mac está desligado.
 */
export function esperaDoNavegador(r: Extract<ResolucaoLugar, { tipo: "espera" }>, appSemNavegador = false): EsperaDoNavegador {
  if (r.motivo === "maquina_fora_do_ar") {
    return {
      motivo: "maquina_fora_do_ar",
      causa: `A ${r.nome} está fora do ar`,
      instrucao: `Seu navegador só roda na ${r.nome} (a pessoa pediu "Só na ${r.nome}"), e ela está fora do ar agora. Nada foi executado. Siga com o que dá sem o navegador; se não der, diga à pessoa numa frase que você faz isso quando a ${r.nome} voltar e encerre o turno.`,
    };
  }
  const aparelho = r.nome.replace(/^seu /, "");
  if (appSemNavegador) {
    return {
      motivo: "app_sem_navegador",
      causa: `O app do nod no ${r.nome} precisa ser atualizado para o navegador`,
      instrucao: `Seu navegador roda no ${aparelho} da pessoa, mas o app do nod de lá ainda não roda o navegador (precisa atualizar). Nada foi executado. Siga com o que dá sem o navegador; se não der, peça numa frase para ela atualizar o app do nod no ${aparelho} e encerre o turno.`,
    };
  }
  return {
    motivo: "aparelho_desligado",
    causa: `${maiuscula(r.nome)} está desligado`,
    instrucao: `Seu navegador roda no ${aparelho} da pessoa, e ele está desligado (ou com o app do nod fechado) agora. Nada foi executado. Siga com o que dá sem o navegador; se não der, diga à pessoa numa frase que você faz isso quando o ${aparelho} ligar (ou que ela pode deixar você continuar com o ${aparelho} desligado) e encerre o turno.`,
  };
}

/**
 * A hora em que o Mac costuma estar desligado (M2/J1: a pergunta vem "na primeira rotina fora do horário").
 *
 * definido em 2026-11-20: o nod ainda não guarda o histórico de quando o Mac da pessoa fica ligado; sem ele, vale a
 * heurística "fora de 8h–20h" (das 20h às 7h59 o Mac costuma estar fechado). Quando houver histórico (as presenças do app),
 * esta função passa a recebê-lo.
 */
export const USO_DO_MAC = { de: 8, ate: 20 } as const;
export function macCostumaEstarDesligado(hora: number): boolean {
  return hora < USO_DO_MAC.de || hora >= USO_DO_MAC.ate;
}

/** A hora e o minuto de um instante num fuso IANA (a da rotina; padrão, o de São Paulo). */
export function horaNoFuso(instante: number, fusoIana = "America/Sao_Paulo"): { h: number; m: number } {
  let partes: Intl.DateTimeFormatPart[];
  try { partes = new Intl.DateTimeFormat("en-US", { timeZone: fusoIana, hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(new Date(instante)); }
  catch { partes = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(new Date(instante)); }
  const n = (t: string) => Number(partes.find((p) => p.type === t)?.value ?? 0);
  return { h: n("hour") % 24, m: n("minute") };
}

/** "Às 3h", "À 1h", "Às 22h30" (o começo do cartão M2/J1). */
export function textoDaHora(t: { h: number; m: number }): string {
  const hora = t.m ? `${t.h}h${String(t.m).padStart(2, "0")}` : `${t.h}h`;
  return `${t.h <= 1 ? "À" : "Às"} ${hora}`;
}

/** O cartão M2/J1 em palavras (o nome do bot e do aparelho no lugar de "a Ada" e "seu Mac"). */
export function cartaoDaPergunta(hora: string, nomeDoAparelho: string, bot: string): { titulo: string; texto: string; sim: string; nao: string } {
  const aparelho = nomeDoAparelho.replace(/^seu /, "");
  return {
    titulo: `${hora} ${nomeDoAparelho} costuma estar desligado`,
    // M2/J1 (Paper Y4U-0): "Para essa rotina rodar, a Ada precisa…" (o sujeito no meio da frase, com minúscula).
    texto: `Para essa rotina rodar, ${bot.replace(/^([AO]) /u, (_, a: string) => `${a.toLowerCase()} `)} precisa continuar com ele desligado.`,
    sim: `Continuar com o ${aparelho} desligado`,
    nao: `Só com o ${aparelho} ligado`,
  };
}
