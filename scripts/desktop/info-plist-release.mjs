// NOD-467 (ADR-149): quando o app do Mac sai com `ElectronSquirrelPreventDowngrades` no Info.plist. A chave faz o
// Squirrel.Mac recusar instalar um bundle de versão menor que a do app que está rodando (a defesa do lado do app contra
// quem controla o servidor ou escreve no bucket). Ela só entra quando é seguro:
//
// - versão x.y.z, sem rc: o Squirrel exige exatamente três partes numéricas na versão do app E na da atualização; com a
//   chave ligada num `1.0.0-rc.7`, TODA atualização falha ("not a valid version string");
// - Electron 44 ou mais: o patch do Electron 43 (patches/squirrel.mac/feat_add_ability_to_prevent_version_downgrades,
//   até o 43.8.10) tem a checagem de formato invertida (`versionBad || [dígitos isSupersetOfSet: parte]`) e marca
//   "1.0.0" como inválida, então ligada ela recusaria toda atualização. O Squirrel.Mac do 44 (fffea30) já vem corrigido.
//
// Uso no CI (job `mac` do desktop-release.yml): `node scripts/desktop/info-plist-release.mjs` imprime o argumento do
// electron-builder (ou nada). O `verificar-pacote-mac.mjs` usa a mesma regra para conferir o Info.plist do app assinado.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** A primeira versão do Electron com o Squirrel.Mac que barra downgrade direito (e confere o `sha256`, c4a95b0c). */
export const ELECTRON_MINIMO_ANTI_DOWNGRADE = 44;

/** O argumento que o electron-builder soma ao `mac.extendInfo` do yml (deepAssign: o texto do microfone fica). */
export const ARGUMENTO_ANTI_DOWNGRADE = "--config.mac.extendInfo.ElectronSquirrelPreventDowngrades=true";

/** Versão que o Squirrel aceita com a chave ligada: três partes só de dígitos, sem zero à esquerda nem sufixo. */
export function versaoFinal(versao) {
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(String(versao ?? ""));
}

/** A major de uma versão fixa do Electron (`44.11.3`, `^44.1.0`, `~44.0.0`); qualquer outra coisa = null (não liga). */
export function majorDoElectron(spec) {
  const m = /^[\^~]?(\d+)\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.exec(String(spec ?? "").trim());
  return m ? Number(m[1]) : null;
}

/** Liga a chave? Só com versão final E Electron com o Squirrel corrigido. Na dúvida, não liga (o servidor já só anuncia versão maior). */
export function chaveAntiDowngrade({ versao, electron }) {
  const major = majorDoElectron(electron);
  return versaoFinal(versao) && major !== null && major >= ELECTRON_MINIMO_ANTI_DOWNGRADE;
}

/** A versão do app e a do Electron, lidas do package.json (a mesma fonte do electron-builder). */
export function lerPacote(json) {
  const p = JSON.parse(json);
  return { versao: p.version, electron: p.devDependencies?.electron ?? p.dependencies?.electron };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const pacote = lerPacote(readFileSync(resolve(RAIZ, "package.json"), "utf8"));
  const liga = chaveAntiDowngrade(pacote);
  process.stderr.write(`ElectronSquirrelPreventDowngrades: ${liga ? "ligada" : "desligada"} (versão ${pacote.versao}, Electron ${pacote.electron})\n`);
  if (liga) process.stdout.write(`${ARGUMENTO_ANTI_DOWNGRADE}\n`);
}
