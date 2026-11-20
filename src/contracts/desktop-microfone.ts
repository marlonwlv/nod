/**
 * NOD (17/11/2026, primeiro teste do microfone no Windows): o aviso "libere o microfone" leva a pessoa direto à tela do
 * sistema em que isso se muda. A página só pede "abrir"; o endereço (ms-settings: no Windows, x-apple.systempreferences:
 * no Mac) é fixo no processo principal (desktop/permissoes-midia.ts `AJUSTES_DO_MICROFONE`), nunca vem da página.
 * Mora fora de desktop.ts pelo teto de 200 linhas.
 */
export type PonteMicrofone = {
  /** Abre Privacidade › Microfone do sistema; false = não abriu. Ausente = app de antes desta versão (a web só mostra o texto). */
  ajustesMicrofone?(): Promise<boolean>;
};

export const CANAIS_MICROFONE = { ajustes: "nod:ajustes-microfone" } as const;
