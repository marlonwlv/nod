import { describe, expect, it } from "vitest";
import { estadoInicial, reduzir, type Estado } from "../../../web/estado/reducer.ts";
import type { ComputadorPessoaDto } from "../../../web/lib/computador-pessoa.ts";
import { estadoDoComputadorDosBots, LUGAR_CONECTAR, renderSecaoComputador } from "../../../web/telas/config-computador.ts";

/** Especificação D, item 7: Configurações › Computador (o painel que morava embaixo de Máquinas). */
const ada = { tenantId: "t", id: "a1", ownerId: "p", nome: "Ada", titulo: "", descricao: "", cor: "c-blue", forma: "shape-square", conversaId: "c1" };
function pc(p: Partial<ComputadorPessoaDto> = {}): ComputadorPessoaDto {
  return { estado: "pronto", maquina: { id: "m1", nome: "Mac do Marlon", contato: Date.now() }, telas: [], esperando: [], ...p };
}
function com(dto: ComputadorPessoaDto | null, ui: Partial<Estado["computadorUi"]> = {}): Estado {
  const e = reduzir(estadoInicial, { tipo: "espaco", secao: "computador" });
  return { ...e, sessao: { tenantId: "t", pessoaId: "p" }, frota: { agentes: [ada], negacoes: [] } as never, computadorPessoa: dto, computadorUi: { ...e.computadorUi, ...ui } } as Estado;
}

describe("Configurações › Computador (especificação D, item 7)", () => {
  it("título, frase e os cinco grupos na ordem, sem a Atividade", () => {
    const html = renderSecaoComputador(com(pc({ atividade: [{ agenteId: "a1", texto: "abriu o site", em: 1 }] })));
    expect(html).toContain('<h2 id="cpc-titulo" class="cpc-titulo">Computador</h2>');
    expect(html).toContain("Um computador para todos os seus bots. Cada bot tem a própria tela e o próprio navegador; um login feito aqui vale para todos.");
    const ordem = ["Computador dos bots", "Telas abertas", "Onde o computador mora", "Manutenção", "Logins"].map((t) => html.indexOf(`>${t}</h3>`));
    expect(ordem.every((i) => i >= 0)).toBe(true);
    expect(ordem).toEqual([...ordem].sort((a, b) => a - b));
    expect(html).not.toContain(">Atividade<");
    expect(html).not.toContain("abriu o site");
  });

  it("Computador dos bots: a miniatura do item 2 (sem imagem) e '{estado} · {memória} de {total}'", () => {
    const html = renderSecaoComputador(com(pc({ memoria: { usadaMb: 2048, totalMb: 8192 } })));
    expect(html).toContain('data-miniatura="repouso"');
    expect(html).toContain("Em repouso · 2,0 GB de 8,0 GB");
    expect(html).not.toContain("<img");
    expect(estadoDoComputadorDosBots(pc({ estado: "fora_do_ar" }))).toBe("fora");
    expect(estadoDoComputadorDosBots(pc({ estado: "ligando" }))).toBe("ligando");
    expect(estadoDoComputadorDosBots(pc({ telas: [{ agenteId: "a1", estado: "abrindo", controle: "bot", memoriaMb: null }] }))).toBe("ativo");
    expect(renderSecaoComputador(com(pc({ estado: "fora_do_ar" })))).toContain('data-op="tentar_de_novo"');
  });

  it("Telas abertas: uma linha por bot com tela, ponto verde se ativo, e Abrir leva à tela cheia", () => {
    const html = renderSecaoComputador(com(pc({ telas: [{ agenteId: "a1", estado: "aberta", controle: "bot", memoriaMb: 300, titulo: "nfse.prefeitura.gov.br", ultimaAcaoEm: Date.now() }] })));
    expect(html).toContain('<i class="cpc-ponto ativo" aria-hidden="true"></i>Ativo · nfse.prefeitura.gov.br');
    expect(html).toContain('data-act="abrir-computador" data-id="a1" aria-label="Abrir a tela de Ada"');
    expect(renderSecaoComputador(com(pc()))).toContain("Nenhum bot está usando o navegador agora.");
    const parada = renderSecaoComputador(com(pc({ telas: [{ agenteId: "a1", estado: "aberta", controle: "bot", memoriaMb: 300, ultimaAcaoEm: 1 }] })));
    expect(parada).toContain('<i class="cpc-ponto" aria-hidden="true"></i>Em repouso');
  });

  it("Onde o computador mora: a máquina e o seletor; sem outra máquina, a opção leva a conectar uma", () => {
    const html = renderSecaoComputador(com(pc({ lugares: [{ tipo: "este_mac", maquinaId: "m1", nome: "Mac do Marlon", atual: true, pronta: true, conectada: true }] as never })));
    expect(html).toContain('id="pc-lugar-tit"');
    expect(html).toContain("Este Mac · Online agora");
    expect(html).toContain('data-act-change="pc-lugar"');
    expect(html).toContain('<option value="m1" selected>Este Mac</option>');
    expect(html).toContain(`<option value="${LUGAR_CONECTAR}">Outra máquina sua</option>`);
  });

  it("Manutenção e Logins: os mesmos botões de hoje e as confirmações de sempre", () => {
    const html = renderSecaoComputador(com(pc()));
    for (const op of ["atualizar", "redefinir", "sair_de_todos", "esquecer_senhas"]) expect(html).toContain(`data-act="operar-computador" data-op="${op}"`);
    expect(html).toContain(">Atualizar o computador<");
    expect(html).toContain(">Redefinir…<");
    expect(html).toContain(">Sair de todos…<");
    expect(html).toContain(">Esquecer senhas…<");
    expect(renderSecaoComputador(com(pc(), { confirmar: "redefinir" }))).toContain("Redefinir o computador?");
    expect(renderSecaoComputador(com(pc(), { confirmar: "sair_de_todos" }))).toContain("Sair de todos os sites?");
    expect(renderSecaoComputador(com(pc({ operacao: { tipo: "atualizar", pct: 40, etapa: null } })))).toMatch(/data-op="redefinir" disabled/);
  });

  it("sem o computador da pessoa, a seção diz que ainda não há", () => {
    expect(renderSecaoComputador(com(null))).toContain("O computador dos bots ainda não está ligado nesta conta.");
  });
});
