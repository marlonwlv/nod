import { describe, expect, it } from "vitest";
import type { TesteDeIa } from "../../../../../src/contracts/desktop.ts";
import type { EstadoOnboarding, IaNoMac, ModeloDeBot } from "../../../../../src/contracts/onboarding.ts";
import { Executor } from "../../../../../web/react/onboarding/executor.tsx";
import type { ConexaoIa, EstadoTelaOnboarding, TesteNaTela } from "../../../../../web/telas/onboarding.ts";
import { desenhar } from "./ajuda.tsx";

/**
 * ADR-179 (fase 5): a etapa "A IA dos seus bots" em React — as mesmas telas de 2026-10-05 (testando, "Falta conectar uma
 * IA", os três passos e "Seus bots já têm uma IA") que antes eram testadas pelo HTML em string (onboarding.test.ts).
 */
const modelo = { app: { slug: "gmail", nome: "Gmail", letra: "G", cor: "#d93025" }, pode: [], nao: "", rotinas: [] } as unknown as ModeloDeBot;
function dados(p: Partial<EstadoOnboarding> = {}): EstadoOnboarding {
  return {
    etapa: null, mostrar: true, campos: { apelido: null, comoConheceu: null, objetivo: null, tamanhoTime: null }, modelo,
    guia: { id: "g1", nome: "Nod", conversaId: "cg", forma: "shape-square", cor: "c-black" }, bot: null, passo: "bot",
    pendentes: { bot: null, acesso: null, rotina: null }, appConectado: false, rotinaCriada: null, concluidoEm: null, ligacao: null, recusa: null,
    executor: { pronto: true, ias: [{ id: "claude-cli", estado: "pronto" }] }, ...p,
  };
}
const tela = (p: Partial<EstadoTelaOnboarding> = {}): EstadoTelaOnboarding => ({ dados: dados(), fase: "executor", procurando: false, iaEntrando: null, notaIa: null, teste: null, atendendo: false, emLigacao: false, appConectando: false, ocupado: false, ...p });
const teste = (p: Partial<TesteNaTela> = {}): TesteNaTela => ({ rodando: false, vereditos: {}, testando: [], conexao: null, seguindo: false, nome: null, ...p });
const comIas = (...ias: IaNoMac[]): EstadoOnboarding => dados({ etapa: "executor", executor: { pronto: ias.some((i) => i.estado === "pronto"), ias } });
const SEM_ACESSO: TesteDeIa = { ia: "claude-cli", estado: "nao_autenticado", causa: "conta_sem_acesso" };
const RESPONDEU: TesteDeIa = { ia: "codex-cli", estado: "pronto", resposta: "Oi, Marlon. Estou pronto para trabalhar com os seus bots." };
const executor = (e: EstadoTelaOnboarding) => desenhar((a) => <Executor e={e} {...a} />);

describe("sem teste (navegador comum ou app antigo)", () => {
  it("procurando: só o texto da busca, sem cards", () => {
    const { html } = executor(tela({ procurando: true }));
    expect(html).toContain("A IA dos seus bots");
    expect(html).toContain("Procurando o Claude Code e o Codex neste Mac…");
    expect(html).not.toContain("ob-card-ia");
  });

  it("os quatro cards: Claude e ChatGPT pelo inventário; Grok e Gemini em breve", () => {
    const r = executor(tela({ dados: dados({ executor: { pronto: false, ias: [{ id: "claude-cli", estado: "nao_autenticado" }, { id: "codex-cli", estado: "ausente" }] } }) }));
    for (const nome of ["Claude", "ChatGPT", "Grok", "Gemini"]) expect(r.html).toContain(`<b>${nome}</b>`);
    expect(r.html.match(/em-breve/g)).toHaveLength(2);
    expect(r.html).toContain("Claude Code instalado · falta entrar");
    expect(r.html).toContain("Codex não está neste Mac");
    expect(r.cliques()).toEqual([
      { acao: "onboarding-ia-entrar", dados: { ia: "claude-cli" }, rotulo: "Entrar" },
      { acao: "onboarding-ia-instalar", dados: { ia: "codex-cli" }, rotulo: "Instalar e entrar" },
    ]);
    expect(r.html).toContain("Dá para trocar ou adicionar outra depois, em Seu espaço › Provedores de IA.");
  });

  it("NOD-171: o CLI desatualizado mostra o comando com Copiar, que diz se copiou", async () => {
    const r = executor(tela({ dados: dados({ executor: { pronto: false, ias: [{ id: "claude-cli", estado: "ausente", causa: "cli_antigo", versao: "1.0.0", minima: "2.0.0" }] } }) }));
    expect(r.html).toContain("ob-ia-atualizar");
    const copiar = r.getByRole("button", { name: "Copiar" });
    copiar.click();
    await r.findByRole("button", { name: "✓ Copiado" });
    expect(r.copiar).toHaveBeenCalledOnce();
  });
});

