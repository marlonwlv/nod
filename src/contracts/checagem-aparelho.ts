/**
 * A checagem de aparelho do teste grátis (ADR-176; Grok Bot: `sand-devicecheck` + detecção de VM). O app do Mac pede um
 * token ao DeviceCheck da Apple (`DCDevice.generateToken`); o servidor do nod pergunta à Apple os dois bits daquele aparelho
 * e marca o bit "já usou o teste". Assim o teste grátis é um por Mac, sem identificar a pessoa. O driver real precisa da
 * chave do DeviceCheck do time da Apple (credencial do Marlon); o de teste vive em memória.
 */
export type BitsDoAparelho = { bit0: boolean; bit1: boolean };

export interface ChecagemDeAparelho {
  /** null = token inválido ou recusado pela Apple. */
  consultar(token: string): Promise<BitsDoAparelho | null>;
  marcar(token: string, bits: BitsDoAparelho): Promise<void>;
}

export type MotivoSemTeste = "aparelho_ja_usou" | "token_invalido" | "maquina_virtual" | "politica_da_empresa";
