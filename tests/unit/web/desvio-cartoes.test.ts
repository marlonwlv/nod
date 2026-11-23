import { describe, expect, it } from "vitest";
import { cartaoDoDesvio, noNa as noNaDoDominio, oA as oADoDominio } from "../../../src/domain/desvios-da-conversa.ts";
import { cartaoSemAcesso, cartaoSemIaPronta, desvioNaConversa, encolhidoDoDesvio, faseDoCartao, noNa, oA } from "../../../web/telas/desvio.ts";

/**
 * Lote B das Jornadas da IA (auditoria de 2026-11-22): os cartões que a tela monta sozinha (a web não importa o domínio,
 * ADR-018) têm de dizer exatamente o que a tabela única diz. Se a frase mudar num lado, este teste quebra.
 */
const AGORA = Date.parse("2026-11-22T15:00:00-03:00");
const m = { id: "m1", conversaId: "c1" };

describe("os cartões da tela são os da tabela única", () => {
  it("6 · nenhuma IA pronta: título, texto e o botão iguais aos do domínio", () => {
    for (const maquina of ["VM nova", "MacBook do escritório"]) {
      const dominio = cartaoDoDesvio("sem_ia_pronta", { bot: "Dino", ia: "", maquina }, { agora: AGORA });
      const tela = cartaoSemIaPronta({ bot: "Dino", maquina });
      expect(tela.titulo).toBe(dominio.titulo);
      expect(tela.texto).toBe(dominio.texto);
      expect(tela.botoes).toEqual(dominio.botoes);
    }
  });

  it("8 · sem acesso e nenhuma outra conta: título, texto e o botão iguais aos do domínio", () => {
    for (const organizacao of [null, "sua organização"]) {
      const dominio = cartaoDoDesvio("sem_acesso", { bot: "Dino", ia: "Claude", organizacao }, { agora: AGORA });
      const tela = cartaoSemAcesso({ bot: "Dino", ia: "Claude", organizacao });
      expect(tela.titulo).toBe(dominio.titulo);
      expect(tela.texto).toBe(dominio.texto);
      expect(tela.botoes).toEqual(dominio.botoes);
    }
  });

  it("o artigo da máquina é o mesmo nos dois lados", () => {
    for (const nome of ["VM sp-01", "Máquina da sala", "MacBook do escritório", "nod-motor-teste"]) {
      expect(noNa(nome)).toBe(noNaDoDominio(nome));
      expect(oA(nome)).toBe(oADoDominio(nome));
    }
  });

  it("o cartão é o aviso de estado do DS: caixa do Paper, sem ponto quando o nod parou, botões na linha de botões", () => {
    const html = desvioNaConversa(m, cartaoSemIaPronta({ bot: "Dino", maquina: "VM nova" }));
    expect(html).toContain('class="aviso-estado tom-info aviso-desvio desvio-sem_ia_pronta"');
    expect(html).not.toContain("aviso-estado-ponto");
    expect(html).toContain('<b class="aviso-estado-tit">Nenhuma IA conectada na VM nova</b>');
    expect(html).toContain('<div class="aviso-estado-acoes desvio-acoes"><button type="button" class="bt pri" data-act="secao-espaco"');
  });

  describe("o ciclo do cartão (auditoria de 2026-11-22): abre, age e fecha quando a conversa segue", () => {
    const cartao = cartaoDoDesvio("limite_bot_fixo", { bot: "Dino", ia: "ChatGPT", outraIa: "Claude" }, { agora: AGORA, ate: AGORA + 3_600_000, turnoId: "t1", turnoEsperandoId: "t2", mensagemId: "m0", outraIaId: "claude-cli" });
    const msgCartao = { id: "m1", conversaId: "c1", criadoEm: AGORA, kind: "sistema", autoria: { autor_tipo: "agente" }, payload: cartao } as never;
    const fala = (id: string, autor: "pessoa" | "agente", em = AGORA + 1000) => ({ id, conversaId: "c1", criadoEm: em, kind: "texto", parcial: false, autoria: { autor_tipo: autor }, texto: "x" });
    const estado = (o: { depois?: unknown[]; cancelados?: string[]; emCurso?: { id: string; desde: number }[]; local?: Record<string, unknown>; cancelando?: Record<string, unknown> } = {}) => ({
      conversas: { c1: { mensagens: [msgCartao, ...(o.depois ?? [])], turnosCancelados: (o.cancelados ?? []).map((id) => ({ id, mensagemId: "m0" })), turnosEmCurso: o.emCurso ?? [] } },
      cancelando: o.cancelando ?? {},
      desviosAgindo: o.local ?? {},
    }) as never;
    const fase = (e: never) => faseDoCartao(msgCartao, cartao.botoes, e);

    it("aberto: o Cancelar leva a fala, e os botões que mudam a conversa dizem o que a linha vai dizer", () => {
      expect(fase(estado())).toEqual({ fase: "aberto" });
      const html = desvioNaConversa(m, cartao, { fase: fase(estado()) });
      expect(html).toContain('data-act="cancelar-turno" data-id="t2" data-conversa="c1" data-mensagem="m0"');
      expect(html).toContain('data-cartao="m1" data-acao="responder_com_outra_ia" data-agora="Respondendo pelo Claude" data-feito="Respondido pelo Claude"');
      expect(html).toContain("aviso-estado-ponto");
    });

    it("agindo: o botão clicado gira e diz o que faz; os outros param", () => {
      const html = desvioNaConversa(m, cartao, { fase: fase(estado({ local: { m1: { acao: "responder_com_outra_ia", agora: "Respondendo pelo Claude", feito: "Respondido pelo Claude", agindo: true } } })) });
      expect(html).toContain('aria-busy="true" disabled');
      expect(html).toContain('<span class="bt-girando" aria-hidden="true"></span>Respondendo pelo Claude…</button>');
      expect(html).toMatch(/<button disabled [^>]*data-act="cancelar-turno"/);
    });

    it("fecha: cancelada, a pessoa seguiu, a resposta chegou (com a escolha da aba) ou o turno refeito já roda", () => {
      expect(fase(estado({ cancelados: ["t2"] }))).toEqual({ fase: "fechado", marca: null, resultado: "Cancelada" });
      expect(fase(estado({ cancelando: { t2: { fase: "cancelando" } } }))).toMatchObject({ fase: "fechado", resultado: "Cancelada" });
      expect(fase(estado({ depois: [fala("m2", "pessoa")] }))).toEqual({ fase: "fechado", marca: "sem-resposta", resultado: "Você seguiu a conversa" });
      expect(fase(estado({ depois: [fala("m2", "agente")] }))).toEqual({ fase: "fechado", marca: "ok", resultado: "A mensagem saiu" });
      const local = { m1: { acao: "responder_com_outra_ia", agora: "Respondendo pelo Claude", feito: "Respondido pelo Claude", agindo: false } };
      expect(fase(estado({ depois: [fala("m2", "agente")], local }))).toMatchObject({ resultado: "Respondido pelo Claude" });
      expect(fase(estado({ emCurso: [{ id: "t3", desde: AGORA + 500 }], local }))).toMatchObject({ fase: "fechado", resultado: "Respondendo pelo Claude" });
      // O clique deu certo e nada novo ainda apareceu (o "Rodar no <máquina>" move o turno que espera): fecha com o "agora".
      expect(fase(estado({ local }))).toEqual({ fase: "fechado", marca: "ok", resultado: "Respondendo pelo Claude" });
      // A linha de sistema que vem depois (autoria da pessoa, kind sistema) não fecha o cartão como "você seguiu".
      expect(fase(estado({ depois: [{ ...fala("m2", "pessoa"), kind: "sistema" }] }))).toEqual({ fase: "aberto" });
      const fechado = encolhidoDoDesvio(msgCartao, cartao.titulo, fase(estado({ cancelados: ["t2"] })));
      expect(fechado).toMatchObject({ titulo: cartao.titulo, resultado: "Cancelada", marca: null });
    });

    it("9 · reinstalando: com a linha 'Reinstalando…' depois do cartão, o botão gira até a IA abrir", () => {
      const linha = { ...fala("m2", "pessoa"), kind: "sistema", payload: { kind: "desvio", desvio: "ia_nao_abriu", forma: "linha" } };
      expect(fase(estado({ depois: [linha] }))).toEqual({ fase: "agindo", acao: "reinstalar_e_tentar", agora: "Reinstalando" });
    });
  });
});
