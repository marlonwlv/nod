import type { DriverCanais, MensagemDeCanal } from "../../../contracts/canais.ts";

/**
 * O driver de teste do conector `canais` (ADR-174): a caixa e o telefone vivem no processo. O que se envia vai para a
 * `saida` (o teste e o e2e leem); a entrada tem duas mensagens fixas, marcadas "(teste)". Sem rede e sem custo.
 */
export function criarDriverCanaisTeste(dominio = "bots.nod.test"): DriverCanais & { saida: MensagemDeCanal[] } {
  let endereco: string | null = null;
  const saida: MensagemDeCanal[] = [];
  const entrada: MensagemDeCanal[] = [
    { id: "email-1", canal: "email", de: "financeiro@exemplo.com", para: [], assunto: "Nota fiscal de outubro (teste)", texto: "Oi! A nota de outubro sai quando? (teste)", em: "2026-11-12T09:00:00Z" },
    { id: "sms-1", canal: "sms", de: "+5511900000000", para: [], texto: "Chego às 8 (teste)", em: "2026-11-12T09:10:00Z" },
  ];
  const agora = () => new Date(Date.UTC(2026, 10, 12, 12, saida.length)).toISOString();
  const achar = (lista: MensagemDeCanal[], busca?: string) => (busca ? lista.filter((m) => `${m.de} ${m.assunto ?? ""} ${m.texto}`.toLowerCase().includes(busca.toLowerCase())) : lista);
  return {
    saida,
    async reivindicarCaixa(a) {
      endereco ??= `${a.nome}@${dominio}`;
      return { endereco };
    },
    async enviarEmail(a) {
      if (!endereco) throw new Error("sem_caixa");
      const id = `enviado-${saida.length + 1}`;
      saida.push({ id, canal: "email", de: endereco, para: [...a.para, ...a.cc], assunto: a.assunto, texto: a.corpo, em: agora() });
      return { id };
    },
    async buscarEmails(a) {
      return achar(entrada.filter((m) => m.canal === "email"), a.busca);
    },
    async lerEmail(a) {
      return entrada.find((m) => m.id === a.id && m.canal === "email") ?? null;
    },
    async enviarIMessage(a) {
      const id = `enviado-${saida.length + 1}`;
      saida.push({ id, canal: "imessage", de: "telefone-teste", para: [a.para], texto: a.texto, em: agora() });
      return { id };
    },
    async enviarSms(a) {
      const id = `enviado-${saida.length + 1}`;
      saida.push({ id, canal: "sms", de: "telefone-teste", para: [a.para], texto: a.texto, em: agora() });
      return { id };
    },
    async buscarMensagens(a) {
      return achar(entrada.filter((m) => m.canal !== "email"), a.busca);
    },
  };
}
