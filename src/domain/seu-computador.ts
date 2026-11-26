import type { AppDoComputador, AppLiberado } from "../contracts/seu-computador.ts";

/**
 * O computador da pessoa (ADR-197): regras puras. Quem nunca entra, o manifesto `bounded` do cua-driver, a escolha de
 * um app pelo nome e o texto do cartão. Nada aqui toca disco, rede ou processo.
 */

export type PlataformaPessoa = "darwin" | "win32";

/**
 * ADR-197, item 7: apps que não entram nem com "Sempre" — ajustes do sistema, gerenciadores de senha, terminais e o
 * próprio nod. No Mac pelo bundle id; no Windows pelo nome do executável (sem diferenciar maiúsculas).
 */
export const BLOQUEADOS_MAC: readonly string[] = [
  "com.apple.systempreferences", "com.apple.SystemSettings", "com.apple.settings.PrivacySecurity.extension",
  "com.apple.keychainaccess", "com.apple.Passwords", "com.apple.SecurityAgent", "com.apple.LocalAuthentication.UIAgent",
  "com.1password.1password", "com.agilebits.onepassword7", "com.agilebits.onepassword-osx", "com.bitwarden.desktop", "org.keepassxc.keepassxc", "com.lastpass.LastPass", "com.dashlane.dashlanephonefinal",
  "com.apple.Terminal", "com.googlecode.iterm2", "dev.warp.Warp-Stable", "com.mitchellh.ghostty", "net.kovidgoyal.kitty", "io.alacritty", "co.zeit.hyper", "com.github.wez.wezterm",
  "com.apple.ScriptEditor2", "com.apple.Automator", "com.apple.ActivityMonitor", "com.apple.DiskUtility", "com.apple.MigrateAssistant",
  "app.nod.desktop",
];
export const BLOQUEADOS_WINDOWS: readonly string[] = [
  "systemsettings.exe", "control.exe", "mmc.exe", "regedit.exe", "taskmgr.exe", "consent.exe", "credentialuibroker.exe", "lockapp.exe",
  "cmd.exe", "powershell.exe", "pwsh.exe", "windowsterminal.exe", "wt.exe", "conhost.exe", "openconsole.exe", "wsl.exe", "bash.exe",
  "1password.exe", "bitwarden.exe", "keepass.exe", "keepassxc.exe", "lastpass.exe", "dashlane.exe",
  "nod.exe", "nod-motor.exe",
];

