import { spawn, type ChildProcess } from "node:child_process";
import { powershellDoSistema } from "../executor/plataforma.ts";

/**
 * ADR-197, item 6 (S2), no PC: a pessoa está mexendo no app? Um PowerShell que fica aberto enquanto o motor vive carrega
 * uma vez o `GetForegroundWindow`/`GetWindowThreadProcessId` e o `GetLastInputInfo` do user32 e, a cada linha "?" no
 * stdin, responde uma linha JSON: o caminho do .exe da janela da frente e os segundos sem teclado nem mouse. A resposta
 * fica guardada por 1 s (o bot age em rajadas); falha ou demora = "não sei" (não pausa).
 */
export const SCRIPT_PESSOA_WINDOWS = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class NodPessoa {
  [StructLayout(LayoutKind.Sequential)] public struct LII { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LII l);
}
"@
while ($true) {
  $l = [Console]::In.ReadLine()
  if ($l -eq $null) { break }
  $pid2 = 0; [void][NodPessoa]::GetWindowThreadProcessId([NodPessoa]::GetForegroundWindow(), [ref]$pid2)
  $caminho = ''; try { $caminho = (Get-Process -Id $pid2).Path } catch {}
  $i = New-Object NodPessoa+LII; $i.cbSize = 8; [void][NodPessoa]::GetLastInputInfo([ref]$i)
  $ocioso = [Math]::Floor(([Environment]::TickCount - $i.dwTime) / 1000)
  [Console]::Out.WriteLine((ConvertTo-Json -Compress @{ frente = $caminho; ocioso = $ocioso }))
  [Console]::Out.Flush()
}
`;

export type LeituraPessoa = { frente: string | null; ociosoS: number };

export function lerRespostaPessoa(linha: string): LeituraPessoa | null {
  try {
    const v = JSON.parse(linha) as { frente?: unknown; ocioso?: unknown };
    if (typeof v.ocioso !== "number" || !Number.isFinite(v.ocioso) || v.ocioso < 0) return null;
    return { frente: typeof v.frente === "string" && v.frente ? v.frente : null, ociosoS: v.ocioso };
  } catch { return null; }
}

/** O vigia da pessoa no PC, no formato que o driver usa (`pessoa` de criarSeuComputadorLocal). */
export function criarPessoaWindows(o: { env?: Readonly<Record<string, string | undefined>>; spawnar?: typeof spawn; agora?: () => number } = {}): { naFrente(appId: string): Promise<boolean>; ociosoS(): number; parar(): void } {
  const agora = o.agora ?? (() => Date.now());
  let ps: ChildProcess | null = null;
  let buf = "";
  let espera: ((l: LeituraPessoa | null) => void) | null = null;
  let ultima: { em: number; leitura: LeituraPessoa } | null = null;

  function abrir(): ChildProcess {
    if (ps && ps.exitCode === null) return ps;
    const p = (o.spawnar ?? spawn)(powershellDoSistema(o.env ?? process.env), ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", SCRIPT_PESSOA_WINDOWS], { stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
    p.stdout!.setEncoding("utf8");
    p.stdout!.on("data", (d: string) => {
      buf += d;
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const linha = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        const r = lerRespostaPessoa(linha);
        if (r) ultima = { em: agora(), leitura: r };
        const e = espera; espera = null; e?.(r);
      }
    });
    p.on("exit", () => { if (ps === p) ps = null; const e = espera; espera = null; e?.(null); });
    ps = p;
    return p;
  }

  async function ler(): Promise<LeituraPessoa | null> {
    if (ultima && agora() - ultima.em < 1000) return ultima.leitura;
    if (espera) return ultima?.leitura ?? null;
    const p = abrir();
    return new Promise((resolver) => {
      // A primeira resposta compila o Add-Type (~1–2 s); depois, poucos ms. Sem resposta em 3 s: não sei (não pausa).
      const t = setTimeout(() => { if (espera === resolver) espera = null; resolver(null); }, 3000);
      espera = (r) => { clearTimeout(t); resolver(r); };
      p.stdin!.write("?\n");
    });
  }

  return {
    async naFrente(appId) {
      const r = await ler();
      return !!r?.frente && r.frente.toLowerCase() === appId.toLowerCase();
    },
    // Lido junto com o app da frente (o driver sempre pergunta naFrente primeiro); sem leitura = "parada há muito".
    ociosoS: () => ultima?.leitura.ociosoS ?? Number.POSITIVE_INFINITY,
    parar() { try { ps?.kill(); } catch { /* já saiu */ } ps = null; },
  };
}
