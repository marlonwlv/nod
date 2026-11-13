import { ErroApi } from "./erro-api.ts";

/**
 * A decisão pode ter fechado por outra aba, expiração, interrupção ou regra enquanto este navegador ainda desenha o
 * cartão antigo. O 409 só é absorvido depois de o servidor confirmar que ela não está mais aberta; se ainda estiver,
 * continua sendo um erro de verdade e sobe para o aviso da ação.
 */
export async function decidirContraEstadoVelho<T>(
  decidir: () => Promise<T>,
  fechouNoServidor: () => Promise<boolean>,
): Promise<"decidida" | "reconciliada"> {
  try {
    await decidir();
    return "decidida";
  } catch (erro) {
    if (!(erro instanceof ErroApi) || erro.status !== 409 || erro.codigo !== "estado_invalido") throw erro;
    if (!(await fechouNoServidor())) throw erro;
    return "reconciliada";
  }
}
