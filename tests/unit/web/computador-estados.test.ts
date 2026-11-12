import { describe, expect, it } from "vitest";
import { MS_RECONECTANDO, estadoDoCartao, htmlCartaoDoComputador, htmlPilulaDoTopo } from "../../../web/lib/computador-estados.ts";
import { htmlGavetaTela, type ComputadorPessoaDto } from "../../../web/lib/computador-pessoa.ts";

const BOT = { id: "a", nome: "Ada" };
const AGORA = 1_800_000_000_000;
function pc(p: Partial<ComputadorPessoaDto> = {}): ComputadorPessoaDto {
  return { estado: "pronto", maquina: { id: "m", nome: "Mac do Marlon", contato: AGORA }, telas: [], esperando: [], ...p };
}

describe("Tela 11: os cinco estados do computador do bot (ADR-173)", () => {
  it("deriva cada estado do que o nod já guarda", () => {
    expect(estadoDoCartao(pc({ estado: "dormindo" }), "a", AGORA)).toBe("em_repouso");
    expect(estadoDoCartao(pc({ estado: "ligando" }), "a", AGORA)).toBe("conectando");
    expect(estadoDoCartao(pc({ telas: [{ agenteId: "a", estado: "abrindo", controle: "bot", memoriaMb: null }] }), "a", AGORA)).toBe("conectando");
    expect(estadoDoCartao(pc({ telas: [{ agenteId: "a", estado: "aberta", controle: "bot", memoriaMb: null }] }), "a", AGORA)).toBe("ao_vivo");
    expect(estadoDoCartao(pc(), "a", AGORA)).toBe("ao_vivo");
    expect(estadoDoCartao(pc({ estado: "fora_do_ar" }), "a", AGORA)).toBe("sem_conexao");
    expect(estadoDoCartao(pc({ operacao: { tipo: "atualizar", pct: 10, etapa: null } }), "a", AGORA)).toBe("reconectando");
  });

  it("sem contato é Reconectando no primeiro minuto e Sem conexão depois", () => {
    expect(estadoDoCartao(pc({ semContatoDesde: AGORA - 5_000 }), "a", AGORA)).toBe("reconectando");
    expect(estadoDoCartao(pc({ semContatoDesde: AGORA - MS_RECONECTANDO - 1 }), "a", AGORA)).toBe("sem_conexao");
  });

  it("o cartão Sem conexão traz Tentar de novo e Ver máquinas, com os data-act que a gaveta já trata", () => {
    const html = htmlCartaoDoComputador(pc({ semContatoDesde: AGORA - 3 * 60_000 }), BOT, AGORA);
    expect(html).toContain("Sem conexão");
    expect(html).toContain("Sem conexão há 3 min");
    expect(html).toContain('data-op="tentar_de_novo"');
    expect(html).toContain('data-act="ver-lugar-do-computador"');
    expect(html).toContain("Computador de Ada");
  });

  it("ao vivo mostra a miniatura que abre o computador e diz onde ele mora", () => {
    const html = htmlCartaoDoComputador(pc({ telas: [{ agenteId: "a", estado: "aberta", controle: "bot", memoriaMb: null }] }), BOT, AGORA);
    expect(html).toContain('data-estado-computador="ao_vivo"');
    expect(html).toContain('data-act="abrir-computador"');
    expect(html).toContain("Ativo · Mac do Marlon");
    expect(html).not.toContain("tentar_de_novo");
  });

  it("escapa o nome do bot e da máquina", () => {
    const html = htmlCartaoDoComputador(pc({ maquina: { id: "m", nome: "<b>x</b>", contato: null } }), { id: "a", nome: "<i>" }, AGORA);
    expect(html).not.toContain("<i>");
    expect(html).not.toContain("<b>x</b>");
  });

  it("a pílula do topo junta estado, bot, máquina e tamanho", () => {
    const html = htmlPilulaDoTopo(pc(), BOT, AGORA, { largura: 1280, altura: 800 });
    expect(html).toContain("Ao vivo · Computador de Ada");
    expect(html).toContain("Mac do Marlon · 1280 × 800");
  });

  it("a gaveta abre com o cartão do estado no topo", () => {
    const html = htmlGavetaTela(pc({ estado: "dormindo" }), { id: "a", nome: "Ada", cor: "#000", forma: "gota" } as never, null, AGORA);
    expect(html.indexOf('data-estado-computador="em_repouso"')).toBeGreaterThan(-1);
    expect(html.indexOf("cbe")).toBeLessThan(html.indexOf("cb-sono"));
  });
});
