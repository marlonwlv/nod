/**
 * ADR-174 (2026-11-12, tela 09b do Paper, "Preparando a Lia"): o preparo de um bot novo, com a porcentagem e a lista de
 * passos. Comportamento de referência ("Getting your team ready…" → "Waking your computer…" → "Setting up… {0}%",
 * e o erro "X couldn't finish setting up" com "Try again" / "Check for issues"); o código é nosso.
 *
 * Só o modelo, puro e sem DOM: os passos, a porcentagem e o texto. Quem roda os passos de verdade (criar o bot, aplicar
 * cor e forma, conferir o computador, mandar a primeira mensagem) é `rodarPreparo`, com as funções que quem chama passa.
 * A porcentagem nunca mente para cima: cada passo feito vale a sua fatia; o passo em andamento anda no máximo até 90% da
 * fatia dele, devagar, e só fecha quando a resposta chega.
 */

export type IdPassoPreparo = "criado" | "apps" | "computador" | "instrucoes";
export type SituacaoPasso = "feito" | "agora" | "falta" | "erro";
export type PassoPreparo = { id: IdPassoPreparo; rotulo: string; detalhe: string | null; situacao: SituacaoPasso };

export type EstadoPreparo = {
  nome: string;
  passos: PassoPreparo[];
  /** 0–100, o que a barra mostra (já com o avanço suave do passo em andamento). */
  porcento: number;
  /** Quanto do passo em andamento já foi mostrado (0–0,9). */
  andamento: number;
  /** O texto do erro (null = sem erro). */
  erro: string | null;
  pronto: boolean;
};

/** O que cada passo diz na linha e no subtítulo enquanto roda. */
const ROTULOS: Record<IdPassoPreparo, { feito: string; agora: string; erro: string; sub: string }> = {
  criado: { feito: "Bot criado", agora: "Criando o bot…", erro: "O bot não foi criado", sub: "Preparando a sua equipe…" },
  apps: { feito: "Apps conectados", agora: "Conectando os apps…", erro: "Os apps não conectaram", sub: "Dando acesso aos apps…" },
  computador: { feito: "Computador acordado", agora: "Acordando o computador…", erro: "O computador não respondeu", sub: "Acordando o computador. Leva uns 2 minutos." },
  instrucoes: { feito: "Instruções lidas", agora: "Lendo as instruções", erro: "A primeira mensagem não saiu", sub: "Lendo as instruções…" },
};

/** Sem apps escolhidos, o passo "apps" vira "Cor e forma" (o perfil do bot), para a lista continuar com quatro passos. */
const SEM_APPS = { feito: "Cor e forma", agora: "Aplicando cor e forma…", erro: "Cor e forma não salvaram", sub: "Vestindo o bot…" };

export function novoPreparo(nome: string, apps: readonly string[] = []): EstadoPreparo {
  const passos: PassoPreparo[] = (["criado", "apps", "computador", "instrucoes"] as const).map((id) => ({
    id,
    rotulo: rotuloDe(id, "falta", apps.length > 0),
    detalhe: id === "apps" && apps.length ? apps.join(", ") : null,
    situacao: "falta",
  }));
  return { nome: nome.trim() || "seu bot", passos, porcento: 0, andamento: 0, erro: null, pronto: false };
}

function rotuloDe(id: IdPassoPreparo, s: SituacaoPasso, comApps: boolean): string {
  const r = id === "apps" && !comApps ? SEM_APPS : ROTULOS[id];
  return s === "feito" ? r.feito : s === "erro" ? r.erro : r.agora;
}

const comApps = (p: EstadoPreparo): boolean => p.passos.some((x) => x.id === "apps" && x.detalhe !== null);

/** Marca um passo; a porcentagem volta para o que os passos feitos valem (o andamento recomeça). */
export function marcar(p: EstadoPreparo, id: IdPassoPreparo, situacao: SituacaoPasso, erro: string | null = null): EstadoPreparo {
  const apps = comApps(p);
  const passos = p.passos.map((x) => (x.id === id ? { ...x, situacao, rotulo: rotuloDe(id, situacao, apps) } : x));
  const pronto = passos.every((x) => x.situacao === "feito");
  const proximo = { ...p, passos, andamento: 0, erro: situacao === "erro" ? erro ?? `${p.nome} não terminou de se preparar.` : null, pronto };
  return { ...proximo, porcento: porcentoDe(proximo) };
}

/** A porcentagem dos passos feitos mais o andamento do passo atual; 100 só quando todos estão feitos. */
export function porcentoDe(p: Pick<EstadoPreparo, "passos" | "andamento">): number {
  const fatia = 100 / p.passos.length;
  const feitos = p.passos.filter((x) => x.situacao === "feito").length;
  const agora = p.passos.some((x) => x.situacao === "agora") ? p.andamento : 0;
  return Math.min(100, Math.round(feitos * fatia + agora * fatia));
}

/** Um tique do relógio (a cada ~120 ms): o passo em andamento anda um pouco, cada vez mais devagar, até 90% da fatia. */
export function tique(p: EstadoPreparo): EstadoPreparo {
  if (p.erro || p.pronto || !p.passos.some((x) => x.situacao === "agora")) return p;
  const andamento = Math.min(0.9, p.andamento + (0.9 - p.andamento) * 0.06);
  return { ...p, andamento, porcento: porcentoDe({ passos: p.passos, andamento }) };
}

/** O subtítulo: o do passo em andamento, o erro, ou o fim. */
export function subtituloDoPreparo(p: EstadoPreparo): string {
  if (p.erro) return p.erro;
  if (p.pronto) return `${p.nome} está pronto para trabalhar.`;
  const atual = p.passos.find((x) => x.situacao === "agora");
  if (!atual) return ROTULOS.criado.sub;
  return atual.id === "apps" && !comApps(p) ? SEM_APPS.sub : ROTULOS[atual.id].sub;
}

/** As funções que fazem cada passo de verdade. Cada uma lança erro para parar o preparo naquele passo. */
export type EtapasDoPreparo = {
  criado: () => Promise<void>;
  apps: () => Promise<void>;
  computador: () => Promise<void>;
  instrucoes: () => Promise<void>;
};

/** Mensagem curta do erro de um passo (o que a pessoa lê no cartão "Se der erro"). */
export class ErroDoPreparo extends Error {}

/**
 * Roda os passos que ainda não estão feitos, na ordem, avisando cada mudança. "Tentar de novo" chama de novo com o
 * estado que parou: o que já foi feito não repete (o bot não nasce duas vezes).
 */
export async function rodarPreparo(inicio: EstadoPreparo, etapas: EtapasDoPreparo, aoMudar: (p: EstadoPreparo) => void): Promise<EstadoPreparo> {
  let p: EstadoPreparo = { ...inicio, erro: null, passos: inicio.passos.map((x) => (x.situacao === "erro" ? { ...x, situacao: "falta" as const } : x)) };
  for (const passo of p.passos) {
    if (passo.situacao === "feito") continue;
    p = marcar(p, passo.id, "agora");
    aoMudar(p);
    try {
      await etapas[passo.id]();
    } catch (e) {
      p = marcar(p, passo.id, "erro", e instanceof ErroDoPreparo ? e.message : null);
      aoMudar(p);
      return p;
    }
    p = marcar(p, passo.id, "feito");
    aoMudar(p);
  }
  return p;
}
