/**
 * ADR-173 (definido em 2026-11-12, frente "Mac e Quick Chat"): o que a janela web do app do Mac ganha para o Quick Chat,
 * a captura de tela e as ferramentas do Mac. Mora fora de desktop.ts pelo teto de 200 linhas. Tudo opcional: o app de
 * antes desta versão não tem, e a web confere antes de chamar.
 */

/** Uma captura de janela ou região, já em base64 (PNG); `erro` quando passou do teto do anexo. */
export type CapturaDesktop = { nome: string; mime: "image/png"; base64: string; largura: number | null; altura: number | null } | { erro: "grande_demais" };

/** O atalho do Quick Chat (accelerator do Electron) ou null (desligado). `em_uso`: outro app já registrou. */
export type ResultadoAtalhoQuickChat = { ok: true; atalho: string | null } | { ok: false; motivo: "invalido" | "em_uso"; atalho: string | null };

/**
 * As famílias de ferramentas do Mac, cada uma com liga/desliga em Ajustes > Computador, DESLIGADAS por padrão (como os
 * gates do Grok Bot). Leitura e envio do Mail e do iMessage são separados: ler não implica poder enviar.
 */
export const FAMILIAS_MAC = ["mail_ler", "mail_enviar", "notas", "calendario", "lembretes", "contatos", "imessage_ler", "imessage_enviar", "controle_tela"] as const;
export type FamiliaMac = (typeof FAMILIAS_MAC)[number];
export type FamiliasMacLigadas = Readonly<Record<FamiliaMac, boolean>>;

export type PonteMacDesktop = {
  /** Abre a captura interativa do macOS (região; Espaço troca para janela). null = cancelou ou não é Mac. */
  capturarTela?(): Promise<CapturaDesktop | null>;
  atalhoQuickChat?(): Promise<string | null>;
  definirAtalhoQuickChat?(atalho: string | null): Promise<ResultadoAtalhoQuickChat>;
  /** O Quick Chat pede para virar a janela grande (o ⤢ do protótipo) ou só se esconder (o ✕ / Esc). */
  quickChatExpandir?(): Promise<void>;
  quickChatEsconder?(): Promise<void>;
  /** O avatar do bot solto na mesa: montar (true = montou), desmontar e, pelo clique nele, abrir o Quick Chat no bot. */
  montarNaMesa?(agenteId: string): Promise<boolean>;
  desmontarDaMesa?(agenteId: string): Promise<void>;
  naMesa?(): Promise<string[]>;
  quickChatAbrir?(agenteId: string): Promise<void>;
  ferramentasMac?(): Promise<FamiliasMacLigadas>;
  definirFerramentaMac?(familia: FamiliaMac, ligada: boolean): Promise<FamiliasMacLigadas>;
};

export const CANAIS_MAC = {
  capturarTela: "nod:capturar-tela",
  atalhoQuickChat: "nod:atalho-quick-chat",
  definirAtalhoQuickChat: "nod:definir-atalho-quick-chat",
  quickChatExpandir: "nod:quick-chat-expandir",
  quickChatEsconder: "nod:quick-chat-esconder",
  montarNaMesa: "nod:montar-na-mesa",
  desmontarDaMesa: "nod:desmontar-da-mesa",
  naMesa: "nod:na-mesa",
  quickChatAbrir: "nod:quick-chat-abrir",
  ferramentasMac: "nod:ferramentas-mac",
  definirFerramentaMac: "nod:definir-ferramenta-mac",
} as const;
