import type { BitsDoAparelho, MotivoSemTeste } from "../contracts/checagem-aparelho.ts";

/**
 * Quem ganha o teste grátis (ADR-178). O bit 0 do DeviceCheck é "já usou o teste" (definido em 2026-11-12; o bit 1 fica
 * livre). Máquina virtual não ganha: o DeviceCheck não existe nela e uma VM nova seria um teste novo a cada vez
 * (a VM é detectada). A política da empresa (MDM) desliga o teste. Puro.
 */
export function decidirTesteGratis(e: { bits: BitsDoAparelho | null; maquinaVirtual: boolean; semTesteGratisPelaEmpresa: boolean }): { libera: true; marcar: BitsDoAparelho } | { libera: false; motivo: MotivoSemTeste } {
  if (e.semTesteGratisPelaEmpresa) return { libera: false, motivo: "politica_da_empresa" };
  if (e.maquinaVirtual) return { libera: false, motivo: "maquina_virtual" };
  if (!e.bits) return { libera: false, motivo: "token_invalido" };
  if (e.bits.bit0) return { libera: false, motivo: "aparelho_ja_usou" };
  return { libera: true, marcar: { bit0: true, bit1: e.bits.bit1 } };
}

/** Os sinais de VM que o app do Mac junta (`sysctl kern.hv_vmm_present`, modelo "VirtualMac"). Qualquer um basta. */
export function pareceMaquinaVirtual(s: { hvVmmPresent?: string | null; modelo?: string | null }): boolean {
  return s.hvVmmPresent?.trim() === "1" || /virtual/i.test(s.modelo ?? "");
}
