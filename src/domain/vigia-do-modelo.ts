/**
 * ADR-171 (definido em 2026-11-12): prazo de PRIMEIRO TOKEN e de OCIOSIDADE do modelo, como o Grok Bot (Statsig: 150 s até
 * o primeiro token, 90 s ocioso). Não é o watchdog de turno que a ADR-067 tirou: o turno continua podendo esperar
 * comando em segundo plano, ferramenta lenta e mensagem da pessoa sem prazo. O relógio só anda enquanto o nod espera O
 * MODELO falar:
 *   - `aguardando_primeiro`: o pedido saiu (prompt, resultado de ferramenta) e nada voltou ainda;
 *   - `falando`: já veio texto/ferramenta e o modelo segue no meio da resposta;
 *   - `parado`: ferramenta rodando, algo em segundo plano ou entre voltas (depois do `result`) — sem prazo.
 * Puro: quem chama passa o relógio e os eventos já traduzidos.
 */
export const PRAZO_PRIMEIRO_TOKEN_MS = 150_000;
export const PRAZO_OCIOSO_MS = 90_000;

export type FaseDoModelo = "aguardando_primeiro" | "falando" | "parado";
export type EstouroDoModelo = "prazo_primeiro_token" | "modelo_ocioso";
export type EstadoVigia = { fase: FaseDoModelo; desde: number; ferramentasAbertas: Set<string>; estourou: EstouroDoModelo | null };

export type SinalDoModelo =
  | { tipo: "pedido" }
  | { tipo: "token" }
  | { tipo: "ferramenta_comecou"; id: string }
  | { tipo: "ferramenta_acabou"; id: string }
  | { tipo: "fim_da_volta" };

export function novaVigia(agora: number): EstadoVigia {
  return { fase: "aguardando_primeiro", desde: agora, ferramentasAbertas: new Set(), estourou: null };
}

export function anotarSinal(e: EstadoVigia, s: SinalDoModelo, agora: number): void {
  switch (s.tipo) {
    case "pedido":
      e.fase = "aguardando_primeiro";
      e.desde = agora;
      return;
    case "token":
      if (e.ferramentasAbertas.size > 0) return;
      e.fase = "falando";
      e.desde = agora;
      return;
    case "ferramenta_comecou":
      e.ferramentasAbertas.add(s.id);
      e.fase = "parado";
      e.desde = agora;
      return;
    case "ferramenta_acabou":
      e.ferramentasAbertas.delete(s.id);
      // Todas as ferramentas da vez voltaram: o resultado vai ao modelo e começa a espera do primeiro token.
      if (e.ferramentasAbertas.size === 0) { e.fase = "aguardando_primeiro"; e.desde = agora; }
      return;
    case "fim_da_volta":
      e.ferramentasAbertas.clear();
      e.fase = "parado";
      e.desde = agora;
      return;
  }
}

/** O estouro, uma vez só por espera (quem chama decide entre logar e encerrar). */
export function verificarVigia(e: EstadoVigia, agora: number, prazos: { primeiroTokenMs: number; ociosoMs: number } = { primeiroTokenMs: PRAZO_PRIMEIRO_TOKEN_MS, ociosoMs: PRAZO_OCIOSO_MS }): EstouroDoModelo | null {
  if (e.estourou) return null;
  const parado = agora - e.desde;
  const estouro = e.fase === "aguardando_primeiro" && parado > prazos.primeiroTokenMs ? "prazo_primeiro_token"
    : e.fase === "falando" && parado > prazos.ociosoMs ? "modelo_ocioso" : null;
  if (estouro) e.estourou = estouro;
  return estouro;
}

/** Qualquer sinal novo depois de um estouro rearma a vigia (o modelo voltou a falar). */
export function rearmar(e: EstadoVigia): void {
  e.estourou = null;
}

export type ModoDosPrazos = "desligado" | "observar" | "encerrar";
/** definido em 2026-11-12: `observar` por padrão — mede e loga sem mudar o turno até haver número de produção. */
export function modoDosPrazos(v: string | undefined): ModoDosPrazos {
  return v === "encerrar" || v === "desligado" ? v : "observar";
}
