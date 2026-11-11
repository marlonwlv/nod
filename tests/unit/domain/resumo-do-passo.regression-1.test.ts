import { describe, expect, it } from "vitest";
import { RESUMO_DO_PASSO_MAX } from "../../../src/contracts/quadro-comentarios.ts";
import { redigirResumo } from "../../../src/domain/resumo-do-passo.ts";

// Regression: ISSUE-002 — `docker login -p <senha>` passava inteiro para o resumo do passo (gravado e publicado); e quatro
// regras da redação (Bearer sem "Authorization:", chave privada, JWT inteiro, nome com sufixo `secret_key`) podiam sumir sem
// nenhum teste reprovar, porque os casos de resumo-do-passo.test.ts também casam com outra regra.
// Found by /qa on 2026-11-11 (QA do PR #16, ADA-302).
// Report: .gstack/qa-reports/qa-report-pr16-2026-11-11.md

// Montados por partes, como em resumo-do-passo.test.ts (a varredura do público barra o literal).
const JWT_PARTES = ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", "dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"];
const PEM = ["-----BEGIN RSA PRIVATE", "KEY-----"].join(" ");

describe("redigirResumo (ADR-165): cada regra segura o segredo sozinha", () => {
  it.each([
    ["docker login -p", "docker login -u eu -p Hunter22pass registry.io", "Hunter22pass"],
    ["Bearer sem Authorization", `curl -H "X-Auth: ${"Bear" + "er"} abcd1234efgh" api`, "abcd1234efgh"],
    ["chave privada em pedaços curtos", `echo '${PEM} MIIEow IBAAKCAQEA abc/def+ghi' > k`, "MIIEow"],
    ["JWT: o cabeçalho e o corpo saem com a assinatura", `curl -H 'x: ${JWT_PARTES.join(".")}'`, JWT_PARTES[1]!],
    ["nome com sufixo (secret_key)", "secret_key=abc123xyz python manage.py", "abc123xyz"],
  ])("%s", (_, texto, segredo) => {
    const r = redigirResumo(texto, RESUMO_DO_PASSO_MAX);
    expect(r).toContain("••••");
    expect(r).not.toContain(segredo);
  });
});
