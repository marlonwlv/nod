import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ARGUMENTO_ANTI_DOWNGRADE,
  chaveAntiDowngrade,
  lerPacote,
  majorDoElectron,
  versaoFinal,
} from "../../../scripts/desktop/info-plist-release.mjs";

/** NOD-467 (ADR-149): ElectronSquirrelPreventDowngrades só entra quando o Squirrel.Mac o aplica sem recusar toda atualização. */
describe("info-plist-release.mjs (NOD-467)", () => {
  it("versão final é exatamente x.y.z de dígitos, sem rc nem zero à esquerda", () => {
    for (const v of ["1.0.0", "0.4.0", "10.20.30"]) expect(versaoFinal(v), v).toBe(true);
    for (const v of ["1.0.0-rc.7", "1.0", "1.0.0.1", "01.0.0", "1.0.0+build", " 1.0.0", "v1.0.0", "", undefined, null, 100]) expect(versaoFinal(v), String(v)).toBe(false);
  });

  it("a major do Electron sai de versão estável fixa ou com ^/~; pré-release e o resto não ligam", () => {
    expect(majorDoElectron("43.7.1")).toBe(43);
    expect(majorDoElectron("^44.11.3")).toBe(44);
    expect(majorDoElectron("~45.0.0")).toBe(45);
    for (const s of ["44.0.0-beta.1", "~45.0.0-beta.1", "latest", ">=44", "44", "", undefined, "git+https://x"]) expect(majorDoElectron(s), String(s)).toBeNull();
  });

  it("liga só com versão final E Electron >= 44 (o patch do 43 tem a checagem invertida)", () => {
    const casos: [string, string, boolean][] = [
      ["1.0.0-rc.7", "43.7.1", false],
      ["1.0.0", "43.7.1", false],
      ["1.0.0", "43.8.10", false],
      ["1.0.0-rc.8", "44.11.3", false],
      ["1.0.0", "44.0.0-beta.1", false],
      ["1.0.0", "44.11.3", true],
      ["1.2.3", "^45.3.2", true],
      ["1.0.0", "latest", false],
    ];
    for (const [versao, electron, liga] of casos) expect(chaveAntiDowngrade({ versao, electron }), `${versao} + ${electron}`).toBe(liga);
  });

  it("lê a versão e o Electron do package.json (devDependencies, com dependencies de reserva)", () => {
    expect(lerPacote(JSON.stringify({ version: "1.0.0", devDependencies: { electron: "44.0.0" } }))).toEqual({ versao: "1.0.0", electron: "44.0.0" });
    expect(lerPacote(JSON.stringify({ version: "1.0.0", dependencies: { electron: "44.0.0" } }))).toEqual({ versao: "1.0.0", electron: "44.0.0" });
    const real = lerPacote(readFileSync("package.json", "utf8"));
    expect(real.versao).toBeTruthy();
    expect(majorDoElectron(real.electron)).not.toBeNull();
  });

  it("a CLI imprime o argumento do electron-builder só quando a regra liga (hoje, com o package.json real)", () => {
    const r = spawnSync(process.execPath, ["scripts/desktop/info-plist-release.mjs"], { encoding: "utf8" });
    expect(r.status).toBe(0);
    const esperado = chaveAntiDowngrade(lerPacote(readFileSync("package.json", "utf8")));
    expect(r.stdout).toBe(esperado ? `${ARGUMENTO_ANTI_DOWNGRADE}\n` : "");
    expect(r.stderr).toMatch(/ElectronSquirrelPreventDowngrades: (ligada|desligada)/);
  });

  it("o argumento soma uma chave ao mac.extendInfo (o deepAssign do electron-builder mantém o microfone)", () => {
    expect(ARGUMENTO_ANTI_DOWNGRADE).toBe("--config.mac.extendInfo.ElectronSquirrelPreventDowngrades=true");
    expect(readFileSync("electron-builder.yml", "utf8")).toMatch(/^ {2}extendInfo:\n {4}NSMicrophoneUsageDescription:/m);
  });
});
