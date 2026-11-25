import { createCipheriv, createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { criarCofresDoMac, executarDoCofre, refDoUsuario, type ExecutarDoCofre } from "../../../desktop/cofres-do-mac.ts";
import { chaveDoChrome, cookiesDoChrome } from "../../../desktop/cookies-do-chrome.ts";

/**
 * Os cofres do Mac para o navegador do bot (ADR-177, ADR-190 L): `op`, `bw` e `security` FALSOS (scripts numa pasta
 * temporária, rodados de verdade por `execFile`), um banco `Cookies` do Chrome montado com o `node:sqlite`. Nunca toca no
 * 1Password, no Bitwarden, no Keychain ou no Chrome da pessoa. Os scripts gravam o argv e o stdin num arquivo: a senha
 * nunca pode estar no argv.
 */
const SENHA = "S3nha-do-cofre!";
const PASSE_DO_CHROME = "passe-do-keychain";

let pasta: string;
let home: string;
const argv = async (nome: string) => (await readFile(join(pasta, `${nome}.argv`), "utf8").catch(() => "")).split("\n").filter(Boolean);

async function script(nome: string, corpo: string): Promise<string> {
  const p = join(pasta, nome);
  await writeFile(p, `#!/bin/sh\nD="$(dirname "$0")"\necho "$*" >> "$D/${nome}.argv"\n${corpo}\n`);
  await chmod(p, 0o755);
  return p;
}

const OP = `case "$1 $2" in
  "item list") printf '%s' '[{"id":"i1","title":"Itaú","vault":{"id":"v1","name":"Pessoal"},"additional_information":"marlon@exemplo.com","urls":[{"href":"https://www.itau.com.br/login","primary":true}]},{"id":"i2","title":"Bradesco","vault":{"id":"v1"},"urls":[{"href":"https://banco.bradesco"}]}]' ;;
  "item create") cat > "$D/op.stdin" ;;
  *) case "$3" in
       op://v1/i1/password) printf '%s' '${SENHA}' ;;
       op://v1/i1/username) printf '%s' 'marlon@exemplo.com' ;;
       *) echo "[ERROR] authorization prompt dismissed" >&2; exit 1 ;;
     esac ;;
esac`;

const BW = `echo "$BW_SESSION" > "$D/bw.sessao"
case "$1 $2" in
  "list items") printf '%s' '[{"id":"b1","name":"Itaú","login":{"username":"ana@x.com","password":"${SENHA}","uris":[{"uri":"https://itau.com.br"}]}},{"id":"b2","name":"Outro","login":{"username":"z","uris":[{"uri":"https://outro.com"}]}}]' ;;
  "get password") printf '%s\\n' '${SENHA}' ;;
  "get username") printf '%s\\n' 'ana@x.com' ;;
  "create item") cat > "$D/bw.stdin" ;;
esac`;

beforeEach(async () => {
  pasta = await mkdtemp(join(tmpdir(), "nod-cofres-"));
  home = join(pasta, "home");
  await mkdir(home);
});
afterEach(async () => { await rm(pasta, { recursive: true, force: true }); });

async function cofres(o: { bwSessao?: string | null; executar?: ExecutarDoCofre; touch?: boolean } = {}) {
  const op = await script("op", OP);
  const bw = await script("bw", BW);
  return criarCofresDoMac({ home, acharOp: async () => op, acharBw: async () => bw, sessaoBitwarden: () => (o.bwSessao === undefined ? "sessao-bw" : o.bwSessao), touchId: async () => o.touch ?? true, ...(o.executar ? { executar: o.executar } : {}) });
}

describe("1Password e Bitwarden (op e bw falsos no PATH da pasta)", () => {
  it("listar: só os itens do site, com usuário mascarado, sem senha; a sessão do bw vai pelo env", async () => {
    const c = await cofres();
    const opcoes = await c.listar("internetpf.itau.com.br");
    expect(opcoes).toEqual([
      { fonte: "1password", ref: "op://v1/i1/password", rotulo: "Itaú · marlon@…", disponivel: true },
      { fonte: "bitwarden", ref: "b1", rotulo: "Itaú · ana@…", disponivel: true },
    ]);
    expect(JSON.stringify(opcoes)).not.toContain(SENHA);
    expect((await readFile(join(pasta, "bw.sessao"), "utf8")).trim()).toBe("sessao-bw");
    expect(await argv("op")).toEqual(["item list --categories Login --format json"]);
  });

  it("Bitwarden travado aparece cinza com 'destravar no seu Mac'; o 1Password que não responde a tempo vira a opção genérica", async () => {
    const travado = await cofres({ bwSessao: null });
    expect((await travado.listar("itau.com.br")).find((o) => o.fonte === "bitwarden")).toEqual({ fonte: "bitwarden", ref: "", rotulo: "Bitwarden", disponivel: false, motivoIndisponivel: "destravar no seu Mac" });
    const lento: ExecutarDoCofre = async (bin, args, o) => (args[0] === "item" ? { codigo: -1, saida: "", erro: "", estourou: true } : executarDoCofre(bin, args, o));
    const c = await cofres({ executar: lento, bwSessao: null });
    expect((await c.listar("itau.com.br"))[0]).toEqual({ fonte: "1password", ref: "", rotulo: "Usar o 1Password", disponivel: true });
  });

  it("ler devolve usuário e senha pelo stdout (nunca o argv leva a senha); a recusa do Touch ID vira 'recusado'", async () => {
    const c = await cofres();
    expect(await c.ler("1password", "op://v1/i1/password", "itau.com.br")).toEqual({ usuario: "marlon@exemplo.com", senha: SENHA });
    expect(await c.ler("1password", "", "www.itau.com.br")).toEqual({ usuario: "marlon@exemplo.com", senha: SENHA });
    expect(await c.ler("bitwarden", "b1", "itau.com.br")).toEqual({ usuario: "ana@x.com", senha: SENHA });
    await expect(c.ler("1password", "op://v1/i9/password", "itau.com.br")).rejects.toMatchObject({ motivo: "recusado" });
    await expect(c.ler("bitwarden", "b1;rm", "itau.com.br")).rejects.toMatchObject({ motivo: "alvo_invalido" });
    expect(refDoUsuario("op://v1/i1/password")).toBe("op://v1/i1/username");
    expect([...(await argv("op")), ...(await argv("bw"))].join("\n")).not.toContain(SENHA);
  });

  it("guardar manda o item pelo stdin: a senha não entra no argv de nenhum dos dois", async () => {
    const c = await cofres();
    await c.guardar("1password", "bradesco.com.br", "ana", SENHA);
    await c.guardar("bitwarden", "bradesco.com.br", "ana", SENHA);
    const doOp = JSON.parse(await readFile(join(pasta, "op.stdin"), "utf8")) as { title: string; fields: { id: string; value: string }[] };
    expect(doOp.title).toBe("bradesco.com.br");
    expect(doOp.fields.find((f) => f.id === "password")?.value).toBe(SENHA);
    const doBw = JSON.parse(Buffer.from(await readFile(join(pasta, "bw.stdin"), "utf8"), "base64").toString("utf8")) as { login: { password: string; uris: { uri: string }[] } };
    expect(doBw.login).toMatchObject({ password: SENHA, uris: [{ uri: "https://bradesco.com.br" }] });
    expect([...(await argv("op")), ...(await argv("bw"))].join("\n")).not.toContain(SENHA);
    const semSessao = await cofres({ bwSessao: null });
    await expect(semSessao.guardar("bitwarden", "a.com", "u", "s")).rejects.toMatchObject({ motivo: "recusado" });
  });
});

describe("cookies do Chrome (SQLite e security falsos)", () => {
  /** O que o Chrome do macOS grava: v10 + AES-128-CBC (IV de espaços) do hash do domínio + o valor (meta.version 24). */
  function cifrarComoChrome(valor: string, dominio: string): Buffer {
    const c = createCipheriv("aes-128-cbc", chaveDoChrome(PASSE_DO_CHROME), Buffer.alloc(16, 0x20));
    const claro = Buffer.concat([createHash("sha256").update(dominio).digest(), Buffer.from(valor, "utf8")]);
    return Buffer.concat([Buffer.from("v10"), c.update(claro), c.final()]);
  }
  const microsDoChrome = (unix: number) => BigInt(unix + 11_644_473_600) * 1_000_000n;

  async function bancoDoChrome(linhas: { host: string; nome: string; valor?: string; cifrado?: Buffer; expira?: bigint; samesite?: number }[], perfil: readonly string[] = ["Google", "Chrome", "Default"]) {
    const dir = join(home, "Library", "Application Support", ...perfil);
    await mkdir(dir, { recursive: true });
    const db = new DatabaseSync(join(dir, "Cookies"));
    db.exec("create table meta (key text, value text); insert into meta values ('version', '24');");
    db.exec("create table cookies (host_key text, name text, value text, encrypted_value blob, path text, expires_utc integer, is_secure integer, is_httponly integer, samesite integer)");
    const ins = db.prepare("insert into cookies values (?, ?, ?, ?, ?, ?, 1, 1, ?)");
    for (const l of linhas) ins.run(l.host, l.nome, l.valor ?? "", l.cifrado ?? Buffer.alloc(0), "/", l.expira ?? 0n, l.samesite ?? 1);
    db.close();
  }

  it("só os do host e do domínio pai registrável, decifrados (descartando o hash do domínio); vencidos ficam de fora", async () => {
    const agora = 1_800_000_000;
    await bancoDoChrome([
      { host: ".itau.com.br", nome: "sessao", cifrado: cifrarComoChrome("abc123", ".itau.com.br"), expira: microsDoChrome(agora + 3600), samesite: 2 },
      { host: "www.itau.com.br", nome: "pref", valor: "claro" },
      { host: ".itau.com.br", nome: "velho", valor: "x", expira: microsDoChrome(agora - 10) },
      { host: ".bradesco.com.br", nome: "outro", valor: "nao" },
      { host: ".outro.itau.com.br", nome: "irmao", valor: "nao" },
    ]);
    const security = await script("security", `printf '%s\\n' '${PASSE_DO_CHROME}'`);
    const cookies = await cookiesDoChrome({ host: "www.itau.com.br", home, executar: executarDoCofre, security, agoraSeg: () => agora });
    expect(cookies).toEqual([
      { name: "sessao", value: "abc123", domain: ".itau.com.br", path: "/", expires: agora + 3600, secure: true, httpOnly: true, sameSite: "Strict" },
      { name: "pref", value: "claro", domain: "www.itau.com.br", path: "/", expires: -1, secure: true, httpOnly: true, sameSite: "Lax" },
    ]);
    expect(await argv("security")).toEqual(["find-generic-password -w -s Chrome Safe Storage"]);
  });

  it("2026-11-23: o perfil com a sessão vence, no Arc ou noutro perfil; só o Keychain dele é pedido", async () => {
    await bancoDoChrome([{ host: ".linkedin.com", nome: "bcookie", valor: "b" }, { host: ".linkedin.com", nome: "lidc", valor: "l" }]);
    await bancoDoChrome([{ host: ".linkedin.com", nome: "bcookie", valor: "b" }], ["Google", "Chrome", "Profile 1"]);
    await bancoDoChrome([
      { host: ".www.linkedin.com", nome: "li_at", cifrado: cifrarComoChrome("sessao-do-arc", ".www.linkedin.com") },
      { host: ".www.linkedin.com", nome: "JSESSIONID", valor: "j" },
      { host: ".linkedin.com", nome: "bcookie", valor: "b" },
    ], ["Arc", "User Data", "Profile 1"]);
    const security = await script("security", `printf '%s\\n' '${PASSE_DO_CHROME}'`);
    const cookies = await cookiesDoChrome({ host: "www.linkedin.com", home, executar: executarDoCofre, security });
    expect(cookies.map((c) => [c.name, c.value])).toEqual([["li_at", "sessao-do-arc"], ["JSESSIONID", "j"], ["bcookie", "b"]]);
    expect(await argv("security")).toEqual(["find-generic-password -w -s Arc Safe Storage"]);
  });

  it("sem cookie cifrado o Keychain nem é pedido; o Keychain recusado vira 'recusado'; sem Chrome, indisponível", async () => {
    await bancoDoChrome([{ host: "www.exemplo.com", nome: "a", valor: "1" }, { host: ".itau.com.br", nome: "s", cifrado: cifrarComoChrome("x", ".itau.com.br") }]);
    const security = await script("security", "exit 51");
    expect(await cookiesDoChrome({ host: "www.exemplo.com", home, executar: executarDoCofre, security })).toHaveLength(1);
    expect(await argv("security")).toEqual([]);
    await expect(cookiesDoChrome({ host: "www.itau.com.br", home, executar: executarDoCofre, security })).rejects.toMatchObject({ motivo: "recusado" });
    await expect(cookiesDoChrome({ host: "a.com", home: join(pasta, "sem-chrome"), executar: executarDoCofre, security })).rejects.toMatchObject({ motivo: "indisponivel" });
  });
});
