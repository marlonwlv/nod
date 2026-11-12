import type { ComputadorPessoaDto } from "./computador-pessoa.ts";
import { esc } from "./escape.ts";

/**
 * Tela 11 (ADR-171, definido em 2026-11-12): os cinco estados do computador do bot, no desenho do Grok Bot (prints
 * 60–64 da engenharia reversa e o protótipo do Paper, tela 11). O nod já guarda o estado da máquina (dormindo, ligando,
 * pronto, fora do ar, operando) e o da tela de cada bot; aqui só se DERIVA o que a pessoa lê, em cinco palavras:
 *
 * - **Conectando**: o computador está ligando ou a tela do bot está abrindo.
 * - **Ao vivo**: o computador está pronto (com a tela do bot aberta, ou só ligado).
 * - **Reconectando**: a máquina perdeu contato há pouco (até `MS_RECONECTANDO`) ou uma operação longa (atualizar,
 *   redefinir) está trocando o computador; volta sozinho, sem pedir nada.
 * - **Sem conexão**: fora do ar, ou sem contato há mais que `MS_RECONECTANDO`. Tem "Tentar de novo" e "Ver máquinas".
 * - **Em repouso**: o computador dormiu; acorda sozinho quando um bot precisa.
 *
 * Puro, sem DOM: a gaveta (computador-pessoa.ts) põe o cartão no topo e o teste lê o HTML sem navegador.
 */
export const ESTADOS_DO_CARTAO = ["conectando", "ao_vivo", "reconectando", "sem_conexao", "em_repouso"] as const;
export type EstadoDoCartao = (typeof ESTADOS_DO_CARTAO)[number];

/** definido em 2026-11-12: o mesmo minuto que a sonda de rede da web espera antes de dizer que caiu de vez. */
export const MS_RECONECTANDO = 60_000;

export const ROTULO_DO_ESTADO: Readonly<Record<EstadoDoCartao, string>> = {
  conectando: "Conectando",
  ao_vivo: "Ao vivo",
  reconectando: "Reconectando",
  sem_conexao: "Sem conexão",
  em_repouso: "Em repouso",
};

export function estadoDoCartao(dto: ComputadorPessoaDto, agenteId: string, agora: number): EstadoDoCartao {
  if (dto.estado === "dormindo") return "em_repouso";
  if (dto.estado === "fora_do_ar") return "sem_conexao";
  if (dto.semContatoDesde != null) return agora - dto.semContatoDesde <= MS_RECONECTANDO ? "reconectando" : "sem_conexao";
  if (dto.operacao) return "reconectando";
  if (dto.estado === "ligando") return "conectando";
  const tela = dto.telas.find((t) => t.agenteId === agenteId);
  if (tela?.estado === "abrindo") return "conectando";
  return "ao_vivo";
}

function haQuanto(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  return h < 24 ? `há ${h} h` : `há ${Math.round(h / 24)} d`;
}

/** A linha de apoio do cartão: o que está acontecendo e onde o computador mora. */
export function apoioDoCartao(dto: ComputadorPessoaDto, estado: EstadoDoCartao, agenteId: string, agora: number): string {
  const onde = dto.maquina?.nome ?? null;
  switch (estado) {
    case "conectando": return "Conectando ao computador…";
    case "reconectando": return dto.operacao ? "Trocando o computador · volta sozinho" : "A conexão caiu · tentando de novo";
    case "sem_conexao": {
      const desde = dto.semContatoDesde ?? dto.falha?.desde ?? null;
      return desde != null ? `Sem conexão ${haQuanto(agora - desde)}` : "Sem conexão";
    }
    case "em_repouso": return "Acorda sozinho quando um bot precisar";
    case "ao_vivo": {
      const tela = dto.telas.find((t) => t.agenteId === agenteId && (t.estado === "aberta" || t.estado === "abrindo"));
      const oque = tela ? (tela.titulo ? tela.titulo : "Ativo") : "Pronto";
      return onde ? `${oque} · ${onde}` : oque;
    }
  }
}

const ICONE = {
  giro: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.5-3.5M13 3v2.5h-2.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  // Rodada 3: o eye-off do Paper (lucide), 16 px.
  semOlho: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="m2 2 20 20"/></svg>',
  lua: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M12.5 10A5 5 0 0 1 6 3.5a5 5 0 1 0 6.5 6.5Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
};

/**
 * O cartão do topo da aba Computador (Tela 11): título "Computador de <bot>" (sem adivinhar gênero pelo nome), a linha de apoio e, à direita, a
 * miniatura (ao vivo) ou o ícone do estado. Sem conexão traz "Tentar de novo" e "Ver máquinas"; os `data-act` são os
 * mesmos que a gaveta e o painel já tratam (operar-computador, ver-lugar-do-computador, abrir-computador).
 */
export function htmlCartaoDoComputador(dto: ComputadorPessoaDto, bot: { id: string; nome: string }, agora: number): string {
  const estado = estadoDoCartao(dto, bot.id, agora);
  const apoio = apoioDoCartao(dto, estado, bot.id, agora);
  const lado = estado === "ao_vivo"
    ? `<button type="button" class="cbe-mini" data-act="abrir-computador" data-id="${esc(bot.id)}" data-tela-bot="${esc(bot.id)}" aria-label="Abrir o computador de ${esc(bot.nome)}"><img alt="" hidden /><span class="cbe-mini-vazia" aria-hidden="true"></span></button>`
    : `<span class="cbe-icone${estado === "conectando" || estado === "reconectando" ? " gira" : ""}" aria-hidden="true">${estado === "sem_conexao" ? ICONE.semOlho : estado === "em_repouso" ? ICONE.lua : ICONE.giro}</span>`;
  const acoes = estado === "sem_conexao"
    ? `<p class="cbe-acoes"><button type="button" class="bt sm primario" data-act="operar-computador" data-op="tentar_de_novo">${ICONE.giro}<span>Tentar de novo</span></button><button type="button" class="bt sm" data-act="ver-lugar-do-computador">Ver máquinas</button></p>`
    : "";
  // Tela 11 do Paper: as ações do Sem conexão moram dentro do cartão, embaixo da linha.
  return `<div class="cbe" data-estado-computador="${estado}"><p class="cbe-rotulo" role="status">${ROTULO_DO_ESTADO[estado]}</p><div class="cbe-cartao"><div class="cbe-linha"><span class="cbe-txt"><b>${esc(`Computador de ${bot.nome}`)}</b><small class="cbe-apoio${estado === "ao_vivo" ? " vivo" : ""}">${esc(apoio)}</small></span>${lado}</div>${acoes}</div></div>`;
}

/** A pílula do topo da tela cheia: "Ao vivo · Computador de Ada" e, em cinza, "Mac do Marlon · 1280 × 800". */
export function htmlPilulaDoTopo(dto: ComputadorPessoaDto, bot: { id: string; nome: string }, agora: number, tamanho: { largura: number; altura: number } | null): string {
  const estado = estadoDoCartao(dto, bot.id, agora);
  const extra = [dto.maquina?.nome ?? "", tamanho ? `${tamanho.largura} × ${tamanho.altura}` : ""].filter(Boolean).join(" · ");
  return `<div class="cbe-topo" data-estado-computador="${estado}"><span class="cbe-topo-pilula"><span class="cbe-ponto" aria-hidden="true"></span>${esc(`${ROTULO_DO_ESTADO[estado]} · Computador de ${bot.nome}`)}</span>${extra ? `<span class="cbe-topo-extra">${esc(extra)}</span>` : ""}</div>`;
}
