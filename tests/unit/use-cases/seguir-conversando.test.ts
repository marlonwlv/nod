import { describe, expect, it, vi } from "vitest";
import { TIPOS_DISPENSADOS_AO_SEGUIR, type TipoDecisao } from "../../../src/contracts/decisao.ts";
import { fraseCurtaDoPedido, linhaDoPedidoDispensado } from "../../../src/domain/pedido-dispensado.ts";
import { textoPedidoDeTela } from "../../../src/domain/computador.ts";
import { enviarMensagem } from "../../../src/use-cases/enviar-mensagem.ts";
import { FALA_DA_AJUDA, FALA_DO_CODIGO, FALA_DO_LOGIN } from "../../../src/adapters/fundo/navegadores.ts";
import { FECHA_AO_SEGUIR } from "../../../web/lib/pedidos-que-esperam.ts";
import { depsMemoria } from "../../helpers/deps-l7.ts";
import { PESSOA_ANA } from "../../helpers/ids.ts";

/**
 * ADR-191 (definido em 2026-11-20, pedido do dono): a mensagem nova da pessoa fecha os pedidos abertos de antes dela como
 * dispensados por ela, e o bot fica sabendo pela linha fixa no histórico.
 */
const INICIO = Date.parse("2026-11-20T10:00:00-03:00");
const DIA = 86_400_000;
const PRONTO = { estado: "pronto" as const, versao: "teste", em: 0 };

async function cena() {
  let agora = INICIO;
  const d = depsMemoria({ agora: () => agora });
  const agente = await d.deps.repos.agentes.criar({ nome: "Frida", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "claude-haiku-4-5-20251001" });
  const conversa = await d.deps.repos.conversas.criar({ tipo: "propria", agenteId: agente?.id ?? "" });
  const agenteId = agente?.id ?? "", conversaId = conversa?.id ?? "";
  const turno = await d.deps.repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: agora + 10_000, profundidade: 0, entradaTexto: "organize o drive", entradaConfianca: "confiavel", modelo: "sonnet" });
  await d.deps.repos.turnos.assentar(turno?.id ?? "", { estado: "concluido" });
  const turnoId = turno?.id ?? null;
  // O banco em memória carimba `criadoEm` com o relógio de parede: o pedido "de antes" da mensagem recua um minuto, como
  // no Postgres (transações diferentes, clock_timestamp()).
  const decidir = async (tipo: TipoDecisao, frase: string, extra: { decisorId?: string; tarefaId?: string; id?: string } = {}) => {
    const criada = await d.deps.repos.decisoes.criar({ tipo, agenteId, conversaId, turnoId, prazoDecisaoEm: agora + DIA, frase, ...extra });
    const linha = d.banco.decisoes.find((x) => x.id === criada?.id);
    if (linha) linha.criadoEm = new Date(Date.parse(linha.criadoEm) - 60_000).toISOString();
    return criada;
  };
  const antes = (id: string | undefined) => {
    const p = d.banco.propostas.find((x) => x.id === id);
    if (p) p.criadoEm -= 60_000;
  };
  const enviar = async (texto: string) => {
    agora += 60_000;
    return enviarMensagem(d.deps, { conversaId, texto, inventario: PRONTO });
  };
  return { d, agenteId, conversaId, turnoId, decidir, enviar, antes };
}

