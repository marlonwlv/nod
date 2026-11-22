import { describe, expect, it } from "vitest";
import { cartaoDoDesvio, noNa as noNaDoDominio, oA as oADoDominio } from "../../../src/domain/desvios-da-conversa.ts";
import { cartaoSemAcesso, cartaoSemIaPronta, desvioNaConversa, noNa, oA } from "../../../web/telas/desvio.ts";

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

  it("o Cancelar leva a fala e sai do cartão depois de usado", () => {
    const cartao = cartaoDoDesvio("limite_bot_fixo", { bot: "Dino", ia: "ChatGPT", outraIa: "Claude" }, { agora: AGORA, ate: AGORA + 3_600_000, turnoId: "t1", turnoEsperandoId: "t2", mensagemId: "m0", outraIaId: "claude-cli" });
    const antes = desvioNaConversa(m, cartao);
    expect(antes).toContain('data-act="cancelar-turno" data-id="t2" data-conversa="c1" data-mensagem="m0"');
    expect(antes).toContain("aviso-estado-ponto");
    const depois = desvioNaConversa(m, cartao, { canceladas: new Set(["t2"]) });
    expect(depois).not.toContain('data-act="cancelar-turno"');
    expect(depois).toContain('data-act="responder-com-outra-ia"');
  });
});
