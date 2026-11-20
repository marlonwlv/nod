import { FalhaNavegador, SELETOR_CAMPO, type MotorNavegador, type SessaoNavegador } from "./motor-agent-browser.ts";

/**
 * Preencher um login no navegador do bot (ADR-190, decisão 6; L3), do mesmo jeito no servidor e na máquina da pessoa:
 * acha os campos da página (`camposDeLogin`), põe o usuário por `fill` (não é segredo) e a senha como digitação pelo
 * relay (`inserirTexto`), depois de limpar o campo. A senha nunca vai a argv, log, trilha, conversa ou modelo, e esta
 * função não a devolve nem a guarda.
 *
 * Página só com o usuário (login em duas etapas): preenche o usuário e diz `senha: false`; quem chamou avisa o bot.
 * Nunca clica em Entrar: o bot clica depois que o pedido fecha.
 */
export type ResultadoPreencher = { usuario: boolean; senha: boolean };

export async function preencherLogin(m: MotorNavegador, s: SessaoNavegador, c: { usuario: string; senha: string }): Promise<ResultadoPreencher> {
  const campos = await m.camposDeLogin(s);
  if (!campos.senha && !campos.usuario) throw new FalhaNavegador("alvo_invalido", "não achei o campo de login nesta página");
  const usuario = campos.usuario && c.usuario !== "";
  if (usuario) await m.preencher(s, SELETOR_CAMPO.usuario, c.usuario);
  if (!campos.senha) return { usuario, senha: false };
  await m.preencher(s, SELETOR_CAMPO.senha, "");
  await m.inserirTexto(s, SELETOR_CAMPO.senha, c.senha);
  return { usuario, senha: true };
}

/** L4: o código de uso único no campo de código da página, ou no campo focado quando a página não tem um claro. */
export async function inserirCodigo(m: MotorNavegador, s: SessaoNavegador, codigo: string): Promise<void> {
  const campos = await m.camposDeLogin(s);
  if (campos.codigo) {
    await m.preencher(s, SELETOR_CAMPO.codigo, "");
    await m.inserirTexto(s, SELETOR_CAMPO.codigo, codigo);
    return;
  }
  await m.inserirTexto(s, null, codigo);
}