describe("teste de verdade: testando", () => {
  it("a IA logada mostra a pergunta e os três pontinhos; a que não está, 'Procurando…'; nada para clicar", () => {
    const d = comIas({ id: "claude-cli", estado: "pronto" }, { id: "codex-cli", estado: "ausente" });
    const r = executor(tela({ dados: d, teste: teste({ rodando: true, nome: "Marlon" }) }));
    expect(r.html).toContain("Estou testando cada uma com uma pergunta curta.");
    expect(r.html).toContain("Diga oi para Marlon em uma frase curta, em português. Só a frase.");
    expect(r.getByRole("img", { name: "Esperando a resposta" })).toBeTruthy();
    expect(r.getByRole("img", { name: "Testando" })).toBeTruthy();
    expect(r.getByRole("img", { name: "Procurando" })).toBeTruthy();
    expect(r.html).toContain("O teste gasta uma resposta curta da sua assinatura.");
    expect(r.html.match(/class="ob-breve"/g)).toHaveLength(2);
    expect(r.cliques()).toEqual([]);
  });
});

describe("teste de verdade: 'Falta conectar uma IA'", () => {
  const d = comIas({ id: "claude-cli", estado: "pronto" }, { id: "codex-cli", estado: "ausente" });
  const montar = () => executor(tela({ dados: d, teste: teste({ vereditos: { "claude-cli": SEM_ACESSO, "codex-cli": { ia: "codex-cli", estado: "ausente" } } }) }));

  it("o título, o Claude com o aviso e os dois botões, o ChatGPT com 'Instalar e entrar', Grok e Gemini em breve", () => {
    const r = montar();
    expect(r.html).toContain('<h1 tabindex="-1">Falta conectar uma IA</h1>');
    expect(r.html).toContain("Testei as IAs deste Mac e nenhuma respondeu. Conecte uma e o Nod te liga em seguida.");
    expect(r.cliques()).toEqual([
      { acao: "onboarding-ia-entrar", dados: { ia: "claude-cli" }, rotulo: "Entrar com outra conta" },
      { acao: "onboarding-ia-como-liberar", dados: { ia: "claude-cli" }, rotulo: "Como liberar" },
      { acao: "onboarding-ia-instalar", dados: { ia: "codex-cli" }, rotulo: "Instalar e entrar" },
    ]);
    expect(r.html.match(/Em breve/g)).toHaveLength(2);
    expect(r.html).toContain("O nod nunca vê sua senha nem sua chave. Dá para trocar ou adicionar outra IA depois, em Seu espaço › Provedores de IA.");
  });

  it("o aviso não fica só na cor (ícone + frase) e não há data-act (o clique é prop)", () => {
    const r = montar();
    expect(r.html).toMatch(/<span class="aviso" role="status"><span class="rx-svg"><svg[^>]*aria-hidden="true">.*?<\/svg><\/span>Conta sem acesso ao Claude Code<\/span>/);
    expect(r.container.querySelector("[data-act]")).toBeNull();
  });

  it("sem nenhuma conta logada, a frase não diz que testou", () => {
    const { html } = executor(tela({ dados: comIas({ id: "claude-cli", estado: "ausente" }, { id: "codex-cli", estado: "nao_autenticado" }), teste: teste() }));
    expect(html).toContain("Não achei uma IA conectada neste Mac. Conecte uma e o Nod te liga em seguida.");
    expect(html).not.toContain("Testei");
  });
});

