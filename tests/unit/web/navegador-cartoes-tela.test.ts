import { describe, expect, it, vi } from "vitest";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import type { LoginDoCofreNaTela, RespostaNavegador, TarefaEnsinada, VistaNavegador } from "../../../src/contracts/navegador-do-bot.ts";
import { CODIGO_ENVIADO, FALA_DO_CODIGO, FALA_DO_LOGIN } from "../../../src/adapters/fundo/navegadores.ts";
import { estadoInicial, type Estado } from "../../../web/estado/reducer.ts";
import { criarTelaCofre, MS_DESFAZER_LOGIN } from "../../../web/lib/cofre.ts";
import { MS_DESFAZER_HABILIDADE, registrarHabilidades, telaDasHabilidades } from "../../../web/lib/habilidades.ts";
import { casaComFiltro, renderCofre, siteDoFiltro } from "../../../web/telas/config-cofre.ts";
import { cartaoDoPedidoDoNavegador, ehAprovacaoDoNavegador, pedidoParaAguardando, renderCartaoNavegador } from "../../../web/telas/sua-vez.ts";

/**
 * ADR-190 (L, A, T3): o pedido do navegador na conversa (aberto = cartão a partir da vista; resolvido = linha), a aprovação
 * em "Sua vez" e na conversa, o Cofre › Logins de sites e as Habilidades (os controladores fora do reducer).
 */
const BOT = "00000000-0000-4000-8000-0000000000b1";
const vista = (x: Partial<VistaNavegador> = {}): VistaNavegador => ({
  agenteId: BOT, estado: "ao_vivo", controle: "precisa_de_voce", lugar: { tipo: "nod" },
  abas: [{ id: "t1", titulo: "Itaú", url: "https://www.itau.com.br/login", ativa: true, carregando: false, inseguro: false }],
  aviso: null, passo: null, pedido: null, gravacao: null, descarte: null, segredoNaPagina: false, ofertaGuardar: null, atividadeEm: 0, erro: null, viewport: { w: 1280, h: 800 }, ...x,
});
const msg = (x: Partial<Mensagem>): Mensagem => ({ id: "m1", conversaId: "c1", turnoId: "turno-1", autoria: { autor_tipo: "agente", autor_id: BOT }, kind: "texto", texto: "", criadoEm: 1_000, confianca: "confiavel", ...x }) as Mensagem;

function estadoCom(o: { mensagens: Mensagem[]; fio?: "esperando_voce" | "deixada_pra_la"; navegador?: RespostaNavegador | null }): Estado {
  return {
    ...estadoInicial,
    agora: 5_000,
    sessao: { tenantId: "t", pessoaId: "p" } as never,
    frota: { agentes: [{ id: BOT, nome: "Ada", conversaId: "c1", ownerId: "p" }] } as never,
    conversas: { c1: { conversa: { id: "c1", agenteId: BOT }, mensagens: o.mensagens, fios: o.fio ? [{ estado: o.fio, decisoes: ["d-1"] }] : [] } } as never,
    navegadores: o.navegador === undefined ? {} : { [BOT]: o.navegador },
  };
}

describe("o pedido do navegador na conversa (L1–L4)", () => {
  const pergunta = msg({ texto: FALA_DO_LOGIN("Itaú", "Para baixar a fatura de novembro"), payload: { kind: "pedido_a_pessoa", decisaoId: "d-1", ajudaDoComputador: true } as never });

  it("aberto com a vista: o cartão de login; sem a vista: o caminho até ela; Entrar eu mesmo fecha o cartão", () => {
    const login = { tipo: "login" as const, decisaoId: "d-1", site: "Itaú", motivo: "Para baixar a fatura de novembro", opcoes: [{ fonte: "nod" as const, ref: "x", rotulo: "Itaú · m…", disponivel: true }], podeTrazerDoChrome: false, etapa: "escolher" as const, erro: null };
    const comVista = cartaoDoPedidoDoNavegador(pergunta, estadoCom({ mensagens: [pergunta], fio: "esperando_voce", navegador: { vista: vista({ pedido: login }), disponivel: true } }));
    expect(comVista?.linha).toBe(false);
    expect(comVista?.html).toContain("Usar o cofre do nod");
    expect(comVista?.html).toContain("Para baixar a fatura de novembro · itau.com.br");
    const semVista = cartaoDoPedidoDoNavegador(pergunta, estadoCom({ mensagens: [pergunta], fio: "esperando_voce" }));
    expect(semVista?.html).toContain("Abrir o navegador da Ada");
    const euMesmo = cartaoDoPedidoDoNavegador(pergunta, estadoCom({ mensagens: [pergunta], fio: "esperando_voce", navegador: { vista: vista({ pedido: { ...login, etapa: "eu_mesmo" } }), disponivel: true } }));
    expect(euMesmo?.html).toContain("Você está entrando no Itaú no navegador");
    expect(euMesmo?.html).not.toContain("nv-login");
  });

  it("o código vira o campo privado mesmo sem a vista; enviado, a pergunta vira 'Código enviado'", () => {
    const p = msg({ id: "m2", texto: FALA_DO_CODIGO("O Itaú mandou um código por SMS"), payload: { kind: "pedido_a_pessoa", decisaoId: "d-1", ajudaDoComputador: true } as never });
    expect(cartaoDoPedidoDoNavegador(p, estadoCom({ mensagens: [p], fio: "esperando_voce" }))?.html).toContain('data-form="nv-codigo"');
    const resposta = msg({ id: "m3", autoria: { autor_tipo: "pessoa", autor_id: "p" } as never, texto: CODIGO_ENVIADO, payload: { kind: "resposta_a_pedido", decisaoId: "d-1", agenteId: BOT, perguntaEm: 1_000, retomada: true } as never });
    expect(cartaoDoPedidoDoNavegador(p, estadoCom({ mensagens: [p, resposta] }))).toEqual({ html: '<div class="msg-sistema nvc-linha">Código enviado</div>', linha: true });
  });

  it("deixada vira 'Você não entrou no Itaú'; fala comum do bot não é pedido do navegador", () => {
    expect(cartaoDoPedidoDoNavegador(pergunta, estadoCom({ mensagens: [pergunta], fio: "deixada_pra_la" }))?.html).toContain("Você não entrou no Itaú");
    const comum = msg({ texto: "Posso seguir?", payload: { kind: "pedido_a_pessoa", decisaoId: "d-1" } as never });
    expect(cartaoDoPedidoDoNavegador(comum, estadoCom({ mensagens: [comum] }))).toBeNull();
  });
});

