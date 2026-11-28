import { describe, expect, it } from "vitest";
import { chamadasCdpDaEntrada, codigoVirtual, entradaDescartavel } from "../../../src/domain/navegador-entrada-cdp.ts";
import { lerEntradaNavegador } from "../../../src/domain/navegador-entrada.ts";

const vp = { w: 1280, h: 720 };
const cdp = (cru: unknown) => chamadasCdpDaEntrada(lerEntradaNavegador(cru, vp)!);

describe("a entrada da pessoa pelo CDP (confirmada)", () => {
  it("o clique vai como dispatchMouseEvent, com botão e contagem", () => {
    expect(cdp({ t: "mouse", evento: "mousePressed", x: 10, y: 20 })).toEqual([{ metodo: "Input.dispatchMouseEvent", params: { type: "mousePressed", x: 10, y: 20, modifiers: 0, button: "left", clickCount: 1 } }]);
    expect(cdp({ t: "mouse", evento: "mouseMoved", x: 1, y: 2 })[0]!.params).toMatchObject({ type: "mouseMoved", button: "none", clickCount: 0 });
    expect(cdp({ t: "mouse", evento: "mouseWheel", x: 1, y: 2, dx: 0, dy: 120 })[0]!.params).toMatchObject({ type: "mouseWheel", deltaX: 0, deltaY: 120 });
    expect(cdp({ t: "mouse", evento: "mousePressed", x: 1, y: 2, botao: "right", cliques: 2 })[0]!.params).toMatchObject({ button: "right", clickCount: 2 });
  });

  it("cada dígito do CPF vai como keyDown com texto (o caminho antigo perdia dígitos seguidos)", () => {
    const k = cdp({ t: "tecla", evento: "keyDown", tecla: "1", codigo: "Digit1", texto: "1" });
    expect(k).toEqual([{ metodo: "Input.dispatchKeyEvent", params: { type: "keyDown", key: "1", code: "Digit1", windowsVirtualKeyCode: 49, modifiers: 0, text: "1", unmodifiedText: "1" } }]);
    expect(cdp({ t: "tecla", evento: "keyUp", tecla: "1", codigo: "Digit1" })[0]!.params).toMatchObject({ type: "keyUp", windowsVirtualKeyCode: 49 });
  });

  it("letra com acento e maiúscula com Shift são texto, não atalho", () => {
    expect(cdp({ t: "tecla", evento: "keyDown", tecla: "ç", codigo: "Semicolon", texto: "ç" })[0]!.params).toMatchObject({ type: "keyDown", text: "ç", windowsVirtualKeyCode: 186 });
    expect(cdp({ t: "tecla", evento: "keyDown", tecla: "A", codigo: "KeyA", texto: "A", modificadores: 8 })[0]!.params).toMatchObject({ type: "keyDown", text: "A", modifiers: 8 });
  });

  it("colar e o acento composto vão como insertText (o texto inteiro, de uma vez)", () => {
    expect(cdp({ t: "tecla", evento: "char", texto: "José da Conceição" })).toEqual([{ metodo: "Input.insertText", params: { text: "José da Conceição" } }]);
  });

  it("Backspace, Tab e setas vão como rawKeyDown sem texto; Enter leva \\r para quebrar a linha e enviar o formulário", () => {
    expect(cdp({ t: "tecla", evento: "keyDown", tecla: "Backspace", codigo: "Backspace" })[0]!.params).toEqual({ type: "rawKeyDown", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8, modifiers: 0 });
    expect(cdp({ t: "tecla", evento: "keyDown", tecla: "Tab", codigo: "Tab" })[0]!.params).toMatchObject({ type: "rawKeyDown", windowsVirtualKeyCode: 9 });
    expect(cdp({ t: "tecla", evento: "keyDown", tecla: "ArrowLeft", codigo: "ArrowLeft" })[0]!.params).toMatchObject({ type: "rawKeyDown", windowsVirtualKeyCode: 37 });
    expect(cdp({ t: "tecla", evento: "keyDown", tecla: "Enter", codigo: "Enter" })[0]!.params).toMatchObject({ type: "keyDown", text: "\r", windowsVirtualKeyCode: 13 });
  });

  it("os atalhos de edição levam o comando (o Chrome sem janela não os tem), com Ctrl ou ⌘", () => {
    expect(cdp({ t: "tecla", evento: "keyDown", tecla: "a", codigo: "KeyA", modificadores: 4 })[0]!.params).toMatchObject({ type: "rawKeyDown", commands: ["selectAll"], modifiers: 4 });
    expect(cdp({ t: "tecla", evento: "keyDown", tecla: "a", codigo: "KeyA", modificadores: 2 })[0]!.params).toMatchObject({ commands: ["selectAll"] });
    expect(cdp({ t: "tecla", evento: "keyDown", tecla: "z", codigo: "KeyZ", modificadores: 12 })[0]!.params).toMatchObject({ commands: ["redo"] });
    expect(cdp({ t: "tecla", evento: "keyDown", tecla: "f", codigo: "KeyF", modificadores: 2 })[0]!.params).not.toHaveProperty("commands");
    expect(cdp({ t: "tecla", evento: "keyDown", tecla: "a", codigo: "KeyA", modificadores: 1 })[0]!.params).not.toHaveProperty("commands");
  });

  it("a tecla morta do acento, o modificador sozinho e o tamanho não vão ao Chrome", () => {
    expect(cdp({ t: "tecla", evento: "keyDown", tecla: "Dead", codigo: "Quote" })).toEqual([]);
    expect(cdp({ t: "tecla", evento: "keyDown", tecla: "Shift", codigo: "ShiftLeft" })).toEqual([]);
    expect(cdp({ t: "tamanho", w: 800, h: 600 })).toEqual([]);
  });

  it("o código virtual sai do code, da tecla ou fica 0", () => {
    expect(codigoVirtual("q", "KeyQ")).toBe(81);
    expect(codigoVirtual("7", "Numpad7")).toBe(103);
    expect(codigoVirtual("x")).toBe(88);
    expect(codigoVirtual("€")).toBe(0);
    expect(codigoVirtual(" ", "Space")).toBe(32);
  });

  it("só o mouse andando pode cair com a fila cheia", () => {
    expect(entradaDescartavel({ t: "mouse", evento: "mouseMoved", x: 1, y: 1 })).toBe(true);
    expect(entradaDescartavel({ t: "mouse", evento: "mousePressed", x: 1, y: 1 })).toBe(false);
    expect(entradaDescartavel({ t: "tecla", evento: "char", texto: "a" })).toBe(false);
  });
});