describe("teste de verdade: conectar em três passos", () => {
  const nova: ConexaoIa = { ia: "codex-cli", outraConta: false, login: "nao", nota: null };

  it("o primeiro passo: a página e o login no navegador, e o texto não diz que o nod instalou", () => {
    const r = executor(tela({ dados: comIas({ id: "codex-cli", estado: "ausente" }), teste: teste({ conexao: nova }) }));
    expect(r.html).toContain("Conectando o ChatGPT");
    expect(r.html).toContain("São três passos. Os dois primeiros são com você.");
    expect(r.html).not.toMatch(/nod instalou/i);
    expect(r.cliques().map((c) => c.acao)).toEqual(["onboarding-ia-cancelar", "onboarding-ia-pagina", "onboarding-ia-login"]);
  });

  it("o teste de resposta gira no terceiro passo; os feitos levam 'Feito:' para o leitor de tela", () => {
    const aberta: ConexaoIa = { ...nova, login: "aberto" };
    const r = executor(tela({ dados: comIas({ id: "codex-cli", estado: "pronto" }), teste: teste({ conexao: aberta, testando: ["codex-cli"] }) }));
    expect(r.html).toContain("São três passos. O do meio é com você, no navegador.");
    expect(r.html.match(/<li class="ob-passo /g)).toHaveLength(3);
    expect(r.html).toMatch(/<li class="ob-passo ativo" aria-current="step"><span class="ob-gira passo" role="img" aria-label="Em andamento"><\/span><div class="ob-passo-txt"><b>Teste de resposta<\/b>/);
    expect(r.html.match(/<span class="sr-only">Feito:<\/span>/g)).toHaveLength(2);
    expect(r.html).toContain('<ol class="ob-passos" aria-live="polite">');
    expect(r.html).toContain("o login acontece direto com a OpenAI.");
  });
});

describe("teste de verdade: 'Seus bots já têm uma IA'", () => {
  const d = comIas({ id: "claude-cli", estado: "nao_autenticado", causa: "conta_sem_acesso" }, { id: "codex-cli", estado: "pronto" });

  it("mostra a pergunta e a resposta de verdade, o Continuar e o outro provedor ainda com problema", () => {
    const r = executor(tela({ dados: d, teste: teste({ vereditos: { "claude-cli": SEM_ACESSO, "codex-cli": RESPONDEU }, nome: "Marlon" }) }));
    expect(r.html).toContain("O ChatGPT respondeu ao teste neste Mac. O Nod vai te ligar para montar o seu primeiro bot.");
    expect(r.html).toContain("Diga oi para Marlon em uma frase curta, em português. Só a frase.");
    expect(r.html).toContain("<b>Oi, Marlon. Estou pronto para trabalhar com os seus bots.</b>");
    expect(r.html).toContain("Conectado · respondeu ao teste");
    expect(r.html).toContain('<button type="button" class="ob-pilula grande">Continuar</button>');
    expect(r.html).toContain('<button type="button" class="ob-pilula contorno">Entrar com outra conta</button>');
    // O bloco de explicação fica na lista; aqui o outro provedor é uma linha só.
    expect(r.html).not.toContain("ob-ia-explica");
    expect(r.cliques().map((c) => c.acao)).toEqual(["onboarding-ia-entrar", "onboarding-ia-continuar"]);
  });

  it("sem a resposta (app antigo), só 'Conectado', com o ícone", () => {
    const { html } = executor(tela({ dados: d, teste: teste({ vereditos: { "codex-cli": { ia: "codex-cli", estado: "pronto" } } }) }));
    expect(html).toContain("O ChatGPT está conectado neste Mac.");
    expect(html).toMatch(/<span class="ok" role="status"><span class="rx-svg"><svg.*?<\/svg><\/span>Conectado<\/span>/);
    expect(html).not.toContain("ob-prova");
  });

  it("depois do Continuar, o botão fica ocupado enquanto o servidor não reconhece a IA", () => {
    const { html } = executor(tela({ dados: d, teste: teste({ vereditos: { "codex-cli": RESPONDEU }, seguindo: true }) }));
    expect(html).toContain('<button type="button" class="ob-pilula grande" disabled=""><span class="ob-gira" aria-hidden="true"></span>Continuar</button>');
  });

  it("com as duas respondendo, a principal é o Claude e o ChatGPT aparece conectado, sem botão", () => {
    const duas = teste({ vereditos: { "claude-cli": { ia: "claude-cli", estado: "pronto", resposta: "Oi!" }, "codex-cli": RESPONDEU } });
    const r = executor(tela({ dados: comIas({ id: "claude-cli", estado: "pronto" }, { id: "codex-cli", estado: "pronto" }), teste: duas }));
    expect(r.html).toContain("O Claude respondeu ao teste neste Mac.");
    expect(r.html).toContain("<b>Oi!</b>");
    expect(r.cliques().map((c) => c.acao)).toEqual(["onboarding-ia-continuar"]);
  });
});
