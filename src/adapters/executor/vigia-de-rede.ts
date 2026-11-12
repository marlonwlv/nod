import { networkInterfaces } from "node:os";
import { log } from "../../obs/log.ts";

/**
 * ADR-169 (definido em 2026-11-12): o motor percebe a troca de rede (Wi-Fi → cabo, VPN, IP novo) e renova as esperas
 * longas da ponte na hora, como o daemon do Grok Bot ("watch renewed after a network change"). Sem isso o `puxar` preso
 * num socket da rede velha só caía no prazo de 35 s. Lê `os.networkInterfaces()` a cada 5 s — sem processo, sem rede.
 */
export function assinaturaDaRede(ifs: ReturnType<typeof networkInterfaces>): string {
  const enderecos: string[] = [];
  for (const [nome, lista] of Object.entries(ifs)) for (const e of lista ?? []) if (!e.internal) enderecos.push(`${nome}:${e.address}`);
  return enderecos.sort().join(",");
}

export function vigiarRede(o: { aoMudar: () => void; intervaloMs?: number; ler?: () => ReturnType<typeof networkInterfaces> }): () => void {
  const ler = o.ler ?? networkInterfaces;
  let antes = assinaturaDaRede(ler());
  const timer = setInterval(() => {
    const agora = assinaturaDaRede(ler());
    if (agora === antes) return;
    antes = agora;
    log("info", "rede_mudou", { interfaces: agora.split(",").filter(Boolean).length });
    o.aoMudar();
  }, o.intervaloMs ?? 5000);
  timer.unref?.();
  return () => clearInterval(timer);
}
