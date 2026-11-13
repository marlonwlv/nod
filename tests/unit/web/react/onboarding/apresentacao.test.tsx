import { fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { marcar, novoPreparo } from "../../../../../web/lib/preparo.ts";
import { Apresentacao } from "../../../../../web/react/onboarding/apresentacao.tsx";
import { APPS, PASSOS, andar, apresentacaoInicial, emailDoGoogle, passoAtual, personagemDoPasso, type EstadoApresentacao } from "../../../../../web/telas/apresentacao.ts";
import { desenhar } from "./ajuda.tsx";

/** ADR-174 em React (ADR-179, fase 5): o onboarding em 10 passos — o modelo e o desenho. */
const ctx = { emailGoogle: false, ligacao: true };
const apres = (e: EstadoApresentacao, c = ctx) => desenhar((a) => <Apresentacao e={e} emailGoogle={c.emailGoogle} ligacao={c.ligacao} executar={a.executar} />);

describe("onboarding em 10 passos", () => {
  it("tem os 10 passos do onboarding, na ordem", () => {
    expect(PASSOS).toEqual(["boas-vindas", "conhecer", "computador", "trabalho", "delegar", "funcao", "origem", "apps", "criar", "preparando"]);
  });

  it("cada passo desenha o título, os pontos e a saída certa", () => {
    let e = apresentacaoInicial();
    const r0 = apres(e);
    expect(r0.html).toContain("Sua equipe de bots");
    expect(r0.cliques().map((c) => c.acao)).toEqual(["apres-seguir", "apres-ligacao"]);
    expect(apres(e, { ...ctx, ligacao: false }).html).not.toContain("Prefiro conversar por voz");
    const titulos = ["Este é o nod", "Ele tem o próprio computador", "Dê um trabalho a cada bot", "Passe qualquer tarefa ao seu time", "No que você mais vai trabalhar?", "Como você conheceu o nod?", "Conecte seus apps"];
    for (const titulo of titulos) {
      e = andar(e, 1);
      const r = apres(e);
      expect(r.html, titulo).toContain(titulo);
      expect(r.getByRole("img", { name: `Passo ${e.passo + 1} de 10` })).toBeTruthy();
      expect(r.getByRole("button", { name: "Voltar" })).toBeTruthy();
      r.unmount();
    }
    expect(passoAtual(e)).toBe("apps");
    expect(apres(e).html).toContain("Agora não");
    expect(apres({ ...e, apps: ["gmail"] }).html).toContain(">Conectado<");
    expect(apres(e, { ...ctx, emailGoogle: true }).html).toContain("Sugerido");
  });

  it("função e origem só seguem com uma escolha, mas dá para pular; a escolha vai ao controlador", () => {
    const e = { ...apresentacaoInicial(), passo: PASSOS.indexOf("funcao") };
    const r = apres(e);
    expect((r.container.querySelector(".ap-seguir") as HTMLButtonElement).disabled).toBe(true);
    const cliques = r.cliques();
    expect(cliques).toContainEqual({ acao: "apres-pular", dados: {}, rotulo: "Pular" });
    expect(cliques).toContainEqual({ acao: "apres-escolher", dados: { campo: "funcao", valor: "Vendas" }, rotulo: "Vendas" });
    expect((apres({ ...e, funcao: "Vendas" }).container.querySelector(".ap-seguir") as HTMLButtonElement).disabled).toBe(false);
    expect(personagemDoPasso({ ...e, funcao: "Vendas" })).toBe("comemorando");
  });

  it("← e → andam fora dos campos; → não passa sem a escolha", () => {
    const e = { ...apresentacaoInicial(), passo: PASSOS.indexOf("funcao") };
    const r = apres(e);
    const secao = r.container.querySelector("section")!;
    fireEvent.keyDown(secao, { key: "ArrowRight" });
    expect(r.executar).not.toHaveBeenCalled();
    fireEvent.keyDown(secao, { key: "ArrowLeft" });
    expect(r.executar).toHaveBeenCalledWith("apres-voltar");
  });

  it("chegar ao passo 9 com uma função sugere o nome; o passo 9 cria com cor, forma e a primeira mensagem", () => {
    const e = andar({ ...apresentacaoInicial(), passo: PASSOS.indexOf("apps"), funcao: "Finanças" }, 1);
    expect(passoAtual(e)).toBe("criar");
    expect(e.nome).toBe("Nina");
    const r = apres(e);
    expect(r.getByLabelText("O que Nina deve fazer primeiro?")).toBeTruthy();
    expect(r.html).not.toContain("c-black");
    expect(andar(e, 1).passo).toBe(PASSOS.indexOf("criar"));
    // O nome muda no campo (o placeholder acompanha) e vai ao controlador sem redesenhar o app; Enter cria.
    const nome = r.getByLabelText("Nome do bot");
    fireEvent.change(nome, { target: { value: "Bia" } });
    expect(r.executar).toHaveBeenLastCalledWith("apres-digitar", { campo: "nome", valor: "Bia" });
    expect(r.getByLabelText("O que Bia deve fazer primeiro?")).toBeTruthy();
    fireEvent.keyDown(nome, { key: "Enter" });
    expect(r.executar).toHaveBeenLastCalledWith("apres-criar");
    fireEvent.click(r.getByRole("radio", { name: "Rosa" }));
    expect(r.executar).toHaveBeenLastCalledWith("apres-cor", { cor: "c-pink" });
  });

  it("sem nome, Criar fica desligado", () => {
    const r = apres({ ...apresentacaoInicial(), passo: PASSOS.indexOf("criar") });
    expect((r.getByRole("button", { name: "Criar e mandar" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("o preparo não volta e mostra a barra com %; no erro, as duas saídas", () => {
    const e = { ...apresentacaoInicial(), nome: "Lia", passo: PASSOS.indexOf("preparando"), preparo: marcar(novoPreparo("Lia"), "criado", "feito") };
    expect(andar(e, -1).passo).toBe(e.passo);
    const r = apres(e);
    expect(r.html).toContain("Preparando Lia");
    expect(r.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("25");
    expect(r.queryByRole("button", { name: "Voltar" })).toBeNull();
    // A barra anda sem recriar o personagem (o mesmo nó, só a largura muda).
    const mascote = r.container.querySelector(".cb-preparo-mascote nod-mascote");
    r.rerender(<Apresentacao e={{ ...e, preparo: { ...e.preparo, porcento: 40 } }} emailGoogle={false} ligacao executar={r.executar} />);
    expect(r.container.querySelector(".cb-preparo-mascote nod-mascote")).toBe(mascote);
    expect((r.container.querySelector(".cb-barra-cheia") as HTMLElement).style.width).toBe("40%");
    const erro = apres({ ...e, preparo: { ...e.preparo, erro: "Lia não terminou de se preparar." } });
    expect(erro.cliques().map((c) => c.acao)).toEqual(["apres-tentar", "apres-ver"]);
  });

  it("e-mail do Google sugere Gmail e Agenda", () => {
    expect(emailDoGoogle("ana@gmail.com")).toBe(true);
    expect(emailDoGoogle("ana@empresa.com.br")).toBe(false);
    expect(APPS.map((a) => a.slug)).toEqual(["gmail", "googlecalendar", "slack", "linear"]);
  });
});
