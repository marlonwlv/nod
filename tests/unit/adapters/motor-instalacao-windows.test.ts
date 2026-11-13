import { describe, expect, it } from "vitest";
import { ARQUIVOS_DO_MOTOR } from "../../../src/domain/atualizacao-do-motor.ts";
import { PISO_CLI } from "../../../src/adapters/executor/flag-floors.ts";
import { NODE_DO_MOTOR } from "../../../src/adapters/http/motor-instalacao.ts";
import { SHA256_SHASUMS_DO_NODE, scriptDeInstalacaoWindows, servidorDoWindowsValido, TAREFA_DO_MOTOR_WINDOWS } from "../../../src/adapters/http/motor-instalacao-windows.ts";
import { caminhosNoWindows, IAS_DO_NPM, lerMarcaDasIas } from "../../../motor/desinstalar.ts";

/** ADR-151 (ADA-32): o PowerShell que `irm https://<nod>/windows | iex` roda. */
describe("script de instalação do motor no Windows (ADR-151)", () => {
  const base = { servidor: "https://app.nodbot.ai", versao: "0.9.1+abc" };
  const script = scriptDeInstalacaoWindows(base);
  const convite = "Ab_-".repeat(8);

  it("embute servidor, versão, Node fixo, pisos das IAs e os arquivos do motor, todos entre aspas simples", () => {
    expect(script).toContain("$NodServidor = 'https://app.nodbot.ai'");
    expect(script).toContain("$NodVersao = '0.9.1+abc'");
    expect(script).toContain(`$NodeVersao = '${NODE_DO_MOTOR}'`);
    expect(script).toContain(`$PisoClaude = '${PISO_CLI["claude-cli"]}'`);
    expect(script).toContain(`$PisoCodex = '${PISO_CLI["codex-cli"]}'`);
    expect(script).toContain(`$ArquivosDoMotor = @(${ARQUIVOS_DO_MOTOR.map((a) => `'${a}'`).join(", ")})`);
    expect(script).toContain(`return '${TAREFA_DO_MOTOR_WINDOWS}-' + $Sid`);
  });

  it("o nome da tarefa sai do SID do usuário, depois da checagem de Windows (no Linux o WindowsIdentity lança)", () => {
    const atribuicao = "$NomeDaTarefa = NomeDaTarefaDe ([Security.Principal.WindowsIdentity]::GetCurrent().User.Value)";
    expect(script).toContain(atribuicao);
    expect(script.indexOf(atribuicao)).toBeGreaterThan(script.indexOf("$env:OS -ne 'Windows_NT'"));
    expect(script.indexOf(atribuicao)).toBeGreaterThan(script.indexOf("function NomeDaTarefaDe"));
    expect(script).not.toContain(`$NomeDaTarefa = '${TAREFA_DO_MOTOR_WINDOWS}'`);
  });

  it("recusa servidor que não é HTTPS (fora do loopback) e versão com aspas, $ ou espaço", () => {
    for (const servidor of ["http://app.nodbot.ai", "https://app.nodbot.ai/'x", "https://a.b;rm", "ftp://a.b", "https://A.B", ""]) {
      expect(() => scriptDeInstalacaoWindows({ ...base, servidor }), servidor).toThrow("servidor_ou_versao_invalida");
    }
    for (const versao of ["1.0'", "1.0$x", "1 0", "", "1.0`"]) {
      expect(() => scriptDeInstalacaoWindows({ ...base, versao }), versao).toThrow("servidor_ou_versao_invalida");
    }
    expect(servidorDoWindowsValido("http://127.0.0.1:4321")).toBe(true);
    expect(servidorDoWindowsValido("http://localhost:80")).toBe(true);
    expect(servidorDoWindowsValido("http://10.0.0.1")).toBe(false);
    expect(servidorDoWindowsValido("https://nod.exemplo.com:8443")).toBe(true);
  });

  it("o convite válido vai ao parear; o inválido vira vazio", () => {
    expect(scriptDeInstalacaoWindows({ ...base, convite })).toContain(`$NodConvite = '${convite}'`);
    expect(scriptDeInstalacaoWindows({ ...base, convite: "curto'; calc" })).toContain("$NodConvite = ''");
    expect(script).toContain("$NodConvite = ''");
    expect(script).toMatch(/\$argumentos = @\(\$MotorMjs, 'parear', \$NodServidor, '--abrir'\)/);
    expect(script).toContain("$argumentos += @('--convite', $NodConvite)");
  });

  it("tudo num bloco & { … } invocado no fim, sem exit nem Invoke-Expression", () => {
    const linhas = script.trimEnd().split("\n").filter((l) => !l.startsWith("#"));
    expect(linhas[0]).toBe("& {");
    expect(linhas.at(-1)).toBe("}");
    expect(script).not.toMatch(/^\s*exit\b/im);
    expect(script).not.toMatch(/\bexit\s+\d/i);
    expect(linhas.join("\n")).not.toMatch(/Invoke-Expression|\biex\b/i);
  });

  it("confere o sha256 do Node e de cada arquivo do motor antes de trocar", () => {
    expect(script).toContain("SHASUMS256.txt");
    expect(SHA256_SHASUMS_DO_NODE).toBe("be0629ee2bcd8e40bb856abdd3407f0762101b76bd60a36b8867f637733631c0");
    expect(script).toContain(`$Sha256SomasNode = '${SHA256_SHASUMS_DO_NODE}'`);
    expect(script).toContain("if ((Sha256 $somas) -ne $Sha256SomasNode)");
    expect(script.indexOf("(Sha256 $somas)")).toBeLessThan(script.indexOf("Get-Content -LiteralPath $somas"));
    expect(script).toMatch(/\(Sha256 \$zip\) -ne/);
    expect(script).toMatch(/\(Sha256 \$destino\) -ne \$esperado/);
    expect(script.indexOf("(Sha256 $destino)")).toBeLessThan(script.indexOf("Trocar $novo $App"));
  });

  it("NOD_INSTALAR_ATE=pareamento para antes de parear e de subir o motor; a conexão existente pula o pareamento", () => {
    const corte = script.indexOf("$env:NOD_INSTALAR_ATE -eq 'pareamento'");
    expect(corte).toBeGreaterThan(script.indexOf("    RegistrarInicio"));
    expect(corte).toBeLessThan(script.indexOf("if ((Parear) -ne 0)"));
    expect(corte).toBeLessThan(script.indexOf("if (Test-Path -LiteralPath $Conexao) {\n    IniciarMotor"));
    expect(script.indexOf("if (Test-Path -LiteralPath $Conexao) {\n    IniciarMotor")).toBeLessThan(script.indexOf("if ((Parear) -ne 0)"));
    // a conexão nunca é apagada nem escrita pelo instalador
    expect(script).not.toMatch(/(Remove-Item|Remover|Set-Content|Out-File)[^\n]*\$Conexao/);
  });

  it("a Tarefa Agendada é do próprio usuário, sem admin, recriada com -Force; sem ela, a chave Run", () => {
    expect(script).toMatch(/Register-ScheduledTask [^\n]*-Force/);
    expect(script).toContain("-RunLevel Limited");
    expect(script).toContain("-LogonType Interactive");
    expect(script).toContain("-ExecutionTimeLimit ([TimeSpan]::Zero)");
    expect(script).toContain("-RestartInterval (New-TimeSpan -Minutes 1) -RestartCount 999");
    expect(script).toContain("HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run");
    expect(script).not.toMatch(/-RunLevel Highest|RunAs/);
  });

  it("remove a tarefa e a chave Run antigas sem SID depois de registrar o início novo", () => {
    expect(script).toContain(`Unregister-ScheduledTask -TaskName '${TAREFA_DO_MOTOR_WINDOWS}' -TaskPath '\\'`);
    expect(script).toContain(`Remove-ItemProperty -Path $ChaveRun -Name '${TAREFA_DO_MOTOR_WINDOWS}'`);
  });

  it("recusa ConstrainedLanguage antes de usar tipos .NET e impede duas instalações simultâneas", () => {
    const guarda = script.indexOf("LanguageMode -ne 'FullLanguage'");
    expect(guarda).toBeGreaterThan(0);
    expect(guarda).toBeLessThan(script.indexOf("[Security.Principal.WindowsIdentity]"));
    expect(guarda).toBeLessThan(script.indexOf("[guid]::NewGuid"));
    expect(script).toContain("New-Object Threading.Mutex($false, 'Local\\nod-motor-instalador')");
    expect(script).toContain("if (-not $Trava.WaitOne(0))");
    expect(script).toContain("$Trava.ReleaseMutex()");
    expect(script.indexOf("$Trava.ReleaseMutex()")).toBeGreaterThan(script.indexOf("} finally {"));
  });

  it("os shims das IAs chamam o Node portátil e a mensagem de sucesso só vem depois de provar o processo", () => {
    const shims = script.slice(script.indexOf("function FixarNodeNosShims"), script.indexOf("function InstalarIa"));
    expect(shims).toContain("$nodeCmd = $NodeExe");
    expect(shims).toContain("($Binario + '.cmd')");
    expect(shims).toContain("($Binario + '.ps1')");
    expect(shims).toContain("Join-Path $PastaNpm $Binario");
    const iniciar = script.slice(script.indexOf("function IniciarMotor"), script.indexOf("function RetomarMotor"));
    expect(iniciar).toContain("while ((PidsDoMotor).Count -eq 0");
    expect(iniciar).toContain("if ((PidsDoMotor).Count -eq 0) { Falhar");
    expect(iniciar.indexOf("$Estado.Iniciado = $true")).toBeGreaterThan(iniciar.indexOf("Falhar"));
    expect(script.indexOf("Motor atualizado e no ar")).toBeGreaterThan(script.indexOf("IniciarMotor"));
  });

  it("para o motor antes de trocar o Node e as IAs (o Windows trava o .exe em uso)", () => {
    const ordem = ["    GarantirGit", "    PararMotor", "    InstalarNode", "    InstalarIas", "    InstalarMotor", "    CriarComandos", "    RegistrarInicio"].map((p) => script.indexOf(p));
    expect(ordem.every((i) => i > 0)).toBe(true);
    expect([...ordem].sort((a, b) => a - b)).toEqual(ordem);
  });

  it("o Git só por winget, winget --scope user ou instalador com a assinatura do Git for Windows", () => {
    expect(script).toContain("'--scope', 'user'");
    expect(script).toContain("Get-AuthenticodeSignature");
    expect(script).toContain("$cn -cne 'Johannes Schindelin'");
    expect(script).toContain("https://github.com/git-for-windows/git/releases/download/");
    expect(script).toMatch(/\$assinatura\.Status -ne 'Valid'/);
  });

  it("ADA-245: marca em ias-do-nod.json só a IA que o npm do nod instalou e que não existia antes", () => {
    // O mesmo arquivo e as mesmas chaves que o `nod-motor desinstalar` lê (motor/desinstalar.ts).
    const c = caminhosNoWindows({ LOCALAPPDATA: "C:\\U\\AppData\\Local", APPDATA: "C:\\U\\AppData\\Roaming" })!;
    expect(c.marca).toBe("C:\\U\\AppData\\Roaming\\nod-motor\\ias-do-nod.json");
    expect(script).toContain("$MarcaDasIas = Join-Path (Join-Path $env:APPDATA 'nod-motor') 'ias-do-nod.json'");
    expect(Object.keys(IAS_DO_NPM).sort()).toEqual(["claude", "codex"]);
    expect(script).toContain("InstalarIa '@anthropic-ai/claude-code' 'claude'");
    expect(script).toContain("InstalarIa '@openai/codex' 'codex'");
    const instalar = script.slice(script.indexOf("function InstalarIa("), script.indexOf("function InstalarIas"));
    // Só depois do npm install e só sem versão antes (a IA que já era da pessoa nunca entra na marca).
    expect(instalar).toContain("if (-not $antes) { MarcarIaDoNod $Binario $PastaNpm }");
    expect(instalar.indexOf("MarcarIaDoNod")).toBeGreaterThan(instalar.indexOf("'install', '-g'"));
    expect(instalar.indexOf("{ Passo ($Nome + ' ' + $antes); return $true }")).toBeLessThan(instalar.indexOf("MarcarIaDoNod"));
    const marcar = script.slice(script.indexOf("function MarcarIaDoNod"), script.indexOf("function InstalarIa("));
    // Só com o shim no prefixo do nod; junta com a marca que já havia; uma falha só vai ao log (nunca derruba a instalação).
    expect(marcar).toContain("if (-not (Test-Path -LiteralPath $shim)) { return }");
    expect(marcar).toContain("foreach ($p in $lida.PSObject.Properties) { $marca[$p.Name] = $p.Value }");
    expect(marcar).toContain("[IO.File]::WriteAllText($MarcaDasIas, ($marca | ConvertTo-Json -Compress))");
    expect(marcar).toMatch(/\} catch \{ Registrar/);
    // A forma que o PowerShell grava é a que o desinstalar entende (versão string; 'sim' quando o --version falha).
    expect(lerMarcaDasIas('{"claude":"2.1.3","codex":"sim"}')).toEqual(["claude", "codex"]);
  });
});
