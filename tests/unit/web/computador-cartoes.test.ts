import { describe, expect, it } from "vitest";
import type { SuaVezDto } from "../../../src/contracts/api.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import type { FioDaPergunta } from "../../../src/contracts/pedido.ts";
import { resumoAcaoComputador, textoPedidoDeTela } from "../../../src/domain/computador.ts";
import { estadoInicial, type Estado } from "../../../web/estado/reducer.ts";
import { aguardandoPorAgente, textoAguardando } from "../../../web/lib/aguardando.ts";
import { dadosDoEncolhido, renderCartaoEncolhido } from "../../../web/telas/cartao-encolhido.ts";
import { acaoDoComputador, cartaoDoPedidoDeAjuda, ondeEntrar, pedidoParaAguardando, renderCartaoComputador, renderSuaVez, textosDaAjuda } from "../../../web/telas/sua-vez.ts";

/**
 * Spec D (Computador do bot), itens 5 e 6: o cartão da aprovação de uma ação no computador, o do pedido de ajuda, a
 * prévia laranja da barra e as linhas de sistema que os cartões viram.
 */
type Item = SuaVezDto["itens"][number];

const AGORA = Date.parse("2026-11-12T12:00:00Z");
const autoria = { autor_tipo: "agente", autor_id: "a", sob_procuracao_de: null, conta_de_execucao: "p", executor: "local", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: null, decidido_por: "regra:localidade", regra_versao: 1 } as const;
const daPessoa = { ...autoria, autor_tipo: "pessoa", autor_id: "p", decidido_por: "pessoa" } as const;
const nina = { id: "a", tenantId: "t", ownerId: "p", nome: "Nina", titulo: "", descricao: "", descricaoEstado: "", cor: "c-black", forma: "quadrado", conversaId: "c", confirmado: true, fixado: false, oculto: false, naoLido: false, secao: null, computadorForaDoAr: null } as never;

function decisao(id: string, tipo: Item["decisao"]["tipo"], frase: string): Item["decisao"] {
  return { tenantId: "t", id, ownerId: "p", decisorId: "p", agenteId: "a", conversaId: "c", turnoId: "t1", tipo, estado: "pendente", prazoDecisaoEm: new Date(AGORA + 86_400_000).toISOString(), prazoExecucaoEm: null, frase, desfecho: null, vistaEm: null, criadoEm: new Date(AGORA - 60_000).toISOString(), fioId: null };
}

function aprovacao(texto: string): Item {
  return {
    decisao: decisao("d", "aprovacao", "Ação no computador do bot"), estadoColuna: "pendente", agenteNome: "Nina", aguardandoHaMs: 60_000, recusaAutomaticaEmMs: 3_600_000, gemeas: [], proposta: null, fio: null, rotinaParada: null,
    itensAprovacao: [{ tenantId: "t", id: "i", decisaoId: "d", idx: 0, textoOriginal: texto, textoFinal: texto, destino: { conector: "computador", ferramenta: "executar", argumentos: { acaoId: "x" } }, selecionado: true, origemSensivel: false, justificativa: null, marcadoPor: null, marcadoEm: null, editadoPor: null, desfecho: null, motivoManual: null }],
  };
}

function ajuda(motivo: string): Item {
  return { decisao: decisao("h", "pergunta", textoPedidoDeTela(motivo)), estadoColuna: "pendente", agenteNome: "Nina", aguardandoHaMs: 60_000, recusaAutomaticaEmMs: 3_600_000, gemeas: [], proposta: null, fio: null, rotinaParada: null, itensAprovacao: [], pedido: { texto: textoPedidoDeTela(motivo), ajudaDoComputador: true, origem: "conversa" } };
}

const falaDeAjuda = (motivo: string): Mensagem => ({ tenantId: "t", id: "m1", conversaId: "c", turnoId: "t1", autoria, kind: "texto", texto: textoPedidoDeTela(motivo), payload: { kind: "pedido_a_pessoa", decisaoId: "h", ajudaDoComputador: true }, confianca: "confiavel", parcial: false, criadoEm: AGORA - 60_000 });

