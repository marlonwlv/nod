import type { DriverCanais } from "../../../contracts/canais.ts";
import { CAPACIDADES_CANAIS, validarArgsCanais } from "../../../domain/canais.ts";
import { ehPontoDeEntrada } from "../../../shared/entrada.ts";
import { criarServidorMcpSimples, type ResultadoMcp, type ServidorMcpSimples } from "../mcp-simples.ts";
import { criarDriverCanaisTeste } from "./driver-teste.ts";

/**
 * Servidor MCP stdio do conector local `canais` (ADR-174): a caixa de e-mail do bot e iMessage/SMS. O driver vem do
 * ambiente: `NOD_CANAIS_REAL=1` pede o real, que ainda não tem provedor (O que faltou: o domínio de e-mail do nod e o
 * telefone vinculado pelo Mac) — sem driver, tools/list volta vazio; sem a variável, o driver de teste.
 */
const json = (v: unknown): ResultadoMcp => ({ ok: true, texto: JSON.stringify(v) });

export function criarServidorCanais(driver: DriverCanais | null): ServidorMcpSimples {
  async function executar(nome: string, bruto: Record<string, unknown>): Promise<ResultadoMcp> {
    if (!driver) return { ok: false, motivo: "conector sem provedor configurado" };
    const v = validarArgsCanais(nome, bruto);
    if (!v.ok) return { ok: false, motivo: v.motivo };
    const a = v.valor;
    try {
      switch (a.nome) {
        case "reivindicar_caixa": return json(await driver.reivindicarCaixa({ nome: a.caixa }));
        case "enviar_email": return json({ enviado: true, ...(await driver.enviarEmail(a)) });
        case "buscar_emails": return json({ emails: await driver.buscarEmails(a) });
        case "ler_email": {
          const m = await driver.lerEmail(a);
          return m ? json(m) : { ok: false, motivo: "e-mail não encontrado; use um id de buscar_emails" };
        }
        case "enviar_imessage": return json({ enviado: true, ...(await driver.enviarIMessage(a)) });
        case "enviar_sms": return json({ enviado: true, ...(await driver.enviarSms(a)) });
        case "buscar_mensagens": return json({ mensagens: await driver.buscarMensagens(a) });
      }
    } catch (e) {
      if (e instanceof Error && e.message === "sem_caixa") return { ok: false, motivo: "o bot ainda não tem caixa de e-mail; chame reivindicar_caixa antes" };
      throw e;
    }
  }
  return criarServidorMcpSimples({ nome: "nod-canais", ferramentas: driver ? CAPACIDADES_CANAIS : [], executar });
}

export function driverDoAmbiente(env: Readonly<Record<string, string | undefined>>): DriverCanais | null {
  return env.NOD_CANAIS_REAL === "1" ? null : criarDriverCanaisTeste();
}

export async function main(env: Readonly<Record<string, string | undefined>> = process.env): Promise<void> {
  await criarServidorCanais(driverDoAmbiente(env)).ligar(process.stdin, process.stdout);
}

if (ehPontoDeEntrada(import.meta.url)) {
  void main().then(() => process.exit(0));
}