describe("a aprovação do navegador em Sua vez e na conversa (A1–A3)", () => {
  const item = (texto = "Pagar R$ 3.780 na TAP?") => ({
    decisao: { id: "d-9", tipo: "aprovacao", agenteId: BOT, conversaId: "c1", frase: "Ação no navegador do bot" },
    itensAprovacao: [{ textoFinal: texto, destino: { conector: "navegador", ferramenta: "executar", argumentos: {} }, origemSensivel: false }],
    agenteNome: "Ada", estadoColuna: "aberto",
  }) as never;

  it("reconhece só o item de destino navegador; a barra lateral diz a pergunta", () => {
    expect(ehAprovacaoDoNavegador(item())).toBe(true);
    expect((pedidoParaAguardando(item()) as { decisao: { frase: string } }).decisao.frase).toBe("Pagar R$ 3.780 na TAP");
  });

  it("com a vista: o cartão da pílula (Touch ID); sem ela: a pergunta com Não | Sim; fora da conversa, o rótulo do bot", () => {
    const pedido = { tipo: "aprovacao" as const, decisaoId: "d-9", pergunta: "Pagar R$ 3.780 na TAP?", botao: "Pagar", classe: "pagar" as const, touchId: true, avisoTouchId: null, caixa: null, lembrar: null };
    const com = renderCartaoNavegador(item(), estadoCom({ mensagens: [], navegador: { vista: vista({ pedido }), disponivel: true } }));
    expect(com).toContain("Pagar com Touch ID");
    expect(com).toContain("Ver a tela");
    const sem = renderCartaoNavegador(item("Apagar o pedido no loja.com?"), estadoCom({ mensagens: [] }), false);
    expect(sem).toContain("Navegador de Ada");
    expect(sem).toContain(">Sim</button>");
  });
});