function cenario(itens: Item[], mensagens: Mensagem[] = [], fios: FioDaPergunta[] = [], pessoaId = "p"): Estado {
  return {
    ...estadoInicial,
    agora: AGORA,
    sessao: { tenantId: "t", pessoaId },
    frota: { agentes: [nina], inventario: null, negacoes: [] } as never,
    suaVez: { itens, incidentes: [], foraDoAr: [], vazio: itens.length === 0, ultimaDecisaoEm: null },
    conversas: { c: { conversa: { tenantId: "t", id: "c", ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "a", salaId: null, sessaoCli: null, criadoEm: 0 }, mensagens, propostas: [], turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], fios, carregadaEm: 0 } },
  } as Estado;
}

describe("item 5: a ação no computador em três formas", () => {
  it("a caixa mono, a frase e as poucas palavras saem do texto que o servidor grava (resumoAcaoComputador)", () => {
    expect(acaoDoComputador(resumoAcaoComputador({ tipo: "navegar", url: "https://www.nfse.prefeitura.gov.br/guias" } as never))).toEqual({ crua: "navegar · nfse.prefeitura.gov.br/guias", frase: "Abre nfse.prefeitura.gov.br no navegador do computador.", curta: "abrir nfse.prefeitura.gov.br" });
    expect(acaoDoComputador(resumoAcaoComputador({ tipo: "clicar", x: 10, y: 20 } as never)).crua).toBe("clicar · posição 10, 20");
    expect(acaoDoComputador(resumoAcaoComputador({ tipo: "digitar", texto: "olá" } as never)).crua).toBe("digitar · “olá”");
    expect(acaoDoComputador(resumoAcaoComputador({ tipo: "tecla", tecla: "Enter" } as never)).curta).toBe("apertar Enter");
    expect(acaoDoComputador(resumoAcaoComputador({ tipo: "terminal", comando: "ls -la" } as never)).crua).toBe("terminal · ls -la");
    expect(acaoDoComputador("algo novo").crua).toBe("algo novo");
  });

  it("o cartão: cabeçalho Computador com o X 'Negar uma vez', a pergunta de hoje e 'Ver a tela' só para a dona", () => {
    const html = renderCartaoComputador(aprovacao("Abrir no navegador: https://exemplo.com"), cenario([]));
    expect(html).toContain('aria-label="Negar uma vez"');
    expect(html).toContain("Permitir que Nina faça isto no computador do bot?");
    expect(html).toContain('data-act="abrir-computador" data-id="a">Ver a tela</button>');
    expect(html).not.toContain("data-assumir");
    expect(renderCartaoComputador(aprovacao("Abrir no navegador: https://exemplo.com"), cenario([], [], [], "outra"))).not.toContain("Ver a tela");
  });

  it("negar vira a linha de sistema 'Você não permitiu: {ação}'; negado por outra pessoa segue o encolhido de sempre", () => {
    const recibo = (autorId: string): Mensagem => ({ tenantId: "t", id: "r1", conversaId: "c", turnoId: "t1", autoria: { ...daPessoa, autor_id: autorId }, kind: "resultado_aprovacao", texto: "", payload: { kind: "resultado_aprovacao", decisaoId: "d", frase: "Ação no computador do bot", itens: [{ idx: 0, desfecho: "retirado_pela_pessoa", texto: "Abrir no navegador: https://exemplo.com/x" }] }, confianca: "confiavel", parcial: false, criadoEm: AGORA });
    const dados = dadosDoEncolhido(recibo("p"), cenario([]));
    expect(dados).not.toBeNull();
    const html = renderCartaoEncolhido(dados!, "r1");
    expect(html).toContain('class="msg-sistema cc-linha cartao-encolhido"');
    expect(html).toContain("Você não permitiu: abrir exemplo.com");
    expect(dadosDoEncolhido(recibo("outra"), cenario([]))?.resultado).toBe("Negado");
  });
});