describe("a mensagem nova dispensa os pedidos abertos de antes dela (ADR-191)", () => {
  it("fecha acesso, propostas e o 'Retomar' como dispensados pela pessoa, com o estado de antes", async () => {
    const c = await cena();
    const acesso = await c.decidir("acesso", "Frida quer ler seu Google Drive");
    const app = await c.decidir("app", "Criar o app Vagas");
    const retomar = await c.decidir("retomar_turno", "Turno interrompido: seu Mac parou de responder.");
    const r = await c.enviar("na verdade, me ajude com outra coisa");
    for (const id of [acesso?.id, app?.id, retomar?.id]) {
      expect(c.d.banco.decisoes.find((x) => x.id === id), c.d.banco.decisoes.find((x) => x.id === id)?.tipo).toMatchObject({ estado: "decidida", desfecho: { tipo: "dispensada", por: c.d.deps.escopo.pessoaId, antes: "pendente" } });
    }
    expect((r.events ?? []).filter((e) => e.kind === "decisao_decidida").map((e) => e.dados?.motivo)).toEqual(["seguiu_conversando", "seguiu_conversando", "seguiu_conversando"]);
    // Um turno só: o da mensagem nova (nenhuma retomada nasce do dispensar).
    expect(c.d.banco.turnos.filter((t) => t.origem === "retomada")).toHaveLength(0);
    expect(r.data.turno.entradaTexto).toBe("na verdade, me ajude com outra coisa");
  });

  it("ficam de fora: perguntas de texto, gate, CSV, tarefa do quadro, outra decisora, vencida e a aprovação (ADR-184)", async () => {
    const c = await cena();
    const fora = [
      await c.decidir("pergunta", "qual planilha?"),
      await c.decidir("falta_de_dado", "falta o e-mail do cliente"),
      await c.decidir("permissao", "posso apagar?"),
      await c.decidir("gate_rotina", "a rotina pede"),
      await c.decidir("decisoes_exportacao", "CSV de outubro"),
      await c.decidir("acesso", "pedido de uma tarefa", { tarefaId: "00000000-0000-4000-8000-000000000001" }),
      await c.decidir("acesso", "dirigido a outra pessoa", { decisorId: PESSOA_ANA }),
    ];
    const vencida = await c.decidir("rotina", "rotina vencida");
    const v = c.d.banco.decisoes.find((x) => x.id === vencida?.id);
    if (v) v.estado = "vencida";
    const aprovacao = await c.decidir("aprovacao", "Pagar R$ 249,90 na loja");
    await c.enviar("outra coisa");
    for (const d of fora) expect(c.d.banco.decisoes.find((x) => x.id === d?.id)?.estado, d?.frase).toBe("pendente");
    expect(c.d.banco.decisoes.find((x) => x.id === vencida?.id)?.estado).toBe("vencida");
    // A aprovação sai pela regra da ADR-184 (substituída), não como dispensada.
    expect(c.d.banco.decisoes.find((x) => x.id === aprovacao?.id)?.desfecho).toMatchObject({ tipo: "decidida_por_regra", regra: "regra:aprovacao_substituida" });
    expect(c.d.banco.mensagens.filter((m) => m.payload?.kind === "pedido_dispensado")).toHaveLength(0);
  });

  it("o pedido criado DEPOIS da mensagem e o de um turno ainda vivo ficam abertos", async () => {
    const c = await cena();
    const vivo = await c.d.deps.repos.turnos.enfileirar({ executor: "catcher", conversaId: c.conversaId, agenteId: c.agenteId, origem: "conversa", prazoEm: INICIO + DIA, profundidade: 0, entradaTexto: "rodando", entradaConfianca: "confiavel", modelo: "sonnet" });
    const doVivo = await c.d.deps.repos.decisoes.criar({ tipo: "acesso", agenteId: c.agenteId, conversaId: c.conversaId, turnoId: vivo?.id ?? null, prazoDecisaoEm: INICIO + DIA, frase: "Frida quer ler seu Gmail" });
    const depois = await c.d.deps.repos.decisoes.criar({ tipo: "acesso", agenteId: c.agenteId, conversaId: c.conversaId, prazoDecisaoEm: INICIO + DIA, frase: "Frida quer ler seu Gmail" });
    const linha = c.d.banco.decisoes.find((x) => x.id === depois?.id);
    if (linha) linha.criadoEm = new Date(Date.now() + 60_000).toISOString();
    await c.enviar("e aí?");
    expect(c.d.banco.decisoes.find((x) => x.id === doVivo?.id)?.estado).toBe("pendente");
    expect(c.d.banco.decisoes.find((x) => x.id === depois?.id)?.estado).toBe("pendente");
  });

  it("a proposta de mesmo id sai recusada junto, e o card de conexão (sem decisão) também", async () => {
    const c = await cena();
    const rotina = await c.d.deps.repos.propostas.criar({ conversaId: c.conversaId, agenteId: c.agenteId, payload: { kind: "rotina_execucao", rotinaId: "00000000-0000-4000-8000-000000000002", resumo: "às 09:00" } as never });
    await c.decidir("rotina_execucao", "Rodar agora a rotina", { id: rotina?.id ?? "" });
    const conexao = await c.d.deps.repos.propostas.criar({ conversaId: c.conversaId, agenteId: c.agenteId, payload: { kind: "acesso", conectar: true, conector: "googledrive", capacidades: [], nivel: "leitura", naoPedido: [], ...(c.turnoId ? { turnoId: c.turnoId } : {}) } });
    c.antes(rotina?.id);
    c.antes(conexao?.id);
    const r = await c.enviar("deixa pra depois");
    expect(c.d.banco.propostas.find((p) => p.id === rotina?.id)?.estado).toBe("recusada");
    expect(c.d.banco.propostas.find((p) => p.id === conexao?.id)?.estado).toBe("recusada");
    const recibos = c.d.banco.mensagens.filter((m) => m.payload?.kind === "pedido_dispensado");
    expect(recibos.map((m) => m.payload)).toEqual(expect.arrayContaining([
      expect.objectContaining({ decisaoId: rotina?.id, tipo: "rotina_execucao", motivo: "seguiu_conversando" }),
      expect.objectContaining({ decisaoId: conexao?.id, tipo: "acesso", conector: "googledrive", conectar: true, frase: "Conectar o googledrive", turnoId: c.turnoId }),
    ]));
    expect((r.events ?? []).filter((e) => e.kind === "agente_atualizado" && e.dados?.acao === "proposta_recusada")).toHaveLength(2);
  });

  it("a ajuda do computador (o balão diz) fecha, o computador volta ao bot e nenhuma retomada nasce", async () => {
    const c = await cena();
    const ajuda = await c.decidir("pergunta", textoPedidoDeTela("entrar no Drive"));
    await c.d.deps.repos.mensagens.criar({ conversaId: c.conversaId, turnoId: c.turnoId, autoria: { autor_tipo: "agente", autor_id: c.agenteId } as never, kind: "texto", texto: textoPedidoDeTela("entrar no Drive"), payload: { kind: "pedido_a_pessoa", decisaoId: ajuda?.id ?? "", ajudaDoComputador: true }, confianca: "confiavel" });
    const configurar = vi.fn(async () => undefined);
    const registrar = vi.fn(async () => undefined);
    const c1 = { id: "c1", controle: "aguardando_pessoa", ajudaDecisaoId: ajuda?.id };
    Object.assign(c.d.deps.repos.computadores, { buscarVinculo: async () => c1, daPessoa: async () => null, travar: async () => c1, configurar, registrar });
    await c.enviar("já fiz por fora");
    expect(c.d.banco.decisoes.find((x) => x.id === ajuda?.id)?.desfecho).toMatchObject({ tipo: "dispensada" });
    expect(configurar).toHaveBeenCalledWith("c1", expect.objectContaining({ controle: "bot", ajudaDecisaoId: null }));
    expect(registrar).toHaveBeenCalledWith(expect.objectContaining({ tipo: "devolver" }));
    expect(c.d.banco.turnos.filter((t) => t.origem === "retomada")).toHaveLength(0);
    const recibo = c.d.banco.mensagens.find((m) => m.payload?.kind === "pedido_dispensado");
    expect(recibo?.payload).toMatchObject({ ajuda: true, frase: "entrar no Drive", agenteId: c.agenteId });
  });

  it("os pedidos do navegador (ajuda, login, código) fecham e a vista do bot solta o pedido depois do commit (cenários 22/11, ponto 02)", async () => {
    const c = await cena();
    const falas = [FALA_DA_AJUDA("google.com pede para provar que é gente (CAPTCHA). Resolva na tela e devolva para mim."), FALA_DO_LOGIN("saucedemo.com", "para montar o carrinho"), FALA_DO_CODIGO("o Itaú mandou um SMS")];
    const ids: string[] = [];
    for (const f of falas) {
      const p = await c.decidir("pergunta", f);
      ids.push(p?.id ?? "");
      await c.d.deps.repos.mensagens.criar({ conversaId: c.conversaId, turnoId: c.turnoId, autoria: { autor_tipo: "agente", autor_id: c.agenteId } as never, kind: "texto", texto: f, payload: { kind: "pedido_a_pessoa", decisaoId: p?.id ?? "" }, confianca: "confiavel" });
    }
    const efeitos: unknown[] = [];
    (c.d.deps as { aposCommit?: (e: unknown) => void }).aposCommit = (e) => void efeitos.push(e);
    await c.enviar("Deixa pra lá, não precisa mais.");
    for (const id of ids) expect(c.d.banco.decisoes.find((x) => x.id === id)?.desfecho).toMatchObject({ tipo: "dispensada" });
    expect(efeitos).toEqual([{ tipo: "pedidos_dispensados", decisaoIds: expect.arrayContaining(ids) }]);
    expect(c.d.banco.turnos.filter((t) => t.origem === "retomada")).toHaveLength(0);
  });

  it("o bot fica sabendo: uma linha fixa por pedido, gravada antes do turno da mensagem nova", async () => {
    const c = await cena();
    await c.decidir("acesso", "Frida quer ler seu Google Drive.");
    const r = await c.enviar("outra coisa");
    const recibo = c.d.banco.mensagens.find((m) => m.payload?.kind === "pedido_dispensado");
    expect(recibo).toMatchObject({ kind: "sistema", autoria: { autor_tipo: "pessoa" }, texto: linhaDoPedidoDispensado("Frida quer ler seu Google Drive") });
    expect(recibo?.texto).toContain("Nada foi feito");
    expect(recibo?.texto).toContain("Não peça de novo agora");
    // Antes do turno: entra no "desde a sua última vez" e no histórico do turno que a mensagem criou.
    expect(recibo?.criadoEm).toBeLessThanOrEqual(r.data.turno.criadoEm);
    expect(recibo?.criadoEm).toBeGreaterThanOrEqual(r.data.mensagem.criadoEm);
  });

  it("a mensagem reenviada com a mesma chave não dispensa de novo", async () => {
    const c = await cena();
    await c.decidir("acesso", "Frida quer ler seu Google Drive");
    const idEnvio = "00000000-0000-4000-8000-0000000000aa";
    await enviarMensagem(c.d.deps, { conversaId: c.conversaId, texto: "oi", inventario: PRONTO, idEnvio });
    const outra = await c.decidir("app", "Criar o app Vagas");
    const r = await enviarMensagem(c.d.deps, { conversaId: c.conversaId, texto: "oi", inventario: PRONTO, idEnvio });
    expect(r.events).toEqual([]);
    expect(c.d.banco.decisoes.find((x) => x.id === outra?.id)?.estado).toBe("pendente");
  });
});

