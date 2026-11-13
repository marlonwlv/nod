import { describe, expect, it } from "vitest";
import type { TesteDeIa } from "../../../../../src/contracts/desktop.ts";
import type { EstadoIa } from "../../../../../src/contracts/estado-ia.ts";
import type { EstadoOnboarding } from "../../../../../src/contracts/onboarding.ts";
import { UI_IAS_INICIAL, type UiIas } from "../../../../../web/telas/cartao-ia.ts";
import { Executor } from "../../../../../web/react/onboarding/executor.tsx";
import type { TesteNaTela } from "../../../../../web/telas/onboarding.ts";
import { desenhar } from "./ajuda.tsx";

/**
 * ADR-179 (fase 5): o mesmo cartão em React. Tela 5 do plano das IAs (protótipo Onboarding, 2026-10-09): dentro do app do Mac com a ponte `ias`, a etapa "A IA dos
 * seus bots" é o mesmo cartão de Provedores de IA. O app já procurou; instalar, entrar e testar acontecem dentro do
 * cartão; a falha fica no passo, em âmbar; com uma IA pronta, a dica sugere a segunda.
 */
const dados = { etapa: "executor", mostrar: true, executor: { pronto: false, ias: [] } } as unknown as EstadoOnboarding;
const teste = (p: Partial<TesteNaTela> = {}): TesteNaTela => ({ rodando: false, vereditos: {}, testando: [], conexao: null, seguindo: false, nome: null, ...p });
const e = (ia: EstadoIa["ia"], estado: EstadoIa["estado"], extra: Partial<EstadoIa> = {}): EstadoIa => ({ ia, estado, mensagem: "", em: 0, ...extra });
const ui = (estados: Partial<Record<EstadoIa["ia"], EstadoIa>>, p: Partial<UiIas> = {}): UiIas => ({ ...UI_IAS_INICIAL, noApp: true, estados, ...p });
const montar = (iasMac: UiIas, t: TesteNaTela = teste()) => desenhar((a) => <Executor e={{ dados, procurando: false, iaEntrando: null, notaIa: null, teste: t, iasMac }} {...a} />);
const tela = (iasMac: UiIas, t: TesteNaTela = teste()) => montar(iasMac, t).html;
const RESPONDEU: TesteDeIa = { ia: "claude-cli", estado: "pronto", resposta: "Oi!" };

describe("onboarding com o cartão de IA", () => {
  it("enquanto o Mac não respondeu a sonda: só 'Procurando o Claude e o ChatGPT neste Mac…'", () => {
    const h = tela(ui({}), teste({ rodando: true }));
    expect(h).toContain("Procurando o Claude e o ChatGPT neste Mac…");
    expect(h).not.toContain("ob-card-ia");
  });

  it("Claude pronto e respondeu, ChatGPT fora: 'Seus bots já têm uma IA', 'Instalar e entrar' em contorno, a dica da segunda e 'Continuar com o Claude'", () => {
    const h = tela(ui({ "claude-cli": e("claude-cli", "pronta"), "codex-cli": e("codex-cli", "nao_instalada") }), teste({ vereditos: { "claude-cli": RESPONDEU } }));
    expect(h).toContain("Seus bots já têm uma IA");
    expect(h).toContain("Conectado · respondeu ao teste");
    expect(h).toContain('<button type="button" class="ob-pilula contorno">Instalar e entrar</button>');
    expect(h).toContain("Dica: conecte as duas. Se uma chegar ao limite, a outra assume.");
    expect(h).toContain('<button type="button" class="ob-pilula grande">Continuar com o Claude</button>');
    expect(h).not.toContain("ia-verificar");
  });

  it("nenhuma IA: os dois botões cheios e o Continuar desligado", () => {
    const r = montar(ui({ "claude-cli": e("claude-cli", "nao_instalada"), "codex-cli": e("codex-cli", "nao_instalada") }));
    const h = r.html;
    expect(h).toContain("A IA dos seus bots");
    expect(h.match(/<button type="button" class="ob-pilula">Instalar e entrar<\/button>/g)).toHaveLength(2);
    expect(r.cliques().filter((c) => c.acao === "ia-instalar").map((c) => c.dados.ia)).toEqual(["claude-cli", "codex-cli"]);
    expect(h).toContain('<button type="button" class="ob-pilula grande" disabled="">Continuar</button>');
    expect(h).toContain("Conecte pelo menos uma IA para seus bots começarem.");
  });

  it("Claude instalado, falta entrar: 'Entrar'; o teste do onboarding gira no cartão quando a IA fica pronta", () => {
    expect(montar(ui({ "claude-cli": e("claude-cli", "falta_entrar"), "codex-cli": e("codex-cli", "nao_instalada") })).cliques()).toContainEqual({ acao: "ia-entrar", dados: { ia: "claude-cli" }, rotulo: "Entrar" });
    const h = tela(ui({ "claude-cli": e("claude-cli", "pronta"), "codex-cli": e("codex-cli", "nao_instalada") }), teste({ testando: ["claude-cli"] }));
    expect(h).toContain("Encontrado · testando a resposta");
  });

  it("a instalação do ChatGPT falha: o cartão fica âmbar, o passo diz o motivo e oferece 'Tentar de novo'", () => {
    const falhou = e("codex-cli", "nao_instalada", { instalacao: { fase: "falhou", linha: null, tentativa: 2, causa: "sem_internet", mensagem: "Não deu para instalar: sem conexão com a internet.", registro: "x.log" } });
    const r = montar(ui({ "claude-cli": e("claude-cli", "pronta"), "codex-cli": falhou }, { fluxo: { "codex-cli": { instalar: true } } }), teste({ vereditos: { "claude-cli": RESPONDEU } }));
    const h = r.html;
    expect(h).toContain('<div class="ob-card-ia aberto aviso">');
    expect(h).toContain("Não deu para instalar: sem conexão com a internet.");
    const cliques = r.cliques();
    expect(cliques).toContainEqual({ acao: "ia-instalar", dados: { ia: "codex-cli" }, rotulo: "Tentar de novo" });
    expect(cliques).toContainEqual({ acao: "ia-ajuda", dados: { ia: "codex-cli", passo: "instalar" }, rotulo: "Precisa de ajuda?" });
  });

  it("as duas responderam: a ordem final em uma linha e o 'Continuar'", () => {
    const h = tela(ui({ "claude-cli": e("claude-cli", "pronta"), "codex-cli": e("codex-cli", "pronta") }), teste({ vereditos: { "claude-cli": RESPONDEU, "codex-cli": { ia: "codex-cli", estado: "pronto" } } }));
    expect(h).toContain('<div class="ordem-final"><span>Seus bots usam</span>');
    expect(h).toContain("<span>e, se ele parar,</span>");
    expect(h).toContain('<button type="button" class="ob-pilula grande">Continuar</button>');
  });

  it("sem a ponte `ias` (app antigo), as telas de 2026-10-05 continuam", () => {
    const r = desenhar((a) => <Executor e={{ dados, procurando: false, iaEntrando: null, notaIa: null, teste: teste(), iasMac: { ...UI_IAS_INICIAL } }} {...a} />);
    expect(r.cliques().some((c) => c.acao.startsWith("ia-"))).toBe(false);
  });
});
