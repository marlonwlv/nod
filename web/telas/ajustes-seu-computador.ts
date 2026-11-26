import type { RespostaSeuComputadorTela } from "../../src/contracts/seu-computador.ts";
import { grupoConfig, linhaConfig } from "../lib/linha-config.ts";
import { esc } from "../lib/render.ts";

/**
 * Ajustes › Máquinas › "Seu Mac" (ADR-197, item 4 e 5; Paper "Seu computador", S1 painel e S5): o aparelho da pessoa
 * que atende agora, as duas permissões do macOS (só no app do Mac, que sabe ler e abrir o Ajuste certo) e os apps que
 * cada bot pode usar, com "Tirar" (um app) e "Tirar tudo". Liberar é sempre pelo cartão do bot: aqui só se tira.
 */
export type PermissoesDoMac = { acessibilidade: boolean; gravacaoDeTela: boolean };

const quando = (ms: number) => new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

export function htmlAjustesSeuComputador(p: { dados: RespostaSeuComputadorTela | null; permissoes: PermissoesDoMac | null; bots: readonly { id: string; nome: string }[] }): string {
  const d = p.dados;
  const aparelho = d?.aparelho;
  const nomeAparelho = aparelho?.plataforma === "win32" ? "PC" : "Mac";
  const linhas: string[] = [linhaConfig({
    titulo: aparelho ? `${aparelho.nome} está pronto` : "Nenhum Mac ou PC com o nod aberto",
    detalhe: aparelho
      ? `Os bots usam os apps deste ${nomeAparelho} quando você pede na conversa. Na primeira vez com cada app, o bot pede num cartão; você vê tudo numa ilha no topo da tela, com Parar.`
      : "Abra o app do nod no seu Mac ou PC (versão nova) para os bots poderem usar os apps de lá.",
    status: aparelho ? { texto: "Conectado", tom: "ok" } : { texto: "Desligado", tom: "neutro" },
  })];
  if (p.permissoes) {
    const linhaPerm = (titulo: string, detalhe: string, ok: boolean, qual: "acessibilidade" | "gravacao_de_tela") => linhaConfig({
      titulo, detalhe,
      ...(ok ? { status: { texto: "Ligada", tom: "ok" as const } } : { controle: { tipo: "html" as const, html: `<button type="button" class="bt sm pri" data-act="sc-permissao" data-qual="${qual}">Abrir Ajustes do Sistema</button>` } }),
    });
    linhas.push(linhaPerm("Acessibilidade", "Para clicar e digitar nos apps, sem mexer no seu mouse.", p.permissoes.acessibilidade, "acessibilidade"));
    linhas.push(linhaPerm("Gravação de Tela", "Para o bot ver a janela do app que ele está usando.", p.permissoes.gravacaoDeTela, "gravacao_de_tela"));
  }
  const nomeDo = (id: string) => p.bots.find((b) => b.id === id)?.nome ?? "Bot";
  const apps = d?.apps ?? [];
  const linhasApps = apps.map((a) => linhaConfig({
    titulo: a.nome,
    detalhe: `${nomeDo(a.agenteId)} · ${a.sempre ? "Sempre" : a.ate ? `até ${quando(a.ate)}` : "desta vez"} · ${a.plataforma === "win32" ? "PC" : "Mac"}`,
    controle: { tipo: "html", html: `<button type="button" class="bt sm" data-act="sc-tirar" data-agente="${esc(a.agenteId)}" data-app="${esc(a.id)}" aria-label="${esc(`Tirar o ${a.nome} de ${nomeDo(a.agenteId)}`)}">Tirar</button>` },
  }));
  if (linhasApps.length > 1) linhasApps.push(linhaConfig({ titulo: "Tirar tudo", detalhe: "Os bots voltam a pedir na conversa na próxima vez.", perigo: true, controle: { tipo: "link", acao: "sc-tirar-tudo" } }));
  const grupoApps = grupoConfig("Apps que os bots podem usar", linhasApps, {
    contagem: apps.length,
    nota: `${apps.length ? "" : "Nenhum ainda. Quando um bot precisar de um app, ele pede na conversa. "}Senhas, Ajustes do Sistema, gerenciadores de senha, Terminal e o próprio nod ficam sempre de fora.`,
    id: "seu-computador-apps",
  });
  return `<section class="espaco-secao cfg-secao cfg-seu-computador" aria-label="Seu ${nomeAparelho}">${grupoConfig(`Seu ${nomeAparelho}`, linhas, { id: "seu-computador" })}${grupoApps}</section>`;
}
