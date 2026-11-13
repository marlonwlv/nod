import { fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { TesteDeIa } from "../../../../../src/contracts/desktop.ts";
import type { EstadoOnboarding, IaNoMac, ModeloDeBot } from "../../../../../src/contracts/onboarding.ts";
import { Chamando, GuiaSolta, Ola, PainelEntrevista } from "../../../../../web/react/onboarding/ligacao.tsx";
import type { EstadoTelaOnboarding, TesteNaTela } from "../../../../../web/telas/onboarding.ts";
import { desenhar } from "./ajuda.tsx";

/** ADR-179 (fase 5): as camadas do onboarding por ligação (ADR-077) em React. */
const modelo: ModeloDeBot = {
  objetivo: "clientes", fala: "Responder clientes mais rápido", curto: "responder clientes mais rápido", nome: "Atendente", papel: "Clientes",
  descricao: "Lê os e-mails de clientes e escreve rascunhos no meu tom.", forma: "shape-triangle", cor: "c-amber",
  app: { slug: "gmail", nome: "Gmail", letra: "G", cor: "#d93025" }, pode: ["Ler e-mails da caixa de entrada", "Criar rascunhos de resposta"], nao: "Enviar sem a sua aprovação",
  rotinas: [
    { quando: "Dias úteis, 8:00", oque: "O que pede resposta hoje", cron: "0 8 * * 1-5", instrucao: "x" },
    { quando: "De hora em hora", oque: "Avisar quando chegar algo urgente", cron: "0 * * * *", instrucao: "y" },
    { quando: "Sexta, 17:00", oque: "Resumo dos clientes da semana", cron: "0 17 * * 5", instrucao: "z" },
  ],
};
function dados(p: Partial<EstadoOnboarding> = {}): EstadoOnboarding {
  return {
    etapa: null, mostrar: true, campos: { apelido: null, comoConheceu: null, objetivo: null, tamanhoTime: null }, modelo,
    guia: { id: "g1", nome: "Nod", conversaId: "cg", forma: "shape-square", cor: "c-black" }, bot: null, passo: "bot",
    pendentes: { bot: null, acesso: null, rotina: null }, appConectado: false, rotinaCriada: null, concluidoEm: null, ligacao: null, recusa: null,
    executor: { pronto: true, ias: [{ id: "claude-cli", estado: "pronto" }] }, ...p,
  };
}
const tela = (p: Partial<EstadoTelaOnboarding> = {}): EstadoTelaOnboarding => ({ dados: dados(), fase: "configurando", procurando: false, iaEntrando: null, notaIa: null, teste: null, atendendo: false, emLigacao: true, appConectando: false, ocupado: false, ...p });
const teste = (p: Partial<TesteNaTela> = {}): TesteNaTela => ({ rodando: false, vereditos: {}, testando: [], conexao: null, seguindo: false, nome: null, ...p });
const comIas = (...ias: IaNoMac[]): EstadoOnboarding => dados({ etapa: "executor", executor: { pronto: true, ias } });
const SEM_ACESSO: TesteDeIa = { ia: "claude-cli", estado: "nao_autenticado", causa: "conta_sem_acesso" };
const RESPONDEU: TesteDeIa = { ia: "codex-cli", estado: "pronto", resposta: "Oi" };

describe("'olá'", () => {
  it("é um botão de tela cheia que pula a abertura", () => {
    const r = desenhar((a) => <Ola executar={a.executar} />);
    expect(r.html).toContain("<span>olá</span>");
    expect(r.cliques()).toEqual([{ acao: "onboarding-pular-ola", dados: {}, rotulo: "olá" }]);
  });
});

describe("'está te ligando'", () => {
  const chamando = (e: EstadoTelaOnboarding) => desenhar((a) => <Chamando e={e} executar={a.executar} />);

  it("a linha do provedor: a primeira IA pronta, com o logo; o teste ganha do servidor; sem IA do Mac, não aparece", () => {
    expect(chamando(tela({ fase: "chamando" })).html).toMatch(/<p class="ob-pensa"><span class="ob-pensa-logo"><svg.*?<\/svg><\/span>Nod vai pensar com o Claude deste Mac<\/p>/);
    const d = comIas({ id: "claude-cli", estado: "pronto" }, { id: "codex-cli", estado: "pronto" });
    expect(chamando(tela({ fase: "chamando", dados: d, teste: teste({ vereditos: { "claude-cli": SEM_ACESSO, "codex-cli": RESPONDEU } }) })).html).toContain("Nod vai pensar com o ChatGPT deste Mac");
    expect(chamando(tela({ fase: "chamando", dados: dados({ executor: { pronto: true, ias: [] } }) })).html).not.toContain("vai pensar");
  });

  it("Atender e 'Configurar sem voz', com a linha da voz sob o Atender e o 'saber mais'", () => {
    const r = chamando(tela({ fase: "chamando" }));
    expect(r.html).toContain("<b>Nod</b><span>está te ligando</span>");
    expect(r.html).toContain("Sua fala é transcrita pelo Google, nos EUA; nada é gravado");
    expect(r.html).toContain('aria-describedby="ob-aviso-voz"');
    expect(r.cliques().map((c) => c.acao)).toEqual(["onboarding-sem-voz", "onboarding-atender", "onboarding-saber-mais"]);
    // O personagem da guia é o <nod-mascote> de sempre (web/lib/mascote.ts), no tamanho grande.
    expect(r.container.querySelector("nod-mascote")?.getAttribute("class")).toContain("xxl");
  });

  it("depois do clique os dois botões ficam desabilitados", () => {
    expect(chamando(tela({ fase: "chamando", atendendo: true })).container.querySelectorAll("button[disabled]")).toHaveLength(2);
  });
});

describe("entrevista: o painel 'O que você contou'", () => {
  it("vazio mostra o convite; preenchido, as linhas", () => {
    expect(desenhar(() => <PainelEntrevista dados={dados()} />).html).toContain("Aparece aqui durante a ligação.");
    const d = dados({ campos: { apelido: "Marlon", comoConheceu: "Indicação", objetivo: "Responder clientes", tamanhoTime: "2_10" } });
    const { html } = desenhar(() => <PainelEntrevista dados={d} />);
    expect(html).toContain("<b>Marlon</b>");
    expect(html).toContain("<span>Time</span><b>2 a 10</b>");
    expect(html).toContain('aria-live="polite"');
  });
});

describe("configuração guiada solta (sem a conversa da guia)", () => {
  const guia = (e: EstadoTelaOnboarding) => desenhar((a) => <GuiaSolta e={e} executar={a.executar} />);

  it("passo bot: o card do modelo, com Nome e 'O que ele faz' editáveis, e o 'Fazer depois'", () => {
    const r = guia(tela({ dados: dados({ etapa: "configurando", campos: { apelido: "Marlon", comoConheceu: null, objetivo: null, tamanhoTime: null } }) }));
    expect(r.html).toContain("Oi, Marlon. Seguimos na ligação");
    expect(r.html).toContain("Novo bot · preenchido com o que você contou");
    const nome = r.getByLabelText("Nome") as HTMLInputElement;
    expect(nome.value).toBe("Atendente");
    fireEvent.change(nome, { target: { value: "Lia" } });
    fireEvent.submit(nome.closest("form")!);
    expect(r.executar).toHaveBeenCalledWith("onboarding-bot-enviar", { nome: "Lia", descricao: modelo.descricao, decisao: undefined });
    fireEvent.click(r.getByRole("button", { name: "Fazer depois" }));
    expect(r.executar).toHaveBeenLastCalledWith("onboarding-depois");
  });

  it("com a proposta da guia pendente, o card é dela e decide pela decisão", () => {
    const d = dados({ etapa: "configurando", pendentes: { bot: { decisaoId: "d1", nome: "Lia", descricao: "Cuida dos clientes", forma: "shape-hex", cor: "c-pink", voz: null }, acesso: null, rotina: null } });
    const r = guia(tela({ dados: d }));
    expect((r.getByLabelText("Nome") as HTMLInputElement).value).toBe("Lia");
    fireEvent.click(r.getByRole("button", { name: "Agora não" }));
    expect(r.executar).toHaveBeenCalledWith("onboarding-recusar-bot", { id: "d1" });
    fireEvent.submit(r.getByLabelText("Nome").closest("form")!);
    expect(r.executar).toHaveBeenLastCalledWith("onboarding-bot-enviar", { nome: "Lia", descricao: "Cuida dos clientes", decisao: "d1" });
  });

  it("passo app: o que pode e o que não, e o botão do login (ou o Permitir da decisão)", () => {
    const d = dados({ etapa: "configurando", passo: "app", bot: { id: "b1", nome: "Lia", conversaId: "cb", forma: "shape-hex", cor: "c-pink" } });
    const r = guia(tela({ dados: d }));
    expect(r.html).toContain("Conectar para o Lia");
    expect(r.html).toContain("Enviar sem a sua aprovação");
    expect(r.cliques()).toContainEqual({ acao: "onboarding-conectar-app", dados: { slug: "gmail" }, rotulo: "Entrar e conectar" });
    expect(guia(tela({ dados: d, appConectando: true })).html).toContain("Esperando o navegador");
    expect(guia(tela({ dados: { ...d, pendentes: { bot: null, acesso: { decisaoId: "a1", app: "gmail", conectar: false }, rotina: null } } })).cliques()).toContainEqual({ acao: "onboarding-permitir-app", dados: { id: "a1" }, rotulo: "Permitir" });
  });

  it("passo rotina: as três opções; a proposta pendente vem destacada", () => {
    const d = dados({ etapa: "configurando", passo: "rotina", appConectado: true, bot: { id: "b1", nome: "Lia", conversaId: "cb", forma: "shape-hex", cor: "c-pink" }, pendentes: { bot: null, acesso: null, rotina: { decisaoId: "r1", resumo: "Todo dia às 9h" } } });
    const cliques = guia(tela({ dados: d })).cliques();
    expect(cliques.filter((c) => c.acao === "onboarding-escolher-rotina").map((c) => c.dados.indice)).toEqual(["0", "1", "2"]);
    expect(cliques).toContainEqual({ acao: "onboarding-criar-rotina-proposta", dados: { id: "r1" }, rotulo: "Criar rotina" });
  });
});
