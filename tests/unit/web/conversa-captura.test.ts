import { describe, expect, it } from "vitest";
import type { ConversaDto } from "../../../src/contracts/api.ts";
import type { AnexoMeta } from "../../../src/contracts/anexo.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import { estadoInicial, reduzir, type Estado } from "../../../web/estado/reducer.ts";
import { renderMensagem } from "../../../web/telas/conversa.ts";

/**
 * NOD-56: a tela do computador ao fim do turno, no transcript. D · Computador do bot (decisão b): a captura automática saiu;
 * as capturas antigas já gravadas abrem como a imagem comum do bot.
 */

const C = "c1";
const CRIADO = Date.parse("2026-10-16T14:07:00Z");
const PNG: AnexoMeta = { id: "an1", nome: "tela-1407.png", mime: "image/png", tamanho: 1234 };
const ROTA = `/api/t/t/conversas/${C}/anexos/an1`;

const msg = (autor: "pessoa" | "agente", extra: Partial<Mensagem> = {}): Mensagem => ({
  tenantId: "t", id: "m1", conversaId: C, turnoId: null, autoria: autor === "pessoa" ? { autor_tipo: "pessoa", autor_id: "p" } : { autor_tipo: "agente", autor_id: "a" },
  kind: "texto", texto: "Preenchi o formulário.", payload: null, confianca: "confiavel", parcial: false, criadoEm: CRIADO, ...extra,
} as Mensagem);

function estado(): Estado {
  const conversa: ConversaDto = {
    conversa: { tenantId: "t", id: C, ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "a", salaId: null, sessaoCli: null, criadoEm: 1 } as never,
    mensagens: [], turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], propostas: [], fios: [],
  };
  const base = reduzir(estadoInicial, { tipo: "hidratar-conversa", conversa, agora: CRIADO });
  return { ...base, agora: CRIADO, sessao: { pessoaId: "p", tenantId: "t" } as never, frota: { agentes: [{ id: "a", nome: "Ada", conversaId: C, cor: "blue", forma: "square" }] } as never };
}

describe("D · Computador do bot · captura antiga do fim do turno", () => {
  it("a captura antiga abre como a imagem comum do bot, abaixo do balão, sem a legenda nem a miniatura de 240×150", () => {
    const html = renderMensagem(msg("agente", { anexos: [PNG] }), estado());
    expect(html).not.toContain("msg-captura");
    expect(html).not.toContain("ao fim do turno");
    expect(html).not.toContain('data-act="ampliar-captura"');
    expect(html).toContain('data-act="midia-abrir" data-anexo-id="an1"');
    expect(html).toContain(`<img src="${ROTA}"`);
    expect(html.indexOf('class="msg-midias"')).toBeGreaterThan(html.indexOf('class="bubble"'));
  });

  it("fala do bot sem anexo sai idêntica", () => {
    const e = estado();
    const sem = renderMensagem(msg("agente"), e);
    expect(sem).not.toContain("msg-midias");
    expect(renderMensagem(msg("agente", { anexos: [] }), e)).toBe(sem);
  });

  it("mensagem da pessoa com imagem continua em msg-anexos acima do balão", () => {
    const html = renderMensagem(msg("pessoa", { anexos: [PNG] }), estado());
    expect(html).toContain('class="msg-anexos"');
    expect(html).not.toContain("msg-midias");
    expect(html.indexOf('class="msg-anexos"')).toBeLessThan(html.indexOf('class="bubble"'));
  });

  it("captura antiga só, sem texto: não desenha balão vazio", () => {
    const html = renderMensagem(msg("agente", { texto: "", anexos: [PNG] }), estado());
    expect(html).not.toContain('class="bubble"');
    expect(html).toContain('class="msg-midias"');
  });

  it("anexo que não é imagem no bot vira card de arquivo com prévia (NOD-327)", () => {
    const html = renderMensagem(msg("agente", { anexos: [{ id: "d", nome: "r.pdf", mime: "application/pdf", tamanho: 10 }] }), estado());
    expect(html).toContain('class="msg-arquivo"');
    expect(html).toContain('data-act="previa-arquivo" data-id="d"');
    expect(html).toContain(`data-url="/api/t/t/conversas/${C}/anexos/d"`);
    expect(html).toContain('class="arq-ic arq-pdf"');
    expect(html).toContain('download="r.pdf"');
  });

  it("sem sessão (tenant) não há rota: nenhuma imagem", () => {
    const html = renderMensagem(msg("agente", { anexos: [PNG] }), { ...estado(), sessao: null } as never);
    expect(html).not.toContain("/anexos/");
  });
});