describe("a frase do pedido e a linha do bot", () => {
  it("a ajuda do computador fica só com o motivo; o resto perde o ponto final e corta longo", () => {
    expect(fraseCurtaDoPedido(textoPedidoDeTela("entrar no Drive"))).toBe("entrar no Drive");
    expect(fraseCurtaDoPedido("Frida quer ler seu   Gmail.")).toBe("Frida quer ler seu Gmail");
    const longa = fraseCurtaDoPedido("a".repeat(400));
    expect([...longa]).toHaveLength(160);
    expect(longa.endsWith("…")).toBe(true);
  });

  it("os pedidos do navegador ficam só com o motivo (cenários 22/11)", () => {
    expect(fraseCurtaDoPedido(FALA_DA_AJUDA("www.google.com pede para provar que é gente (CAPTCHA). Resolva na tela e devolva para mim."))).toBe("www.google.com pede para provar que é gente (CAPTCHA)");
    expect(fraseCurtaDoPedido(FALA_DO_LOGIN("saucedemo.com", "para montar o carrinho"))).toBe("entrar em saucedemo.com: para montar o carrinho");
    expect(fraseCurtaDoPedido(FALA_DO_CODIGO("o Itaú mandou um SMS"))).toBe("o Itaú mandou um SMS");
  });

  it("a linha diz que nada foi feito e pede para seguir com a mensagem nova", () => {
    expect(linhaDoPedidoDispensado("conectar o Google Drive")).toBe("A pessoa seguiu sem responder ao seu pedido: conectar o Google Drive. Nada foi feito com ele. Não peça de novo agora: siga com a mensagem nova e só volte ao pedido se ela pedir.");
  });

  it("a web espelha a lista do contrato (Record sobre TipoDecisao)", () => {
    const daWeb = Object.entries(FECHA_AO_SEGUIR).filter(([, v]) => v).map(([k]) => k).sort();
    expect(daWeb).toEqual([...TIPOS_DISPENSADOS_AO_SEGUIR].sort());
  });
});
