import type { StateId } from "../vendor/bloub/states.ts";
import type { FormaAgente } from "../../src/contracts/agente.ts";
import type { ShapeId } from "../vendor/bloub/skins.ts";

export const FORMAS_BLOUB: Record<FormaAgente, ShapeId> = {
  "shape-square": "squircle", "shape-hex": "hexagone", "shape-circle": "cercle",
  "shape-pebble": "galet", "shape-capsule": "capsule", "shape-triangle": "triangle",
  "shape-cloud": "nuage", "shape-drop": "goutte",
  // ADR-174: as cinco formas a mais
  "shape-egg": "oeuf", "shape-heart": "coeur", "shape-star": "etoile", "shape-flower": "fleur", "shape-clover": "trefle",
};
// definido em 2026-09-18: reservado não representa um fato atual do produto.
export const CATALOGO_MASCOTE = {
  idle: { nome: "Repouso", ativo: true, situacao: "Sem turno vivo nem decisão pendente" },
  thinking: { nome: "Pensando", ativo: true, situacao: "Turno na fila" },
  orbit: { nome: "Órbita", ativo: false, situacao: "Computador do bot iniciando ou conectando" },
  notify: { nome: "Sua vez", ativo: false, situacao: "Mantido apenas por compatibilidade" },
  working: { nome: "Trabalhando", ativo: true, situacao: "Turno rodando com ferramenta em uso" },
  running: { nome: "Executando", ativo: true, situacao: "Comando iniciado no terminal" },
  streaming: { nome: "Digitando", ativo: true, situacao: "Resposta sendo escrita" },
  finished: { nome: "Terminou", ativo: true, situacao: "Resposta acabou de entrar" },
  blocked: { nome: "Aguardando aprovação", ativo: true, situacao: "Aprovação pendente nesta conversa" },
  // Parte 3 do plano "o pensamento no chat" (ADR-129, 2026-10-26): wink, alert e comet entram pela fala viva do chat.
  wink: { nome: "Piscadela", ativo: true, situacao: "A fala do bot acabou de entrar (disparo único no chat)" },
  wide: { nome: "Surpresa", ativo: false, situacao: "Descoberta relevante" },
  alert: { nome: "Alerta", ativo: true, situacao: "Silêncio do vigia no turno (chat); falha recuperável que exige atenção" },
  exclaim: { nome: "Urgente", ativo: false, situacao: "Bloqueio crítico ou prazo próximo" },
  sleep: { nome: "Dormindo", ativo: false, situacao: "Agente explicitamente suspenso (não apenas sem tarefa)" },
  egg: { nome: "Ovo", ativo: false, situacao: "Criação ou preparação inicial do agente" },
  hexagon: { nome: "Hexágono", ativo: false, situacao: "Preparação de integração" },
  play: { nome: "Play", ativo: false, situacao: "Início ou retomada confirmada de execução" },
  burst: { nome: "Explosão", ativo: false, situacao: "Conclusão bem-sucedida, uma vez por entrega" },
  comet: { nome: "Cometa", ativo: true, situacao: "As frentes saíram (disparo único no chat); transferência de tarefa entre agentes" },
  // ADR-174 (2026-11-12): os estados novos do personagem.
  reading: { nome: "Lendo", ativo: true, situacao: "Turno rodando com uma ferramenta de leitura em uso" },
  celebrate: { nome: "Comemorando", ativo: true, situacao: "Preparo do bot chegou a 100% ou o onboarding acabou (disparo das telas)" },
  sleeping: { nome: "Dormindo", ativo: true, situacao: "Bot pausado (olhos fechados, respirando)" },
  offline: { nome: "Offline", ativo: true, situacao: "Computador do bot fora do ar, para o dono e sem turno vivo" },
  swirl: { nome: "Espiral", ativo: false, situacao: "Transição visual entre contextos; não é status de negócio" },
} satisfies Record<StateId, { nome: string; ativo: boolean; situacao: string }>;
