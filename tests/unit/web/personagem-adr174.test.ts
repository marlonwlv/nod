import { describe, expect, it } from "vitest";
import { estadoInicial } from "../../../web/estado/reducer.ts";
import { ESTADOS_BLOUB, FORMAS_MASCOTE, CORES_MASCOTE, NOME_DA_COR, NOME_DA_FORMA, estadoMascoteNaConversa, htmlMascote, lendoNoTurno, mascoteComAviso } from "../../../web/lib/mascote.ts";
import { STATE_BY_ID } from "../../../web/vendor/bloub/states.ts";
import { SHAPE_BY_ID } from "../../../web/vendor/bloub/skins.ts";
import { FORMAS_BLOUB } from "../../../web/lib/mascote-catalogo.ts";
import { BotEngine } from "../../../web/vendor/bloub/engine.ts";
import { ErroDoPreparo, marcar, novoPreparo, porcentoDe, rodarPreparo, subtituloDoPreparo, tique, type EstadoPreparo } from "../../../web/lib/preparo.ts";
import { APPS, PASSOS, andar, apresentacaoInicial, emailDoGoogle, htmlApresentacao, passoAtual, personagemDoPasso } from "../../../web/telas/apresentacao.ts";
import { estadoDoPreparo, etapasDoBot, htmlFormCriarBot, htmlPreparo, htmlSeletorCor, htmlSeletorForma } from "../../../web/telas/criar-bot.ts";
import type { FrotaDto } from "../../../src/contracts/api.ts";

/** ADR-174: o personagem do nod — estados, formas, cores, preparo com %, onboarding em 10 passos. */

describe("personagem: estados novos", () => {
  it("todo estado do nod aponta para um estado que o motor desenha", () => {
    for (const [nod, bloub] of Object.entries(ESTADOS_BLOUB)) expect(STATE_BY_ID.has(bloub), nod).toBe(true);
    expect(ESTADOS_BLOUB).toMatchObject({ trabalhando: "working", executando: "running", digitando: "streaming", terminou: "finished", aguardando_aprovacao: "blocked", lendo: "reading", comemorando: "celebrate", pausado: "sleeping", offline: "offline" });
  });

  it("offline é pose fixa: o mesmo desenho em qualquer instante, desbotado", () => {
    const engine = new BotEngine(100, "offline", SHAPE_BY_ID.get("cercle")!.radii);
    const a = engine.sample(5, false);
    expect(a).toEqual(engine.sample(40, false));
    expect(a.bodyAlpha).toBeLessThan(1);
  });

  it("lendo, comemorando e dormindo se mexem (não são um quadro só)", () => {
    for (const id of ["reading", "celebrate", "sleeping"] as const) {
      const engine = new BotEngine(100, id, SHAPE_BY_ID.get("cercle")!.radii);
      expect(JSON.stringify(engine.sample(1.0)), id).not.toBe(JSON.stringify(engine.sample(1.37)));
    }
  });

  it("o turno com ferramenta de leitura em uso vira 'lendo'; as outras, 'trabalhando'", () => {
    const rodando = { t1: { turnoId: "t1", conversaId: "c1", estado: "rodando" as const, executor: null, machineId: null, desde: 0 } };
    const comFerramenta = (texto: string) => ({ ...estadoInicial, turnosVivos: rodando, atividades: { c1: { t1: { emUso: { texto, frentes: false } } } } }) as unknown as typeof estadoInicial;
    expect(estadoMascoteNaConversa(comFerramenta("Lendo um arquivo"), "c1")).toBe("lendo");
    expect(estadoMascoteNaConversa(comFerramenta("Rodando um comando"), "c1")).toBe("executando");
    expect(lendoNoTurno("Buscando na web")).toBe(true);
    expect(lendoNoTurno(null)).toBe(false);
  });

  it("computador fora do ar vira 'offline' só para o dono e sem turno vivo; o aviso não o cobre", () => {
    const agente = { id: "a1", conversaId: "c1", ownerId: "p1", computadorForaDoAr: { desde: 1, motivo: "sem_resposta" } };
    const base = { ...estadoInicial, frota: { agentes: [agente] } as unknown as FrotaDto, sessao: { tenantId: "t", pessoaId: "p1" } } as unknown as typeof estadoInicial;
    expect(estadoMascoteNaConversa(base, "c1")).toBe("offline");
    expect(estadoMascoteNaConversa({ ...base, sessao: { tenantId: "t", pessoaId: "outra" } } as typeof base, "c1")).toBe("disponivel");
    expect(mascoteComAviso("offline", "nao-lido")).toBe("offline");
  });

  it("o mascote diz o estado novo no nome acessível", () => {
    expect(htmlMascote({ nome: "Lia", cor: "c-magenta", forma: "shape-heart" }, "", "offline")).toContain("Lia · computador fora do ar");
    expect(htmlMascote({ nome: "Lia", cor: "c-indigo", forma: "shape-star" }, "", "pausado")).toContain('state="sleeping"');
  });
});

