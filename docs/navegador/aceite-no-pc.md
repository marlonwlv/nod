# O navegador do bot no PC: o aceite com uma pessoa (ADR-190, revisão de 2026-11-22/23)

A CI prova o navegador no Windows de verdade (job `windows`, `tests/windows/navegador-windows.test.ts`): o motor com o
agent-browser.exe, a instalação, o 1Password e o Bitwarden reais, o WinRT do Windows Hello e o "Trazer do meu Chrome"
pela extensão (com o Chrome for Testing). O que só uma pessoa confirma está aqui, em ~15 minutos, num PC com Windows
10/11 e o Google Chrome.

## Antes

1. **A extensão na Chrome Web Store** (uma vez, pela conta do nod no painel de desenvolvedor): enviar o zip da loja, que
   leva o `key.pem` na raiz no primeiro envio — é o que mantém o id `hlmkcbnegkfaeffpldmlkdnpogdegcae`, o único que o
   host do motor aceita (`allowed_origins`). A chave privada NUNCA entra no repositório. Para testar antes da loja:
   `chrome://extensions` → Modo do desenvolvedor → Carregar sem compactação → a pasta `extensao-chrome/` (o id sai o
   mesmo, pelo `key` do manifesto).
2. **O servidor com o navegador na máquina:** `NOD_NAVEGADOR_NA_MAQUINA=1`.

## O roteiro

| # | Faça | Espere |
|---|---|---|
| 1 | No PowerShell: `irm <servidor>/windows \| iex` e pareie | "navegador do bot (agent-browser 0.43.0)" na instalação |
| 2 | Num bot: "Pelo navegador, abre a lista de 2024 do IMDb" | O painel mostra a página ao vivo; a linha diz "no seu PC" |
| 3 | "Pelo navegador: no saucedemo.com põe a Bike Light no carrinho e finaliza" e escolha o cofre | O cartão de login oferece o 1Password/Bitwarden e o cofre do nod |
| 4 | Com o 1Password (op CLI ligado ao app) ou o Bitwarden (`bw unlock`, a BW_SESSION no ambiente do motor): escolha-o no cartão | A senha entra no campo sem aparecer na conversa |
| 5 | Na aprovação de pagar: "Pagar com Windows Hello" | O Windows pede o rosto, a digital ou o PIN; cancelar = não paga |
| 6 | Num site em que você está logado no Chrome: "Pelo navegador, entra no <site>" e toque "Trazer do meu Chrome" | Com a extensão: o bot entra logado. Sem ela: "instale a extensão do nod no seu Chrome…" |
| 7 | Feche o Chrome e repita o 6 | "instale a extensão…" (a extensão só responde com o Chrome aberto) |

Anote o que não bateu com o "Espere" e o horário; o motor registra em `%LOCALAPPDATA%\nod\instalador.log` (instalação) e
no log do motor (o resto).
