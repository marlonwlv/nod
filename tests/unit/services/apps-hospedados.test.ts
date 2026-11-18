import { expect, it } from "vitest";
import { limitadorAppsHospedados } from "../../../src/adapters/http/apps-hospedados.ts";
import { montarAmbiente } from "../../../src/domain/ambiente-executor.ts";

it("limita por pessoa e globalmente, libera janela sem reter identidades", () => {
  let agora = 0;
  const limitar = limitadorAppsHospedados(() => agora);
  const p = { tenantId: "t", pessoaId: "p" };
  for (let i = 0; i < 30; i++) limitar(p);
  expect(() => limitar(p)).toThrow();
  for (let i = 0; i < 270; i++) limitar({ ...p, pessoaId: `p${i}` });
  expect(() => limitar({ ...p, pessoaId: "nova" })).toThrow();
  agora = 60_000;
  expect(() => limitar(p)).not.toThrow();
});

it("chave de infraestrutura não é herdada por executor nem conector arbitrário", () => {
  for (const regime of ["local", "servidor"] as const) {
    expect(montarAmbiente(regime, { NOD_COMPOSIO_API_KEY: "ficticia" })).toEqual({});
  }
});