describe("personagem: formas e cores", () => {
  it("13 formas e 14 cores, cada uma com nome e com desenho no motor", () => {
    expect(FORMAS_MASCOTE).toHaveLength(13);
    expect(CORES_MASCOTE).toHaveLength(14);
    for (const f of FORMAS_MASCOTE) {
      expect(NOME_DA_FORMA[f]).toBeTruthy();
      const radii = SHAPE_BY_ID.get(FORMAS_BLOUB[f])?.radii;
      expect(radii, f).toHaveLength(64);
      expect(Math.max(...radii!)).toBeLessThanOrEqual(1.2);
      expect(Math.min(...radii!)).toBeGreaterThan(0.3);
    }
    for (const c of CORES_MASCOTE) expect(NOME_DA_COR[c]).toBeTruthy();
  });

  it("os seletores marcam a escolha e o onboarding tira o preto", () => {
    const formas = htmlSeletorForma("shape-star", "c-blue", "apres-forma");
    // Tela 09 do Paper: 8 formas no seletor, mais a do bot quando ela é de fora das 8 (a Estrela).
    expect(formas.match(/role="radio"/g)).toHaveLength(9);
    expect(formas).toContain('aria-checked="true" tabindex="0" aria-label="Estrela"');
    expect(htmlSeletorCor("c-red", "", true)).not.toContain("c-black");
    expect(htmlSeletorCor("c-red").match(/role="radio"/g)).toHaveLength(12);
  });
});

describe("preparo com %", () => {
  it("começa em 0, anda devagar no passo atual e só chega a 100 com tudo feito", () => {
    let p = novoPreparo("Lia");
    expect(p.porcento).toBe(0);
    p = marcar(p, "criado", "agora");
    for (let i = 0; i < 200; i++) p = tique(p);
    expect(p.porcento).toBeLessThan(25);
    expect(p.porcento).toBeGreaterThan(15);
    p = marcar(p, "criado", "feito");
    expect(p.porcento).toBe(25);
    for (const id of ["apps", "computador", "instrucoes"] as const) p = marcar(p, id, "feito");
    expect(p).toMatchObject({ porcento: 100, pronto: true });
    expect(subtituloDoPreparo(p)).toBe("Lia está pronto para trabalhar.");
  });

  it("sem apps o segundo passo é 'Cor e forma'; com apps, 'Apps conectados' e a lista", () => {
    expect(marcar(novoPreparo("Lia"), "apps", "feito").passos[1]).toMatchObject({ rotulo: "Cor e forma", detalhe: null });
    expect(marcar(novoPreparo("Lia", ["Gmail", "Google Agenda"]), "apps", "feito").passos[1]).toMatchObject({ rotulo: "Apps conectados", detalhe: "Gmail, Google Agenda" });
  });

  it("para no passo que falhou com a frase do erro e, de novo, não repete o que já foi feito", async () => {
    const chamadas: string[] = [];
    let computadorOk = false;
    const etapas = {
      criado: async () => { chamadas.push("criado"); },
      apps: async () => { chamadas.push("apps"); },
      computador: async () => { chamadas.push("computador"); if (!computadorOk) throw new ErroDoPreparo("Lia não terminou de se preparar."); },
      instrucoes: async () => { chamadas.push("instrucoes"); },
    };
    const vistos: EstadoPreparo[] = [];
    const parou = await rodarPreparo(novoPreparo("Lia"), etapas, (p) => vistos.push(p));
    expect(parou.erro).toBe("Lia não terminou de se preparar.");
    expect(parou.passos.map((x) => x.situacao)).toEqual(["feito", "feito", "erro", "falta"]);
    expect(estadoDoPreparo(parou)).toBe("disponivel");
    expect(htmlPreparo(parou, { nome: "Lia", cor: "c-teal", forma: "shape-pebble" }, { tentar: 'data-act="t"', ver: 'data-act="v"' })).toContain("Tentar de novo");
    computadorOk = true;
    const fim = await rodarPreparo(parou, etapas, () => undefined);
    expect(fim.pronto).toBe(true);
    expect(chamadas).toEqual(["criado", "apps", "computador", "computador", "instrucoes"]);
    expect(estadoDoPreparo(fim)).toBe("comemorando");
    expect(porcentoDe(fim)).toBe(100);
  });

  it("as etapas do bot criam uma vez só, vestem com a cor e a forma e conferem o computador", async () => {
    const log: string[] = [];
    const ctx = { nome: "Lia", forma: "shape-heart" as const, cor: "c-magenta" as const, criado: null };
    const etapas = etapasDoBot(ctx, {
      criar: async (nome) => { log.push(`criar ${nome}`); return { agenteId: "a1", conversaId: "c1" }; },
      vestir: async (id, forma, cor) => { log.push(`vestir ${id} ${forma} ${cor}`); },
      computadorPronto: async () => false,
    });
    await etapas.criado();
    await etapas.criado();
    await etapas.apps();
    await expect(etapas.computador()).rejects.toThrow("Lia não terminou de se preparar.");
    expect(log).toEqual(["criar Lia", "vestir a1 shape-heart c-magenta"]);
  });

  it("o formulário tem nome, 8 formas, 12 cores (tela 09 do Paper), Cancelar e Criar", () => {
    const html = htmlFormCriarBot({ nome: "Lia", forma: "shape-pebble", cor: "c-teal" });
    expect(html).toContain("Criar novo bot");
    expect(html).toContain('value="Lia"');
    expect(html.match(/class="cb-forma"/g)).toHaveLength(8);
    expect(html.match(/class="cb-cor"/g)).toHaveLength(12);
    expect(html).toContain(">Cancelar<");
    expect(html).toContain(">Criar<");
  });
});

