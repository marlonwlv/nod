import { readFile } from "node:fs/promises";
import { lerPoliticaMdm, type PoliticaMdm } from "../src/domain/mdm.ts";

/**
 * A política do MDM no Mac (ADR-178), atrás de `NOD_MDM=1`. Lê os user defaults gerenciados do app
 * (`defaults read <bundle> DeploymentBackendUrl` — o perfil de configuração do MDM os grava em
 * /Library/Managed Preferences) e o `policy.json` em /Library/Application Support/nod/. A decisão do que vale é de
 * `lerPoliticaMdm` (só origem https). Sem Electron: o executor de comando e a leitura de arquivo são injetados (teste).
 */
export const CAMINHO_POLICY = "/Library/Application Support/nod/policy.json";
const CHAVES = ["DeploymentBackendUrl", "DeploymentWebsiteUrl"] as const;

export type ExecutarComando = (cmd: string, args: readonly string[]) => Promise<{ codigo: number; saida: string }>;

export async function lerMdmDoMac(o: { bundleId: string; ligado: boolean; executar: ExecutarComando; ler?: (caminho: string) => Promise<string> }): Promise<{ politica: PoliticaMdm; erros: string[] } | null> {
  if (!o.ligado) return null;
  const defaults: Record<string, unknown> = {};
  for (const chave of CHAVES) {
    const r = await o.executar("/usr/bin/defaults", ["read", o.bundleId, chave]);
    if (r.codigo === 0 && r.saida.trim()) defaults[chave] = r.saida.trim();
  }
  let policyJson: unknown = null;
  try {
    policyJson = JSON.parse(await (o.ler ?? ((c) => readFile(c, "utf8")))(CAMINHO_POLICY));
  } catch (e) {
    // Sem arquivo é o normal (Mac sem MDM); arquivo que não é JSON é erro escrito, e o app segue com o padrão.
    if (!(e instanceof Error && "code" in e && e.code === "ENOENT")) return { ...lerPoliticaMdm({ defaults, policyJson: null }), erros: ["policy.json: não é JSON válido"] };
  }
  return lerPoliticaMdm({ defaults, policyJson });
}
