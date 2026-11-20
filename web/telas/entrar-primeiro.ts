import { esc } from "../lib/render.ts";

/**
 * #81: quem já usa o nod noutro computador e abre o endereço pelo celular ou por outro navegador caía direto num espaço
 * provisório novo, sem conta e sem os bots dele, preso no onboarding. Agora, na primeira visita deste navegador, a web
 * pergunta antes: "Já usa o nod?". Entrando na conta, a sessão é da pessoa e os bots dela aparecem, servidos pelo motor
 * do outro computador (a chave de máquina tem o escopo da pessoa, ADR-031). "Começar sem conta" segue como antes.
 */

/** O que a pessoa escolheu na tela, para depois do espaço provisório (Google, código por e-mail e pareamento pedem sessão). */
export type IntencaoEntrada = "google" | "email" | "parear-entrar" | "sem-conta";

const INTENCOES: readonly IntencaoEntrada[] = ["google", "email", "parear-entrar", "sem-conta"];
export function intencaoDe(valor: string | undefined): IntencaoEntrada | null {
  return INTENCOES.find((i) => i === valor) ?? null;
}

/**
 * A tela aparece só onde o espaço provisório abriria (`abreProvisorio`: web, contas ligadas, sem sair, sem equipe, sem
 * pareamento pendente) e na primeira visita deste navegador (sem o verificador da instalação guardado). Quem já tem um
 * espaço provisório aqui volta a ele, como antes.
 */
export function mostrarEntrarPrimeiro(s: { abreProvisorio: boolean; temVerificador: boolean }): boolean {
  return s.abreProvisorio && !s.temVerificador;
}

/** A etapa do cartão de conta que abre depois do espaço provisório; null = nenhuma (Google vai direto, sem conta segue). */
export function etapaDaIntencao(i: IntencaoEntrada): "email" | "parear-entrar" | null {
  return i === "email" || i === "parear-entrar" ? i : null;
}

const bt = (intencao: IntencaoEntrada, rotulo: string, classe: string, ocupado: boolean) =>
  `<button type="button" class="bt ${classe}" data-act="entrada-primeiro" data-intencao="${intencao}"${ocupado ? " disabled" : ""}>${rotulo}</button>`;

/**
 * A tela "Já usa o nod?" (sem sessão). `formEmailSenha` é o formulário de entrar com e-mail e senha que já existe (o único
 * jeito que não pede sessão); `equipe` é o link do Google da equipe, quando houver.
 */
export function htmlEntrarPrimeiro(v: { google: boolean; codigoPorEmail: boolean; equipe: string | null; formEmailSenha: string; ocupado: boolean; erro: string | null }): string {
  const o = v.ocupado;
  const google = v.google ? bt("google", "Continuar com Google", "pri", o) : "";
  const codigo = v.codigoPorEmail ? bt("email", "Receber um código por e-mail", "", o) : "";
  const equipe = v.equipe ? `<a class="bt cc-link" href="${esc(v.equipe)}">Sou da equipe: entrar com Google</a>` : "";
  const erro = v.erro ? `<p class="cc-erro" role="alert">${esc(v.erro)}</p>` : "";
  return `<section class="tela entrar entrar-primeiro"><h1>nod</h1>
    <div class="cc-cartao" role="group" aria-label="Entrar na sua conta"><h2 class="cc-titulo">Já usa o nod?</h2>
      <p class="cc-texto">Entre na sua conta para ver os seus bots daqui. Eles seguem rodando no computador onde o nod está instalado.</p>${erro}
      <div class="cc-acoes cc-coluna">${google}${codigo}</div>
      <p class="cc-rodape">${bt("parear-entrar", "Tenho um código de outro computador", "cc-link", o)}${equipe}</p>
    </div>
    ${v.formEmailSenha}
    <div class="cc-cartao cc-sem-conta" role="group" aria-label="Começar sem conta"><h2 class="cc-titulo">Primeira vez aqui?</h2>
      <p class="cc-texto">Use sem cadastro. Dá para criar a conta depois, sem perder nada.</p>
      <div class="cc-acoes">${bt("sem-conta", "Começar sem conta", "pri", o)}</div>
    </div>
  </section>`;
}
