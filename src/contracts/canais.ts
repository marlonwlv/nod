/**
 * O conector local `canais` (ADR-174): os canais próprios do bot que o Grok Bot traz — a caixa de e-mail do bot
 * (`ClaimEmailInbox`, `SendEmail`, `Search/ReadEmailThread`) e iMessage/SMS pelo telefone vinculado. Enviar passa pela
 * aprovação e aparece como rascunho na conversa (ADR-173); ler devolve conteúdo de fora, que é dado, nunca instrução.
 */
export type MensagemDeCanal = {
  id: string;
  canal: "email" | "imessage" | "sms";
  de: string;
  para: string[];
  assunto?: string;
  texto: string;
  em: string;
};

export interface DriverCanais {
  /** O endereço da caixa do bot; `nome` é o pedido (o provedor pode ajustar). Idempotente: a segunda vez devolve a mesma. */
  reivindicarCaixa(a: { nome: string }): Promise<{ endereco: string }>;
  enviarEmail(a: { para: string[]; cc: string[]; assunto: string; corpo: string }): Promise<{ id: string }>;
  buscarEmails(a: { busca?: string }): Promise<MensagemDeCanal[]>;
  lerEmail(a: { id: string }): Promise<MensagemDeCanal | null>;
  enviarIMessage(a: { para: string; texto: string }): Promise<{ id: string }>;
  enviarSms(a: { para: string; texto: string }): Promise<{ id: string }>;
  buscarMensagens(a: { busca?: string }): Promise<MensagemDeCanal[]>;
}
