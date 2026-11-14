import { esc } from "./escape.ts";
import { ICONE_GLOBO } from "./texto-formatado.ts";
import { MS_AINDA_ESPERANDO, motivoDaEspera, tituloSemContato, type ComputadorPessoaDto, type MemoriaDoComputador } from "./computador-pessoa.ts";

/**
 * D · Computador do bot (item 1): o computador na conversa. A tela não aparece no chat; o único sinal enquanto o bot usa
 * o computador é o rótulo da linha de atividade. Puro (string), para o teste sem DOM; o cartão flutuante do chip mora em
 * web/telas/computador-chip.ts.
 */

/**
 * O rótulo da linha de atividade enquanto o bot espera o computador (antes eram as linhas cinza abaixo do turno):
 * "Ligando o computador", "Esperando uma tela livre" e, passados 10 min, "Ainda esperando uma tela · N min". `desde` é
 * de quando a web viu a espera começar (`MemoriaDoComputador.esperas`). null = não espera.
 */
export function rotuloDaEsperaDoComputador(dto: ComputadorPessoaDto | null, mem: Pick<MemoriaDoComputador, "esperas">, agenteId: string, agora: number): string | null {
  if (!dto) return null;
  const motivo = motivoDaEspera(dto, agenteId);
  if (!motivo) return null;
  if (motivo === "memoria") {
    const desde = mem.esperas[agenteId]?.desde ?? null;
    if (desde !== null && agora - desde >= MS_AINDA_ESPERANDO) return `Ainda esperando uma tela · ${Math.floor((agora - desde) / 60_000)} min`;
    return "Esperando uma tela livre";
  }
  if (motivo === "operacao") return "Esperando o computador";
  return "Ligando o computador";
}

/** O título do aviso de falha ("O computador parou de responder"); null quando o computador não está fora do ar. */
export function tituloDaFalhaDoComputador(dto: ComputadorPessoaDto): string | null {
  if (dto.estado !== "fora_do_ar") return null;
  return tituloSemContato(dto) ?? (dto.falha?.motivo === "nao_ficou_pronto" ? "Não consegui ligar o computador" : "O computador parou de responder");
}

/** A linha de sistema centrada (12/16, terciário), com o link "Tentar de novo" quando ainda há o que tentar. */
export function htmlLinhaDeSistemaDoComputador(texto: string, tentar: boolean): string {
  const link = tentar ? `<span class="cc-sistema-sep" aria-hidden="true"> · </span><button type="button" class="cc-sistema-link" data-act="operar-computador" data-op="tentar_de_novo">Tentar de novo</button>` : "";
  return `<p class="cc-sistema" role="status"><span>${esc(texto)}</span>${link}</p>`;
}

/** O aviso de falha do computador no chat do bot; null quando ele responde. */
export function htmlFalhaDoComputador(dto: ComputadorPessoaDto): string | null {
  const titulo = tituloDaFalhaDoComputador(dto);
  return titulo ? htmlLinhaDeSistemaDoComputador(titulo, true) : null;
}

const SETA = '<svg class="cc-seta" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4"/></svg>';

/**
 * O cartão "Destino do link" do chip [Computador](nod-computador:): o globo num círculo, "Computador" e o nome do bot (o
 * cabeçalho abre a tela cheia, pela ação de sempre `abrir-computador`), o separador e "Mostrar no painel direito", que
 * abre o painel de detalhes do bot na seção Computador.
 */
export function htmlCartaoDestino(bot: { id: string; nome: string }): string {
  const globo = ICONE_GLOBO.replace('width="14" height="14"', 'width="16" height="16"');
  return `<button type="button" class="cc-cartao-cab" data-act="abrir-computador" data-id="${esc(bot.id)}" aria-label="${esc(`Abrir a tela de ${bot.nome}`)}"><span class="cc-cartao-globo">${globo}</span><span class="cc-cartao-txt"><b>Computador</b><small>${esc(bot.nome)}</small></span></button>`
    + `<hr class="cc-cartao-sep" />`
    + `<button type="button" class="cc-cartao-linha" data-act="computador-mostrar-painel" data-id="${esc(bot.id)}"><span>Mostrar no painel direito</span>${SETA}</button>`;
}
