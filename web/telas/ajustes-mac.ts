import type { FamiliaMac, FamiliasMacLigadas } from "../../src/contracts/desktop-mac.ts";
import { grupoConfig, linhaConfig } from "../lib/linha-config.ts";
import { esc } from "../lib/render.ts";

/**
 * ADR-171 (definido em 2026-11-12): Configurações › Máquinas, só no app do Mac (a ponte tem `ferramentasMac`). Dois
 * blocos, no desenho do Grok Bot (Settings › Computer e o "Chat rápido" de Geral):
 *
 * - **Quick Chat**: o atalho global, com Gravar/Desligar e a recusa ("Outro app já usa esse atalho").
 * - **Ferramentas do Mac**: um switch por família, todos DESLIGADOS por padrão. Ligar não aprova nada: cada envio
 *   (Mail, iMessage, nota, evento, lembrete) continua passando pela aprovação do bot.
 *
 * Na web pura, no Windows e na VM Linux a seção não aparece (as famílias não existem lá).
 */
export type AjustesMac = { atalho: string | null; familias: FamiliasMacLigadas; recusaAtalho?: string | null; gravando?: boolean };

export const TEXTO_FAMILIA: Readonly<Record<FamiliaMac, { titulo: string; detalhe: string }>> = {
  mail_ler: { titulo: "Ler o Mail", detalhe: "Os bots leem a caixa de entrada do app Mail deste Mac." },
  mail_enviar: { titulo: "Enviar pelo Mail", detalhe: "Os bots enviam e-mail pela sua conta do Mail. Cada envio pede a sua aprovação." },
  notas: { titulo: "Notas", detalhe: "Ler e criar notas no app Notas. Criar pede aprovação." },
  calendario: { titulo: "Calendário", detalhe: "Ler a agenda e criar eventos no app Calendário. Criar pede aprovação." },
  lembretes: { titulo: "Lembretes", detalhe: "Ler e criar lembretes no app Lembretes. Criar pede aprovação." },
  contatos: { titulo: "Contatos", detalhe: "Buscar nomes, e-mails e telefones no app Contatos." },
  imessage_ler: { titulo: "Ler o iMessage", detalhe: "Os bots leem as mensagens recentes do app Mensagens. Pede Acesso Total ao Disco." },
  imessage_enviar: { titulo: "Enviar iMessage", detalhe: "Os bots mandam iMessage em seu nome. Cada envio pede a sua aprovação." },
  controle_tela: { titulo: "Controlar a tela", detalhe: "Os bots veem a tela, clicam e digitam neste Mac. Cada ação pede a sua aprovação. Pede Acessibilidade e Gravação de Tela." },
};

/** O atalho em teclas do Mac: "Alt+Space" → "⌥ Espaço". */
export function atalhoLegivel(atalho: string | null): string {
  if (!atalho) return "Desligado";
  const nomes: Readonly<Record<string, string>> = { Command: "⌘", CommandOrControl: "⌘", Control: "⌃", Alt: "⌥", Shift: "⇧", Space: "Espaço", Enter: "↩", Tab: "⇥" };
  return atalho.split("+").map((p) => nomes[p] ?? p).join(" ");
}

/** Do teclado ao accelerator do Electron (o processo principal valida de novo). null = só modificador, ainda gravando. */
export function atalhoDoTeclado(ev: { key: string; code: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }): string | null {
  const tecla = ev.code === "Space" ? "Space" : /^Key[A-Z]$/.test(ev.code) ? ev.code.slice(3) : /^Digit\d$/.test(ev.code) ? ev.code.slice(5) : /^F\d{1,2}$/.test(ev.code) ? ev.code : null;
  if (!tecla) return null;
  return [ev.metaKey ? "Command" : "", ev.ctrlKey ? "Control" : "", ev.altKey ? "Alt" : "", ev.shiftKey ? "Shift" : "", tecla].filter(Boolean).join("+");
}

export function htmlAjustesDoMac(a: AjustesMac): string {
  const botoes = a.gravando
    ? `<span class="cfg-atalho-gravando" role="status">Aperte o atalho novo…</span><button type="button" class="bt sm" data-act="cancelar-atalho-quick">Cancelar</button>`
    : `<kbd class="cfg-atalho">${esc(atalhoLegivel(a.atalho))}</kbd><button type="button" class="bt sm" data-act="gravar-atalho-quick">Mudar</button>${a.atalho ? '<button type="button" class="bt sm" data-act="desligar-atalho-quick">Desligar</button>' : ""}`;
  const quick = grupoConfig("Quick Chat", [linhaConfig({
    titulo: "Abrir o Quick Chat com um atalho",
    detalhe: a.recusaAtalho ?? "Uma janela pequena para falar com um bot de qualquer app, com captura de janela ou região.",
    controle: { tipo: "html", html: `<span class="cfg-atalho-linha">${botoes}</span>` },
  })], { id: "quick-chat" });
  const familias = Object.keys(TEXTO_FAMILIA) as FamiliaMac[];
  const ferramentas = grupoConfig("Ferramentas do Mac", familias.map((f) => linhaConfig({
    titulo: TEXTO_FAMILIA[f].titulo,
    detalhe: TEXTO_FAMILIA[f].detalhe,
    controle: { tipo: "switch", ligado: a.familias[f], acao: "alternar-ferramenta-mac", dados: { familia: f } },
  })), { id: "ferramentas-mac" });
  return `<section class="espaco-secao cfg-secao cfg-mac" aria-label="Este Mac">${quick}${ferramentas}<p class="mudo sm">Só valem quando o nod roda neste Mac; numa VM Linux os bots usam o computador deles. O macOS pede a permissão de cada app na primeira vez.</p></section>`;
}