describe("item 6: o pedido de ajuda", () => {
  it("o site sai do motivo: 'Entre no {site}', a prévia e as duas linhas de depois", () => {
    expect(ondeEntrar("Entrar no portal de vendas")).toBe("no portal de vendas");
    expect(ondeEntrar("verificar que é humano no LinkedIn")).toBe("no LinkedIn");
    expect(ondeEntrar("resolver o captcha")).toBeNull();
    expect(textosDaAjuda("Entrar no portal de vendas")).toEqual({ titulo: "Entre no portal de vendas", previa: "entrar no portal de vendas", entrou: "Entrou no portal de vendas", naoEntrou: "Você não entrou no portal de vendas" });
    expect(textosDaAjuda("resolver o captcha.").titulo).toBe("Resolver o captcha");
  });

  it("aberto, o cartão com a miniatura, o texto e 'Assumir o controle' que abre já no controle; o X e 'Agora não' dispensam", () => {
    const e = cenario([ajuda("Entrar no portal de vendas")], [falaDeAjuda("Entrar no portal de vendas")], [{ id: "h", agenteId: "a", estado: "esperando_voce", rodada: 1, decisoes: ["h"], mensagens: ["m1"] }]);
    const r = cartaoDoPedidoDeAjuda(falaDeAjuda("Entrar no portal de vendas"), e);
    expect(r?.linha).toBe(false);
    expect(r?.html).toContain('<p class="cc-titulo">Entre no portal de vendas</p>');
    expect(r?.html).toContain("Entrar no portal de vendas. Assuma o controle, entre e clique em Parar. Nina não vê o que você digita.");
    expect(r?.html).toContain('class="cc-mini sem-imagem" data-tela-bot="a"');
    expect(r?.html).toMatch(/data-act="abrir-computador" data-id="a" data-assumir="1"[^>]*>Assumir o controle</);
    expect(r?.html).toContain('data-act="dispensar" data-id="h" title="Agora não" aria-label="Agora não"');
    expect(r?.html).toContain('data-act="dispensar" data-id="h">Agora não</button>');
  });

  it("depois de Parar, 'Entrou no {site}'; depois de 'Agora não', 'Você não entrou no {site}'; outra fala, null", () => {
    const m = falaDeAjuda("Entrar no portal de vendas");
    const respondida: Mensagem = { tenantId: "t", id: "m2", conversaId: "c", turnoId: "t1", autoria: daPessoa, kind: "texto", texto: "Concluí o passo no computador e devolvi o controle. Observe a tela e continue.", payload: { kind: "resposta_a_pedido", decisaoId: "h", agenteId: "a", perguntaEm: AGORA - 60_000, retomada: true }, confianca: "confiavel", parcial: false, criadoEm: AGORA };
    expect(cartaoDoPedidoDeAjuda(m, cenario([], [m, respondida]))).toEqual({ html: '<div class="msg-sistema cc-linha">Entrou no portal de vendas</div>', linha: true });
    const deixada = cenario([], [m], [{ id: "h", agenteId: "a", estado: "deixada_pra_la", rodada: 1, decisoes: ["h"], mensagens: ["m1"] }]);
    expect(cartaoDoPedidoDeAjuda(m, deixada)?.html).toContain("Você não entrou no portal de vendas");
    expect(cartaoDoPedidoDeAjuda({ ...m, texto: "outra pergunta" }, deixada)).toBeNull();
  });

  it("em 'Sua vez', o pedido de ajuda da própria pessoa é o mesmo cartão", () => {
    const html = renderSuaVez(cenario([ajuda("Entrar no portal de vendas")]));
    expect(html).toContain("cc-ajuda");
    expect(html).toContain(">Assumir o controle</button>");
    expect(html).not.toContain("<input");
  });
});

describe("barra lateral enquanto espera (itens 5 e 6)", () => {
  it("'Aguardando você: {ação em poucas palavras}' e 'Aguardando você: entrar no {site}'; outro pedido passa como veio", () => {
    const texto = (i: Item) => textoAguardando(aguardandoPorAgente([pedidoParaAguardando(i)]).get("a")!);
    expect(texto(aprovacao("Abrir no navegador: https://www.exemplo.com/a"))).toBe("Aguardando você: abrir exemplo.com");
    expect(texto(ajuda("Entrar no portal de vendas"))).toBe("Aguardando você: entrar no portal de vendas");
    const outro = { ...ajuda("x"), pedido: null, decisao: decisao("o", "pergunta", "Qual planilha?") };
    expect(pedidoParaAguardando(outro)).toBe(outro);
  });
});
