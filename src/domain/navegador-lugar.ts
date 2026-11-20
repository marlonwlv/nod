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
  return { texto: `${bot} continua`, lugar: `na ${m.nome}`, resto: jaMora ? ", onde já trabalha" : "", trocar: true };
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
