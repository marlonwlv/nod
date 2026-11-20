import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { WorkspacePreparado } from "../../contracts/workspace.ts";
import { ErroDeDominio } from "../../domain/erro.ts";
import { ORCAMENTO_RESULTADO_CHARS } from "../../shared/constantes.ts";

/**
 * definido em 2026-11-18: duas páginas do proxy mantêm a memória limitada e deixam `ler_mais` entregar
 * saídas maiores que uma página. O teto antigo de 5.000 caracteres descartava o começo antes do proxy.
 */
export const LIMITE_SAIDA_TERMINAL_CHARS = ORCAMENTO_RESULTADO_CHARS * 2;

export function limitarSaidaTerminal(saida: string): { saida: string; truncado: boolean } {
  if (JSON.stringify(saida).length <= LIMITE_SAIDA_TERMINAL_CHARS) return { saida, truncado: false };
  let mantida = saida.slice(-LIMITE_SAIDA_TERMINAL_CHARS);
  while (JSON.stringify(mantida).length > LIMITE_SAIDA_TERMINAL_CHARS) mantida = mantida.slice(Math.ceil(mantida.length / 8));
  return { saida: mantida, truncado: true };
}

/** definido em 2026-09-18: comandos não recebem ambiente/credenciais do host e não têm fallback sem isolamento. */
export function executarNoWorkspace(w: WorkspacePreparado, comando: string, sinal: AbortSignal, imagem = "nod-computador:1"): Promise<{ saida: string; codigoSaida: number; truncado: boolean }> {
  if (!comando.trim() || comando.length > 8000 || /[\0\r\n,]/.test(w.caminho) || (w.git && /[\0\r\n,]/.test(w.git.diretorioComum))) throw new ErroDeDominio("entrada_invalida");
  if (sinal.aborted) throw new ErroDeDominio("nao_permitido");
  const nome = `nod-workspace-job-${randomUUID()}`;
  const args = ["run", "--pull", "never", "--rm", "--name", nome, "--network", "none", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--read-only", "--memory", "1g", "--pids-limit", "128", "--cpus", "2", "--user", `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`, "--tmpfs", "/tmp:rw,nosuid,size=256m", "--mount", `type=bind,source=${w.caminho},target=${w.caminho}`, "--workdir", w.caminho, "--env", "HOME=/tmp", "--env", "HTTP_PROXY=", "--env", "HTTPS_PROXY=", "--env", "http_proxy=", "--env", "https_proxy=", "--entrypoint", "/bin/bash"];
  if (w.git && w.modo === "worktree") args.push("--mount", `type=bind,source=${w.git.diretorioComum},target=${w.git.diretorioComum},readonly`);
  args.push(imagem, "-c", comando);
  return new Promise((ok, falha) => {
    const p = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
    let saida = "";
    let truncado = false;
    let interrompido = false;
    const coletar = (b: Buffer) => {
      saida += b.toString();
      // O dobro evita crescimento sem limite entre eventos; o ajuste exato para JSON acontece no fechamento.
      if (saida.length > LIMITE_SAIDA_TERMINAL_CHARS * 2) {
        saida = saida.slice(-LIMITE_SAIDA_TERMINAL_CHARS * 2);
        truncado = true;
      }
    };
    const cancelar = () => {
      interrompido = true;
      const limpeza = spawn("docker", ["rm", "-f", nome], { stdio: "ignore" });
      limpeza.on("error", () => undefined);
      p.kill("SIGTERM");
    };
    const timer = setTimeout(cancelar, 60_000);
    sinal.addEventListener("abort", cancelar, { once: true });
    p.stdout.on("data", coletar); p.stderr.on("data", coletar);
    const limpar = () => { clearTimeout(timer); sinal.removeEventListener("abort", cancelar); };
    p.on("error", () => { limpar(); falha(new ErroDeDominio("executor_indisponivel")); });
    p.on("close", code => {
      limpar();
      const limitada = limitarSaidaTerminal(saida);
      saida = limitada.saida;
      truncado ||= limitada.truncado;
      const fim = () => ok({ saida: interrompido ? "Comando interrompido ou prazo de 60 segundos atingido." : saida, codigoSaida: interrompido ? 124 : code ?? 1, truncado });
      if (!interrompido) { fim(); return; }
      // definido em 2026-09-18: repetir remoção após o cliente encerrar cobre cancelamento durante a criação.
      const limpeza = spawn("docker", ["rm", "-f", nome], { stdio: "ignore" });
      const teto = setTimeout(() => limpeza.kill("SIGKILL"), 5000);
      limpeza.on("error", () => { clearTimeout(teto); fim(); });
      limpeza.on("close", () => { clearTimeout(teto); fim(); });
    });
  });
}