describe("onboarding em 10 passos", () => {
  const ctx = { emailGoogle: false, ligacao: true };

  it("tem os 10 passos do onboarding, na ordem", () => {
    expect(PASSOS).toEqual(["boas-vindas", "conhecer", "computador", "trabalho", "delegar", "funcao", "origem", "apps", "criar", "preparando"]);
  });

  it("cada passo desenha o título, os pontos e a saída certa", () => {
    let e = apresentacaoInicial();
    const html0 = htmlApresentacao(e, ctx);
    expect(html0).toContain("Sua equipe de bots");
    expect(html0).toContain("Prefiro conversar por voz");
    expect(htmlApresentacao(e, { ...ctx, ligacao: false })).not.toContain("Prefiro conversar por voz");
    const titulos = ["Este é o nod", "Ele tem o próprio computador", "Dê um trabalho a cada bot", "Passe qualquer tarefa ao seu time", "No que você mais vai trabalhar?", "Como você conheceu o nod?", "Conecte seus apps"];
    for (const titulo of titulos) {
      e = andar(e, 1);
      const html = htmlApresentacao(e, ctx);
      expect(html, titulo).toContain(titulo);
      expect(html).toContain(`Passo ${e.passo + 1} de 10`);
      expect(html).toContain('data-act="apres-voltar"');
    }
    expect(passoAtual(e)).toBe("apps");
    expect(htmlApresentacao(e, ctx)).toContain("Agora não");
    expect(htmlApresentacao({ ...e, apps: ["gmail"] }, ctx)).toContain(">Conectado<");
    expect(htmlApresentacao(e, { ...ctx, emailGoogle: true })).toContain("Sugerido");
  });

  it("função e origem só seguem com uma escolha, mas dá para pular", () => {
    const e = { ...apresentacaoInicial(), passo: PASSOS.indexOf("funcao") };
    expect(htmlApresentacao(e, ctx)).toMatch(/data-act="apres-seguir" disabled/);
    expect(htmlApresentacao(e, ctx)).toContain('data-act="apres-pular"');
    expect(htmlApresentacao({ ...e, funcao: "Vendas" }, ctx)).not.toMatch(/data-act="apres-seguir" disabled/);
    expect(personagemDoPasso({ ...e, funcao: "Vendas" })).toBe("comemorando");
  });

  it("chegar ao passo 9 com uma função sugere o nome; o passo 9 cria com cor, forma e a primeira mensagem", () => {
    const e = andar({ ...apresentacaoInicial(), passo: PASSOS.indexOf("apps"), funcao: "Finanças" }, 1);
    expect(passoAtual(e)).toBe("criar");
    expect(e.nome).toBe("Nina");
    const html = htmlApresentacao(e, ctx);
    expect(html).toContain("O que Nina deve fazer primeiro?");
    expect(html).toContain('data-act="apres-criar"');
    expect(html).not.toContain("c-black");
    expect(andar(e, 1).passo).toBe(PASSOS.indexOf("criar"));
  });

  it("o preparo não volta e mostra a barra com %", () => {
    const e = { ...apresentacaoInicial(), nome: "Lia", passo: PASSOS.indexOf("preparando"), preparo: marcar(novoPreparo("Lia"), "criado", "feito") };
    expect(andar(e, -1).passo).toBe(e.passo);
    const html = htmlApresentacao(e, ctx);
    expect(html).toContain("Preparando Lia");
    expect(html).toContain('aria-valuenow="25"');
    expect(html).not.toContain('data-act="apres-voltar"');
  });

  it("e-mail do Google sugere Gmail e Agenda", () => {
    expect(emailDoGoogle("ana@gmail.com")).toBe(true);
    expect(emailDoGoogle("ana@empresa.com.br")).toBe(false);
    expect(APPS.map((a) => a.slug)).toEqual(["gmail", "googlecalendar", "slack", "linear"]);
  });
});