describe("Configurações › Cofre › Logins de sites", () => {
  const L = (id: string, site: string): LoginDoCofreNaTela => ({ id, site, usuario: "ma…@exemplo.com", criadoEm: 0 });

  it("o filtro do 'Logins deste site…' casa pelo domínio; a lista e o formulário sem valor de senha", () => {
    expect(siteDoFiltro("https://www.itau.com.br/login")).toBe("itau.com.br");
    expect(casaComFiltro("internetpf.itau.com.br", "itau.com.br")).toBe(true);
    expect(casaComFiltro("bradesco.com.br", "itau.com.br")).toBe(false);
    const html = renderCofre({ credenciais: [], carregando: false, erro: false, logins: [L("1", "itau.com.br"), L("2", "tap.pt")], filtro: "itau.com.br", adicionando: true, apagando: new Set() }, 0, "UTC");
    expect(html).toContain("Logins de <b>itau.com.br</b>");
    expect(html).toContain("itau.com.br");
    expect(html).not.toContain("tap.pt");
    expect(html).toContain('value="itau.com.br"');
    expect(/<input name="senha"[^>]*>/.exec(html)![0]).not.toMatch(/\svalue=/);
    expect(html).toContain('data-act="cofre-mostrar-senha"');
  });

  it("a hora do 'guardado' sai no fuso de quem vê, não em UTC (prova real: 13:35 às 10:35 em Brasília)", () => {
    const guardado = Date.UTC(2026, 10, 20, 13, 35);
    const t = { credenciais: [], carregando: false, erro: false, logins: [{ ...L("1", "the-internet.herokuapp.com"), criadoEm: guardado }], filtro: null, adicionando: false, apagando: new Set<string>() };
    expect(renderCofre(t, guardado + 60_000, "America/Sao_Paulo")).toContain("guardado hoje 10:35");
  });

  it("guardar manda a senha só ao POST; apagar some na hora e só apaga quando o Desfazer passa", async () => {
    const timers: { fn: () => void; ms: number }[] = [];
    const api = {
      cofre: vi.fn(async () => ({ credenciais: [] })),
      cofreLogins: vi.fn(async () => ({ logins: [L("1", "itau.com.br")] })),
      guardarNoCofre: vi.fn(async (l: { site: string; usuario: string; senha: string }) => ({ ok: true as const, login: L("2", l.site) })),
      apagarDoCofre: vi.fn(async () => ({ ok: true as const })),
    };
    const avisos: { texto: string; desfazer: (() => void) | null }[] = [];
    const tela = criarTelaCofre({ api: () => api, render: () => undefined, avisar: (texto, desfazer) => avisos.push({ texto, desfazer }), esperar: (fn, ms) => { const x = { fn, ms }; timers.push(x); return x; }, cancelar: (t) => { timers.splice(timers.indexOf(t as never), 1); } });
    await tela.abrir();
    tela.filtrar("https://itau.com.br/x");
    expect(tela.estado().filtro).toBe("itau.com.br");
    expect(await tela.guardarLogin({ site: "tap.pt", usuario: "", senha: "s3gr3do" })).toBe(true);
    expect(api.guardarNoCofre).toHaveBeenCalledWith({ site: "tap.pt", usuario: "", senha: "s3gr3do" });
    expect(JSON.stringify(tela.estado())).not.toContain("s3gr3do");
    tela.apagarLogin("1");
    expect(tela.estado().apagando?.has("1")).toBe(true);
    expect(avisos.at(-1)?.texto).toBe("Login de itau.com.br apagado");
    avisos.at(-1)!.desfazer!();
    expect(timers).toEqual([]);
    expect(tela.estado().apagando?.has("1")).toBe(false);
    tela.apagarLogin("1");
    expect(timers[0]?.ms).toBe(MS_DESFAZER_LOGIN);
    timers[0]!.fn();
    await vi.waitFor(() => expect(tela.estado().logins?.map((l) => l.id)).toEqual(["2"]));
    expect(api.apagarDoCofre).toHaveBeenCalledWith("1");
  });
});

describe("Ajustes do bot › Habilidades (T3)", () => {
  it("lê uma vez, abre os passos, apaga com Desfazer e só depois chama a rota", async () => {
    const t: TarefaEnsinada = { id: "t1", nome: "Baixar a fatura do Itaú", passos: ["Abriu itau.com.br"], criadaEm: 0 };
    const timers: { fn: () => void; ms: number }[] = [];
    const api = { tarefasEnsinadas: vi.fn(async () => ({ tarefas: [t] })), apagarTarefaEnsinada: vi.fn(async () => ({ ok: true as const })) };
    const avisos: { texto: string; desfazer: () => void }[] = [];
    const h = registrarHabilidades({ api: () => api, render: () => undefined, avisar: (texto, desfazer) => avisos.push({ texto, desfazer }), aoErro: vi.fn(), esperar: (fn, ms) => { const x = { fn, ms }; timers.push(x); return x; }, cancelar: (x) => { timers.splice(timers.indexOf(x as never), 1); } });
    h.pedir(BOT);
    h.pedir(BOT);
    await vi.waitFor(() => expect(telaDasHabilidades(BOT)?.tarefas).toEqual([t]));
    expect(api.tarefasEnsinadas).toHaveBeenCalledTimes(1);
    h.alternar(BOT, "t1");
    expect(telaDasHabilidades(BOT)?.abertas.has("t1")).toBe(true);
    h.apagar(BOT, "t1");
    expect(avisos[0]?.texto).toBe("“Baixar a fatura do Itaú” apagada");
    expect(telaDasHabilidades(BOT)?.apagando.has("t1")).toBe(true);
    avisos[0]!.desfazer();
    expect(telaDasHabilidades(BOT)?.apagando.has("t1")).toBe(false);
    expect(api.apagarTarefaEnsinada).not.toHaveBeenCalled();
    h.apagar(BOT, "t1");
    expect(timers[0]?.ms).toBe(MS_DESFAZER_HABILIDADE);
    timers[0]!.fn();
    await vi.waitFor(() => expect(telaDasHabilidades(BOT)?.tarefas).toEqual([]));
    expect(api.apagarTarefaEnsinada).toHaveBeenCalledWith(BOT, "t1");
  });
});
