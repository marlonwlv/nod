import type { CredencialNoCofre } from "../../src/contracts/cofre.ts";
import { grupoConfig, linhaConfig } from "../lib/linha-config.ts";
import { quandoCurto } from "../lib/relogio.ts";
import { esc } from "../lib/render.ts";

/** O estado da seção Cofre (fora do reducer, como Aprovações): null antes da primeira leitura. */
export type TelaCofre = { credenciais: readonly CredencialNoCofre[] | null; carregando: boolean; erro: boolean };
export const TELA_COFRE_INICIAL: TelaCofre = { credenciais: null, carregando: false, erro: false };

const CHAVE = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="5.5" cy="10.5" r="3"/><path d="M7.6 8.4L13.5 2.5M11.5 4.5l1.5 1.5M10 6l1.2 1.2"/></svg>';

/**
 * Configurações › Cofre (Paper 07, rodada 2): as chaves que a pessoa guardou pelos cartões dos bots (`pedir_credencial`).
 * Só o nome, o app e quando foi guardada — o valor fica no cofre e nunca vem à tela.
 */
export function renderCofre(t: TelaCofre, agora: number, fuso?: string): string {
  const cab = `<h2>Cofre</h2><p class="intro">As chaves que você guardou pelos cartões dos bots. O valor fica só no cofre: aqui aparecem o nome, o app e quando foi guardada.</p>`;
  const sec = (miolo: string) => `<section class="espaco-secao cfg-secao cfg-cofre">${cab}${miolo}</section>`;
  if (t.erro && !t.credenciais) return sec(`<div class="lc-lista">${linhaConfig({ titulo: "Não deu para abrir o cofre", status: { texto: "Erro", tom: "erro" }, controle: { tipo: "html", html: '<button type="button" class="bt" data-act="recarregar-cofre">Tentar de novo</button>' } })}</div>`);
  if (!t.credenciais) return sec('<p class="lc-nota" role="status">Abrindo o cofre…</p>');
  if (t.credenciais.length === 0) return sec('<p class="lc-vazio">Nenhuma chave guardada ainda. Quando um bot pedir uma, ela aparece aqui.</p>');
  const linhas = t.credenciais.map((c) => linhaConfig({ titulo: c.nome, detalhe: c.app, icone: CHAVE, quando: `guardada ${quandoCurto(c.guardadaEm, agora, fuso)}`, classe: "cofre-linha" }));
  return sec(grupoConfig("Chaves guardadas", linhas, { contagem: linhas.length }).replace(/<h3 class="lc-grupo-tit">/, `<h3 class="lc-grupo-tit" title="${esc("O valor nunca sai do cofre")}">`));
}