const baseWindows = (id: string) => id.replace(/\//g, "\\").split("\\").pop()!.toLowerCase();

/** O app nunca entra (nem com "Sempre"): null = pode; texto = por quê (vai ao bot e à pessoa). */
export function motivoDoBloqueio(app: AppDoComputador, plataforma: PlataformaPessoa): string | null {
  const bloqueado = plataforma === "darwin" ? BLOQUEADOS_MAC.includes(app.id) : BLOQUEADOS_WINDOWS.includes(baseWindows(app.id));
  if (!bloqueado) return null;
  return "Este app fica de fora do nod (senhas, ajustes do sistema, terminal ou o próprio nod). Peça para a pessoa fazer esta parte.";
}

/** O id do app no formato do sistema: bundle id (Mac) ou caminho absoluto de .exe (Windows). */
export function idDeAppValido(id: string, plataforma: PlataformaPessoa): boolean {
  if (typeof id !== "string" || id.length < 3 || id.length > 400 || /\p{Cc}/u.test(id)) return false;
  if (plataforma === "darwin") return /^[A-Za-z0-9][A-Za-z0-9.-]*[A-Za-z0-9]$/.test(id);
  return /^[A-Za-z]:\\.+\.exe$/i.test(id) && !id.includes("..");
}

/** O mesmo app? No Windows o caminho do .exe não diferencia maiúsculas (`System32` = `system32`). */
export function mesmoApp(a: string, b: string, plataforma: PlataformaPessoa): boolean {
  return plataforma === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** Os liberados que ainda valem agora ("Sempre" e os "desta vez" no prazo), sem repetir o mesmo app. */
export function liberadosAgora(lista: readonly AppLiberado[], agora: number): AppDoComputador[] {
  const vistos = new Set<string>();
  const saem: AppDoComputador[] = [];
  for (const a of lista) {
    if (a.ate !== null && a.ate <= agora) continue;
    if (vistos.has(a.id)) continue;
    vistos.add(a.id);
    saem.push({ id: a.id, nome: a.nome });
  }
  return saem;
}

const yamlTexto = (s: string) => JSON.stringify(s);

/**
 * O manifesto `bounded` (versão 3) do cua-driver para estes apps: nada fora deles, sem captura da tela inteira
 * (`desktop.display: false`), o driver só fecha o que ele mesmo abriu. ADR-197, item 3: nunca `unrestricted`.
 */
export const FERRAMENTAS_DO_DRIVER = [
  "start_session", "end_session", "launch_app", "list_windows", "get_window_state", "click", "double_click", "right_click",
  "type_text", "press_key", "hotkey", "scroll", "drag", "invoke_menu", "set_value", "zoom", "check_permissions",
] as const;

export function manifestoBounded(apps: readonly AppDoComputador[], plataforma: PlataformaPessoa): string {
  const linhas = [
    "version: 3",
    "expires_after: 8h",
    "idle_timeout: 30m",
    "allow:",
    "  tools:",
    ...FERRAMENTAS_DO_DRIVER.map((t) => `    - ${t}`),
    "resources:",
  ];
  const validos = apps.filter((a) => idDeAppValido(a.id, plataforma) && motivoDoBloqueio(a, plataforma) === null);
  if (validos.length === 0) linhas.push("  apps: []");
  else {
    linhas.push("  apps:");
    for (const a of validos) {
      linhas.push(plataforma === "darwin" ? `    - bundle_id: ${yamlTexto(a.id)}` : `    - executable: ${yamlTexto(a.id)}`);
      linhas.push("      launch: true", "      windows: all", "      terminate: driver_launched");
    }
  }
  linhas.push("  desktop:", "    display: false", "");
  return linhas.join("\n");
}

const normalizar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\.(app|exe)$/, "").replace(/[^a-z0-9]+/g, " ").trim();

/**
 * O app que a pessoa (ou o bot) disse pelo nome: igual ao nome, igual ao id, depois começo e trecho. Vários iguais: o
 * aberto ganha. Sem nenhum: os parecidos (até 5) para o bot perguntar ou tentar de novo.
 */
export function acharApp<A extends AppDoComputador & { aberto?: boolean; apelido?: string }>(apps: readonly A[], pedido: string): { app: A } | { parecidos: string[] } {
  const p = normalizar(pedido);
  if (!p) return { parecidos: [] };
  const nomes = (a: A) => [normalizar(a.nome), ...(a.apelido ? [normalizar(a.apelido)] : [])];
  const ordenar = (xs: A[]) => [...xs].sort((a, b) => Number(b.aberto === true) - Number(a.aberto === true) || a.nome.length - b.nome.length);
  const exato = apps.filter((a) => nomes(a).includes(p) || a.id.toLowerCase() === pedido.trim().toLowerCase());
  if (exato.length) return { app: ordenar(exato)[0]! };
  const comeca = apps.filter((a) => nomes(a).some((n) => n.startsWith(p) || (p.startsWith(n) && n.length >= 4)));
  if (comeca.length === 1) return { app: comeca[0]! };
  const contem = apps.filter((a) => nomes(a).some((n) => n.includes(p)));
  if (!comeca.length && contem.length === 1) return { app: contem[0]! };
  const parecidos = ordenar([...comeca, ...contem]).map((a) => a.nome);
  return { parecidos: [...new Set(parecidos)].slice(0, 5) };
}

/** "seu Mac" / "seu PC": o nome do aparelho para a pessoa (como `textosDoAparelho` do navegador). */
export function nomeDoAparelho(plataforma: PlataformaPessoa | "linux" | string): "Mac" | "PC" {
  return plataforma === "win32" ? "PC" : "Mac";
}

/** O texto do cartão (ADR-197, item 4): montado aqui, com o nome do app vindo do sistema e o motivo cortado. */
export function textoDoPedido(p: { bot: string; app: string; motivo: string | null; plataforma: PlataformaPessoa }): { titulo: string; texto: string; sim: string; sempre: string; nao: string } {
  const aparelho = nomeDoAparelho(p.plataforma);
  const motivo = p.motivo ? p.motivo.replace(/\s+/g, " ").trim().slice(0, 160) : "";
  return {
    titulo: `${p.bot.slice(0, 60)} quer usar seu ${aparelho}`,
    texto: motivo ? `Só o ${p.app} · ${motivo}` : `Só o ${p.app}`,
    sim: "Permitir desta vez",
    sempre: `Sempre no ${p.app}`,
    nao: "Agora não",
  };
}
