import { criarArquivoDeLog, MAX_BYTES_LOG } from "../desktop/diagnostico.ts";
import type { DestinoDoLog } from "../src/obs/log.ts";
import { pastaDoNodNoWindows } from "./atualizacao-no-windows.ts";

/**
 * QA da rc.13 no Windows (achado 9, #358): o motor do Windows não deixava log em disco. A Tarefa Agendada o sobe com
 * `conhost --headless`, que joga fora o stdout e o stderr, e por isso a troca do motor que nunca rodava (`script_disparado`
 * → `pedido_falhou`) era invisível em campo. O `motor rodar` grava as mesmas linhas do console (já redigidas pelo
 * log()) em `%LOCALAPPDATA%\nod\motor.log`, com a rotação do log do app (diagnostico.ts): passou de 1 MiB vira
 * `motor.1.log`, duas gerações no máximo.
 */
export const ARQUIVO_LOG_DO_MOTOR = "motor.log";

export const destinoDoLogNoWindows = (env: Readonly<Record<string, string | undefined>>, maxBytes = MAX_BYTES_LOG): DestinoDoLog =>
  criarArquivoDeLog({ dir: pastaDoNodNoWindows(env), maxBytes, nome: ARQUIVO_LOG_DO_MOTOR });
