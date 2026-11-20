import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

/**
 * ADR-179: setup do projeto `componentes` (vitest.config.ts). Sem `globals: true` a Testing Library não desmonta
 * sozinha entre os testes; o cleanup fica aqui para cada arquivo não precisar lembrar.
 */
afterEach(() => cleanup());
