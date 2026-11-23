import { describe, expect, it } from "vitest";
import type { OfertaGuardarLogin, PedidoDaVistaNavegador, TarefaEnsinada } from "../../../src/contracts/navegador-do-bot.ts";
import { CODIGO_ENVIADO, DO_CHROME, FALA_DA_AJUDA, FALA_DO_CODIGO, FALA_DO_LOGIN, LOGIN_PREENCHIDO, RETOMADA, SO_USUARIO } from "../../../src/adapters/fundo/navegadores.ts";
import {
  botoesDoLogin, htmlBarraDeGravacao, htmlCartaoAjudaNavegador, htmlCartaoAprovacao, htmlCartaoAprovacaoSemVista, htmlCartaoCodigo, htmlCartaoPedidoSemVista, htmlCartaoCombinar, htmlCartaoLogin, htmlHabilidades, htmlLinhaGoogleRecusou, htmlLinhaGuardar,
  htmlPassosGravados, htmlSeloDoLogin, linhaDaRespostaDoNavegador, nomeDoSite, nomeSugeridoDosPassos, noOuNa, pedidoDoNavegadorNaFala, rotuloDaGravacao,
} from "../../../web/lib/navegador-cartoes.ts";
import { htmlMenuDoMais } from "../../../web/telas/folha-mais.ts";

/**
 * ADR-190 (Paper "Navegador · login e cofre, aprovações, ensinar": L, A, T; K3, M4): os cartões puros do navegador do bot
 * na conversa, em Sua vez e no celular, a barra de gravação e as habilidades.
 */
type Login = Extract<PedidoDaVistaNavegador, { tipo: "login" }>;
const login = (x: Partial<Login> = {}): Login => ({
  tipo: "login", decisaoId: "d-1", site: "Itaú", motivo: "Para baixar a fatura de novembro", etapa: "escolher", erro: null, podeTrazerDoChrome: true,
  opcoes: [{ fonte: "1password", ref: "op://Pessoal/Itau", rotulo: "Itaú · marlon@…", disponivel: true }], ...x,
});
const ordemDosBotoes = (html: string) => [...html.matchAll(/<button[^>]*>(?:<span>)?([^<]+)/g)].map((m) => m[1]);

describe("as falas do portão viram o cartão do navegador (cópia conferida com o servidor)", () => {
  it("login, código e ajuda são reconhecidos pela frase exata do servidor", () => {
    expect(pedidoDoNavegadorNaFala(FALA_DO_LOGIN("Itaú", "Para baixar a fatura. De novembro"))).toEqual({ tipo: "login", site: "Itaú", motivo: "Para baixar a fatura. De novembro" });
    expect(pedidoDoNavegadorNaFala(FALA_DO_CODIGO("O Itaú mandou um código por SMS"))).toEqual({ tipo: "codigo", motivo: "O Itaú mandou um código por SMS" });
    expect(pedidoDoNavegadorNaFala(FALA_DA_AJUDA("resolver o CAPTCHA"))).toEqual({ tipo: "ajuda", motivo: "resolver o CAPTCHA" });
    expect(pedidoDoNavegadorNaFala("Preciso entrar em Itaú para continuar.")).toBeNull();
  });

  it("a resposta que fecha o pedido vira a linha discreta; resposta comum passa", () => {
    expect(linhaDaRespostaDoNavegador(LOGIN_PREENCHIDO("itau.com.br"))).toBe("Login preenchido no itau.com.br");
    expect(linhaDaRespostaDoNavegador(SO_USUARIO("itau.com.br"))).toBe("Usuário preenchido no itau.com.br");
    expect(linhaDaRespostaDoNavegador(CODIGO_ENVIADO)).toBe("Código enviado");
    expect(linhaDaRespostaDoNavegador(DO_CHROME("tap.pt", 12))).toBe("Sessão de tap.pt trazida do seu Chrome");
    expect(linhaDaRespostaDoNavegador(RETOMADA.resolver)).toBe("Você resolveu no navegador");
    expect(linhaDaRespostaDoNavegador(RETOMADA.devolver)).toBe("Você devolveu o navegador");
    expect(linhaDaRespostaDoNavegador("Pode seguir")).toBeNull();
  });

  it("o nome do site e a preposição", () => {
    expect(nomeDoSite("itau.com.br")).toBe("Itau");
    expect(nomeDoSite("Itaú")).toBe("Itaú");
    expect(noOuNa("Itaú")).toBe("no");
    expect(noOuNa("TAP")).toBe("na");
    expect(noOuNa("Amazona")).toBe("na");
  });
});

