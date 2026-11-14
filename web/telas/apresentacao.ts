import type { CorAgente, FormaAgente } from "../../src/contracts/agente.ts";
import type { EstadoMascote } from "../lib/mascote.ts";
import type { EstadoPreparo } from "../lib/preparo.ts";
import { COR_PADRAO, FORMA_PADRAO, NOME_MAX } from "./criar-bot.ts";

/**
 * ADR-174 (2026-11-12, tela 13 do Paper): o onboarding inteiro, em 10 passos curtos com o personagem como fio
 * condutor — boas-vindas, conhecer, "tem o próprio computador", dar um trabalho, delegar, função, como conheceu, conectar
 * apps, criar o bot (cor e forma) e preparando com %. Comportamento e visual de referência; os textos são os do protótipo do
 * Paper. Substitui o "olá" de 3,3 s da ADR-077: a ligação continua como opção ("Prefiro conversar por voz"), que segue o
 * caminho de antes (a IA dos bots, a ligação e os cards).
 *
 * Aqui só o modelo, puro e sem DOM (tests/unit/web/apresentacao.test.ts); o desenho é React (ADR-179,
 * web/react/onboarding/apresentacao.tsx). Quem guarda o passo, roda o preparo e fala com o servidor é
 * web/telas/onboarding-controle.ts.
 */

export const PASSOS = ["boas-vindas", "conhecer", "computador", "trabalho", "delegar", "funcao", "origem", "apps", "criar", "preparando"] as const;
export type PassoApresentacao = (typeof PASSOS)[number];

export const FUNCOES = ["Produto", "Vendas", "Atendimento", "Finanças", "Operações", "Vida pessoal"] as const;
export const ORIGENS = ["X", "Instagram", "YouTube", "LinkedIn", "Busca", "Amigo ou colega", "Assistente de IA"] as const;
/** Os apps do passo 8: o Google primeiro (o mais comum), marcado "Sugerido" quando o e-mail é do Google. */
export const APPS = [
  { slug: "gmail", nome: "Gmail" },
  { slug: "googlecalendar", nome: "Google Agenda" },
  { slug: "slack", nome: "Slack" },
  { slug: "linear", nome: "Linear" },
] as const;

/** Por função, um nome e um primeiro trabalho sugeridos para o bot do passo 9 (a pessoa troca os dois). */
export const SUGESTAO_POR_FUNCAO: Record<(typeof FUNCOES)[number], { nome: string; tarefa: string }> = {
  Produto: { nome: "Lia", tarefa: "Organize as ideias desta semana em issues" },
  Vendas: { nome: "Bia", tarefa: "Liste os leads sem resposta há mais de 3 dias" },
  Atendimento: { nome: "Téo", tarefa: "Resuma os chamados abertos de hoje" },
  Finanças: { nome: "Nina", tarefa: "Cobre as faturas vencidas desta semana" },
  Operações: { nome: "Rui", tarefa: "Faça a daily do time com o que andou ontem" },
  "Vida pessoal": { nome: "Lua", tarefa: "Organize minha semana na agenda" },
};

export type EstadoApresentacao = {
  passo: number;
  funcao: string | null;
  origem: string | null;
  /** Os slugs dos apps conectados neste onboarding. */
  apps: string[];
  nome: string;
  forma: FormaAgente;
  cor: CorAgente;
  /** A primeira mensagem para o bot (o campo do passo 9). */
  primeira: string;
  preparo: EstadoPreparo | null;
  /** O slug do app cujo login está aberto agora. */
  conectando: string | null;
};

export function apresentacaoInicial(): EstadoApresentacao {
  return { passo: 0, funcao: null, origem: null, apps: [], nome: "", forma: FORMA_PADRAO, cor: COR_PADRAO, primeira: "", preparo: null, conectando: null };
}

/** Os passos que dá para pular (6 e 7, como no protótipo; e "Agora não" nos apps). */
export const PULAVEIS: ReadonlySet<PassoApresentacao> = new Set(["funcao", "origem", "apps"]);

export const passoAtual = (e: Pick<EstadoApresentacao, "passo">): PassoApresentacao => PASSOS[Math.max(0, Math.min(PASSOS.length - 1, e.passo))] ?? "boas-vindas";

/** Anda um passo (±1), sem sair dos limites nem voltar do preparo para trás. */
export function andar(e: EstadoApresentacao, delta: 1 | -1): EstadoApresentacao {
  if (passoAtual(e) === "preparando") return e;
  const passo = Math.max(0, Math.min(PASSOS.indexOf("criar"), e.passo + delta));
  // Chegando ao passo 9 com a função escolhida e sem nome ainda: o nome e o trabalho sugeridos já vêm preenchidos.
  if (PASSOS[passo] === "criar" && !e.nome) {
    const s = e.funcao ? SUGESTAO_POR_FUNCAO[e.funcao as keyof typeof SUGESTAO_POR_FUNCAO] : undefined;
    return { ...e, passo, nome: s?.nome ?? "", primeira: e.primeira || "" };
  }
  return { ...e, passo };
}

/** O nome que o bot leva (o digitado, ou "seu bot" sem nome). */
export const nomeDoBot = (e: Pick<EstadoApresentacao, "nome">): string => e.nome.trim().slice(0, NOME_MAX);

/** O personagem de cada passo: dorme e acorda no 2, trabalha no 3, pensa na função, lê nos apps, comemora no fim. */
export function personagemDoPasso(e: EstadoApresentacao): EstadoMascote {
  switch (passoAtual(e)) {
    case "boas-vindas": return "disponivel";
    // O Paper mostra o nod grande e de olhos abertos: o "pensando" do Bloub vira três pontos e esconde o personagem.
    case "conhecer": return "disponivel";
    case "computador": return "trabalhando";
    case "trabalho": return "disponivel";
    case "delegar": return "trabalhando";
    case "funcao": return e.funcao ? "comemorando" : "pensando";
    case "origem": return e.origem ? "comemorando" : "pensando";
    case "apps": return e.conectando ? "pensando" : "lendo";
    case "criar": return "disponivel";
    case "preparando": return e.preparo?.pronto ? "comemorando" : e.preparo?.erro ? "disponivel" : "lendo";
  }
}

/** O e-mail é do Google (gmail.com ou googlemail.com): o passo dos apps sugere Gmail e Agenda. */
export function emailDoGoogle(email: string | null | undefined): boolean {
  return /@(gmail|googlemail)\.com$/i.test(email ?? "");
}