describe("L1, L2, M4, K3: o cartão de login", () => {
  it("o item que casa é o botão preto com o usuário mascarado; depois Entrar eu mesmo e Trazer do meu Chrome", () => {
    const html = htmlCartaoLogin(login(), { nome: "Ada", agenteId: "a1", url: "https://www.itau.com.br/login" });
    // D7 (DS do nod x Grok Bot): o título fala com a pessoa; o nome do bot com o artigo fica no rótulo do grupo.
    expect(html).toContain('aria-label="A Ada precisa entrar no Itaú"');
    expect(html).toContain('<p class="cc-titulo">Entre no Itaú</p>');
    expect(html).toContain("Para baixar a fatura de novembro · itau.com.br");
    expect(html).toContain("No 1Password: Itaú · marlon@….");
    // As pílulas à direita, a preta por último.
    expect(ordemDosBotoes(html)).toEqual(["Entrar eu mesmo", "Trazer do meu Chrome", "Usar o 1Password"]);
    expect(html).toMatch(/cc-bt cc-uma pri"[^>]*data-fonte="1password"[^>]*data-ref="op:\/\/Pessoal\/Itau" title="Itaú · marlon@…">Usar o 1Password</);
    expect(html).toContain('class="cc-cartao cc-molde nvc nvc-login"');
    expect(html).not.toContain("nvc-ponto");
  });

  it("M4/K3: o 1Password sem o Mac fica cinza com o motivo; o cofre do nod vira o preto; sem Chrome", () => {
    const p = login({
      site: "TAP", podeTrazerDoChrome: false,
      opcoes: [
        { fonte: "1password", ref: "", rotulo: "TAP · marlon@…", disponivel: false, motivoIndisponivel: "precisa do Mac ligado" },
        { fonte: "nod", ref: "00000000-0000-4000-8000-000000000001", rotulo: "TAP · marlon@…", disponivel: true },
      ],
    });
    expect(botoesDoLogin(p).map((b) => [b.tipo, b.principal])).toEqual([["cofre", false], ["cofre", true], ["eu_mesmo", false]]);
    const html = htmlCartaoLogin(p, { nome: "Ada", agenteId: "a1" });
    expect(html).toContain("Entre na TAP");
    expect(ordemDosBotoes(html)).toEqual(["Usar o 1Password", "Entrar eu mesmo", "Usar o cofre do nod"]);
    expect(html).toMatch(/nvc-op-indisponivel" disabled aria-disabled="true" title="precisa do Mac ligado">Usar o 1Password</);
    expect(html).toContain("1Password indisponível: precisa do Mac ligado.");
    expect(html).not.toContain("Trazer do meu Chrome");
  });

  it("sem nenhum item disponível, o preto vira Entrar eu mesmo", () => {
    const p = login({ opcoes: [{ fonte: "bitwarden", ref: "abc", rotulo: "Itaú · m…", disponivel: false, motivoIndisponivel: "destravar no seu Mac" }] });
    expect(botoesDoLogin(p).find((b) => b.tipo === "eu_mesmo")?.principal).toBe(true);
    expect(htmlCartaoLogin(p, { nome: "Ada", agenteId: "a1" })).toMatch(/cc-bt cc-uma pri" data-act="nv-login"[^>]*data-escolha="eu_mesmo"/);
  });

  it("L2: confirme no Mac no lugar das opções (também no celular); o erro da última tentativa aparece", () => {
    const html = htmlCartaoLogin(login({ etapa: "confirme_no_mac" }), { nome: "Ada", agenteId: "a1", fonte: "1password" });
    expect(html).toContain("Confirme no seu Mac");
    expect(html).toContain("entrando com o 1Password");
    expect(html).not.toContain('data-act="nv-login"');
    expect(htmlCartaoLogin(login({ erro: "Você não confirmou no Mac. Escolha de novo." }), { nome: "Ada", agenteId: "a1" })).toContain('role="alert">Você não confirmou no Mac');
  });

  it("L3: o selo diz a fonte enquanto o Mac confirma ou o segredo está na página", () => {
    expect(htmlSeloDoLogin({ pedido: null, segredoNaPagina: false }, "1password")).toBe("");
    expect(htmlSeloDoLogin({ pedido: login({ etapa: "confirme_no_mac" }), segredoNaPagina: false }, "1password")).toContain("Entrando com o 1Password…");
    expect(htmlSeloDoLogin({ pedido: null, segredoNaPagina: true }, null)).toContain("Campo protegido");
  });
});

describe("L4, L5: o código e guardar no cofre", () => {
  it("o campo do código é privado: sem valor, sem autocompletar comum, sem corretor; a nota diz para onde vai", () => {
    const html = htmlCartaoCodigo({ decisaoId: "d-2", agenteId: "a1", motivo: "O Itaú mandou um código por SMS.", nome: "Ada" });
    expect(html).toContain('<p class="cc-titulo">O Itaú mandou um código por SMS</p>');
    expect(html).toContain('data-form="nv-codigo"');
    const campo = /<input[^>]*>/.exec(html)![0];
    expect(campo).toContain('autocomplete="one-time-code"');
    expect(campo).toContain('spellcheck="false"');
    expect(campo).toContain('autocorrect="off"');
    expect(campo).not.toMatch(/\svalue=/);
    expect(html).toContain("Vai direto para a página. Não fica na conversa nem chega à Ada.");
  });

  it("guardar: um destino vai escondido; vários viram a escolha; vencida não aparece", () => {
    const oferta = (destinos: OfertaGuardarLogin["destinos"], ate = 10_000): OfertaGuardarLogin => ({ site: "bradesco.com.br", usuario: "m…", destinos, ate });
    const um = htmlLinhaGuardar({ oferta: oferta(["nod"]), agenteId: "a1", agora: 1_000 });
    expect(um).toContain("Você entrou no Bradesco digitando. Guardar no cofre?");
    expect(um).toContain('type="hidden" class="nvc-destino" value="nod"');
    expect(ordemDosBotoes(um)).toEqual(["Guardar", "Não"]);
    const varios = htmlLinhaGuardar({ oferta: oferta(["nod", "1password", "bitwarden"]), agenteId: "a1", agora: 1_000 });
    expect(varios).toMatch(/<select class="nvc-destino"[^>]*><option value="nod">cofre do nod<\/option><option value="1password">1Password<\/option><option value="bitwarden">Bitwarden<\/option>/);
    expect(htmlLinhaGuardar({ oferta: oferta(["nod"], 500), agenteId: "a1", agora: 1_000 })).toBe("");
  });

  it("2026-11-23: a recusa do Google oferece trazer o login do site de origem do Chrome", () => {
    const html = htmlLinhaGoogleRecusou({ site: "www.linkedin.com", agenteId: "a1" });
    expect(html).toContain("O Google não deixa entrar pelo navegador do bot.");
    expect(html).toMatch(/Entre no Linkedin com o login do seu Chrome\./u);
    expect(html).toContain('data-act="nv-trazer-chrome" data-agente="a1" data-site="www.linkedin.com"');
    expect(ordemDosBotoes(html)).toEqual(["Trazer do meu Chrome"]);
    expect(htmlLinhaGoogleRecusou({ site: "", agenteId: "a1" })).not.toContain("data-site");
  });
});

describe("A1, A2, A3: as aprovações do navegador", () => {
  type Ap = Extract<PedidoDaVistaNavegador, { tipo: "aprovacao" }>;
  const ap = (x: Partial<Ap> = {}): Ap => ({ tipo: "aprovacao", decisaoId: "d-3", pergunta: "Pagar R$ 3.780 na TAP?", botao: "Pagar R$ 3.780", classe: "pagar", touchId: true, avisoTouchId: null, caixa: null, lembrar: null, ...x });

  it("A1: pagar com Touch ID; sem o Mac, o botão comum e o aviso; Ver a tela só para a dona", () => {
    const html = htmlCartaoAprovacao(ap(), { agenteId: "a1", nome: "Ada", dono: true });
    expect(html).toContain("Pagar R$ 3.780 na TAP?");
    expect(ordemDosBotoes(html)).toEqual(["Ver a tela", "Não", "Pagar com Touch ID"]);
    const semMac = htmlCartaoAprovacao(ap({ touchId: false, avisoTouchId: "Seu Mac está desligado: a confirmação vai só pelo botão, sem o Touch ID." }), { agenteId: "a1", nome: "Ada", dono: false });
    // Achado 1 do crítico: o botão diz que não vai pedir o Touch ID (o mesmo rótulo da pílula).
    expect(ordemDosBotoes(semMac)).toEqual(["Não", "Pagar sem Touch ID"]);
    expect(semMac).toContain("sem o Touch ID");
  });

  it("A3: a citação e 'Não perguntar de novo para o Pedro' já marcado", () => {
    const html = htmlCartaoAprovacao(ap({ pergunta: "Enviar a mensagem para Pedro no WhatsApp Web?", botao: "Enviar", classe: "enviar", touchId: false, citacao: "Pedro, a passagem saiu: TAP, 10/3, 21:40.", lembrar: { padrao: true, texto: "Não perguntar de novo para o Pedro" } }), { agenteId: "a1", nome: "Ada", dono: true });
    expect(html).toContain("“Pedro, a passagem saiu: TAP, 10/3, 21:40.”");
    expect(html).toMatch(/<input type="checkbox" class="nvc-lembrar-caixa" name="sempre" checked><span>Não perguntar de novo para o Pedro<\/span>/);
    expect(ordemDosBotoes(html).slice(-2)).toEqual(["Não", "Enviar"]);
  });

  it("A2: o combinado com o sim preto por último (DS); sem a vista, a pergunta do item com Não | Sim", () => {
    const html = htmlCartaoCombinar({ tipo: "combinar", decisaoId: "d-4", titulo: "Vou comprar em tap.pt: 1 passagem, até R$ 4.000,00", texto: "Com isso eu pago sem perguntar de novo, se o valor ficar dentro do limite.", sim: "Pode, até R$ 4.000,00", nao: "Me pergunte antes de pagar", touchId: false }, { agenteId: "a1", nome: "Ada", dono: false });
    expect(ordemDosBotoes(html)).toEqual(["Me pergunte antes de pagar", "Pode, até R$ 4.000,00"]);
    expect(html).toMatch(/cc-bt cc-uma pri" data-act="nv-decidir"[^>]*data-aprovar="1">Pode/);
    const sem = htmlCartaoAprovacaoSemVista({ decisaoId: "d-5", agenteId: "a1", pergunta: "Apagar o pedido no loja.com?", nome: "Ada", dono: true });
    expect(ordemDosBotoes(sem)).toEqual(["Ver a tela", "Não", "Sim"]);
  });
});

describe("T: ensinar uma tarefa", () => {
  it("o relógio da barra e o nome sugerido", () => {
    expect(rotuloDaGravacao({ desde: 0, passos: ["a", "b", "c", "d"] }, 42_400)).toBe("0:42 · 4 passos");
    expect(rotuloDaGravacao({ desde: 0, passos: ["a"] }, 61_000)).toBe("1:01 · 1 passo");
    expect(nomeSugeridoDosPassos(["Abriu itau.com.br", "Entrou em Itaú (senha não gravada)", 'Clicou em "Faturas"', 'Escolheu "Novembro"'])).toBe("Faturas em itau.com.br");
    expect(nomeSugeridoDosPassos([])).toBe("Tarefa ensinada");
    expect(nomeSugeridoDosPassos(["Abriu itau.com.br/faturas/2026", 'Clicou em "Baixar"'])).toBe("Baixar em itau.com.br");
  });

  it("T2: a barra com Descartar e Salvar e ensinar; o campo do nome com a sugestão; o teto avisa", () => {
    const g = { desde: 0, passos: ["Abriu itau.com.br", 'Clicou em "Faturas"'], parou: null };
    const barra = htmlBarraDeGravacao({ nome: "Ada", gravacao: g, agora: 42_000, nomeando: false });
    expect(barra).toContain('Ensinando a Ada · <span class="nv-grav-relogio">0:42 · 2 passos</span>');
    expect(ordemDosBotoes(barra)).toEqual(["Descartar", "Salvar e ensinar"]);
    const nomeando = htmlBarraDeGravacao({ nome: "Ada", gravacao: g, agora: 0, nomeando: true });
    expect(nomeando).toContain('value="Faturas em itau.com.br"');
    expect(nomeando).toContain('data-nv-form="nomear"');
    expect(htmlBarraDeGravacao({ nome: "Ada", gravacao: { ...g, parou: "passos" }, agora: 0, nomeando: false })).toContain("chegou a 200 passos");
    expect(htmlBarraDeGravacao({ nome: "Ada", gravacao: { ...g, passos: [] }, agora: 0, nomeando: false })).toMatch(/data-nv-p="salvar-gravacao" disabled/);
  });

  it("T2: os passos gravados numerados, o último em destaque", () => {
    const html = htmlPassosGravados(["Abriu itau.com.br", "Entrou em Itaú (senha não gravada)"]);
    expect(html).toContain("<h2>Passos gravados</h2>");
    expect(html).toContain("<li>1 · Abriu itau.com.br</li>");
    expect(html).toContain('<li class="nv-grav-ultimo">2 · Entrou em Itaú (senha não gravada)</li>');
    // Achado 15: o nome citado com aspas curvas.
    expect(htmlPassosGravados(['Clicou em "Faturas"'])).toContain("1 · Clicou em “Faturas”");
  });

  it("T1: o menu do + no computador com Ensinar uma tarefa", () => {
    const html = htmlMenuDoMais({ anexar: true, novaTarefa: { texto: "⌘N", aria: "Meta+N" }, ensinar: { agenteId: "a1", nome: "Ada" } });
    // Achado 15 do crítico: o atalho à direita (o CSS empurra) e o subtítulo igual ao do ⋯ do navegador.
    expect(html.replace(/<[^>]+>/g, "|").split("|").filter(Boolean)).toEqual(["Foto ou arquivo", "Nova tarefa", "⌘N", "Ensinar uma tarefa", "Mostre no navegador da Ada; ela aprende"]);
    expect(htmlMenuDoMais({ anexar: false, novaTarefa: null, ensinar: { agenteId: "a2", nome: "Milton" } })).toContain("Mostre no navegador do Milton; ele aprende");
  });

  it("T3: Habilidades — carregando, vazia, a lista com Ver e Apagar, o que está apagando some", () => {
    const t: TarefaEnsinada = { id: "t1", nome: "Baixar a fatura do Itaú", passos: ["Abriu itau.com.br", 'Clicou em "Faturas"'], criadaEm: 0 };
    expect(htmlHabilidades(null, { agenteId: "a1", nome: "Ada", temNavegador: false })).toBe("");
    expect(htmlHabilidades(null, { agenteId: "a1", nome: "Ada", temNavegador: true })).toContain("Carregando…");
    const base = { erro: false, abertas: new Set<string>(), apagando: new Set<string>() };
    expect(htmlHabilidades({ ...base, tarefas: [] }, { agenteId: "a1", nome: "Ada", temNavegador: true })).toContain("Nenhuma tarefa ensinada ainda");
    const lista = htmlHabilidades({ ...base, tarefas: [t] }, { agenteId: "a1", nome: "Ada", temNavegador: false });
    expect(lista).toContain("<h3>Habilidades</h3>");
    expect(lista).toContain("Baixar a fatura do Itaú<small>2 passos</small>");
    expect(ordemDosBotoes(lista)).toEqual(["Ver", "Apagar"]);
    expect(lista).not.toContain("nvh-passos");
    expect(htmlHabilidades({ ...base, tarefas: [t], abertas: new Set(["t1"]) }, { agenteId: "a1", nome: "Ada", temNavegador: true })).toContain('<ol class="nvh-passos"><li>Abriu itau.com.br</li>');
    expect(htmlHabilidades({ ...base, tarefas: [t], apagando: new Set(["t1"]) }, { agenteId: "a1", nome: "Ada", temNavegador: true })).toContain("Nenhuma tarefa ensinada ainda");
  });
});

describe("achado 7 do crítico: o nome do bot nos cartões (o artigo pela terminação)", () => {
  it("da/do, à/ao e a/o no código, na ajuda, no caminho até a vista e na gravação", () => {
    expect(htmlCartaoCodigo({ decisaoId: "d", agenteId: "a1", motivo: "O Itaú mandou um código", nome: "Milton" })).toContain("nem chega ao Milton.");
    const ajuda = htmlCartaoAjudaNavegador({ decisaoId: "d", agenteId: "a1", motivo: "Resolver o CAPTCHA", nome: "Milton" });
    expect(ajuda).toContain("O Milton precisa de você no navegador");
    expect(ajuda).toContain("Resolver o CAPTCHA. Faça esse passo no navegador e clique em Já resolvi. O Milton não vê o que você digita.");
    expect(htmlCartaoAjudaNavegador({ decisaoId: "d", agenteId: "a1", motivo: "x", nome: "Ada" })).toContain("A Ada não vê o que você digita.");
    expect(htmlCartaoPedidoSemVista({ tipo: "ajuda", motivo: "x" }, { decisaoId: "d", agenteId: "a1", nome: "Milton" })).toContain("Abrir o navegador do Milton");
    expect(htmlHabilidades({ tarefas: [], erro: false, abertas: new Set(), apagando: new Set() }, { agenteId: "a1", nome: "Ada", temNavegador: true })).toContain("mostre no navegador da Ada.");
  });
});

describe("ponto 08 dos cenários (22/11): o cartão de ajuda com título curto", () => {
  it("o motivo sem www, sem o 'resolva e devolva' do fim e sem a maiúscula no domínio", async () => {
    const { motivoDaAjuda } = await import("../../../web/lib/navegador-cartoes.ts");
    expect(motivoDaAjuda("www.google.com pede para provar que é gente (CAPTCHA). Resolva na tela e devolva para mim")).toBe("google.com pede para provar que é gente (CAPTCHA)");
    expect(motivoDaAjuda("O banco pede a confirmação no app. Confirme no celular e me avise.")).toBe("O banco pede a confirmação no app. Confirme no celular e me avise");
    expect(motivoDaAjuda("o banco pede o token")).toBe("O banco pede o token");
    const html = htmlCartaoAjudaNavegador({ decisaoId: "d", agenteId: "a1", motivo: "www.google.com pede para provar que é gente (CAPTCHA). Resolva na tela e devolva para mim", nome: "Ada" });
    expect(html).toContain('<p class="cc-titulo">A Ada precisa de você no navegador</p>');
    expect(html).not.toContain("Www.");
    expect(html.match(/devolv/gu)).toBeNull();
  });
});

describe("ponto 09 dos cenários (22/11): o espaço do navegador no disco", () => {
  it("o rótulo e a linha no fim de Habilidades", async () => {
    const { rotuloDoEspaco } = await import("../../../web/lib/navegador-cartoes.ts");
    expect(rotuloDoEspaco(200_000)).toBe("menos de 1 MB");
    expect(rotuloDoEspaco(46 * 1024 * 1024 + 10)).toBe("46 MB");
    expect(rotuloDoEspaco(1.5 * 1024 * 1024 * 1024)).toBe("1,5 GB");
    const html = htmlHabilidades({ tarefas: [], erro: false, abertas: new Set(), apagando: new Set(), espacoBytes: 46 * 1024 * 1024 }, { agenteId: "a1", nome: "Ada", temNavegador: true });
    expect(html).toContain("O navegador da Ada ocupa 46 MB no disco.");
    expect(htmlHabilidades({ tarefas: [], erro: false, abertas: new Set(), apagando: new Set() }, { agenteId: "a1", nome: "Ada", temNavegador: true })).not.toContain("no disco");
  });
});

describe("M4 e K3: o motivo da opção cinza", () => {
  it("'precisa do seu Mac ligado' no computador; no celular o 'seu' some pelo CSS (Paper K3: 'precisa do Mac ligado')", async () => {
    const { htmlDoMotivo } = await import("../../../web/lib/navegador-cartoes.ts");
    expect(htmlDoMotivo("precisa do seu Mac ligado")).toBe('precisa do <span class="nvc-so-largo">seu </span>Mac ligado');
    expect(htmlDoMotivo("destravar no seu Mac")).toBe("destravar no seu Mac");
    expect(htmlDoMotivo("<b>")).toBe("&lt;b&gt;");
  });
});
