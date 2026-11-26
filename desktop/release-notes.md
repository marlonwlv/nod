# nod 1.0.0-rc.15

Décima quinta candidata da 1.0.0: **o bot passa a usar os apps do seu Mac ou PC**. Macs: DMGs assinados (Developer ID) e notarizados; quem está numa rc anterior recebe pelo atualizador automático quando a versão for anunciada, ou instala o DMG por cima. Windows: instalador `.exe` de 1 clique, por usuário, ainda sem assinatura (o SmartScreen pede "Mais informações > Executar assim mesmo", NOD-471); no PC o recurso chega pelo motor, que se atualiza sozinho. Instalação, requisitos e atualização: [guia do desktop](https://github.com/marlonwlv/nod/blob/v1.0.0-rc.15/docs/release-desktop.md).

## O que entra desde a rc.14 (26/11)

- **O bot usa os apps do seu Mac ou PC** ([#392](https://github.com/marlonwlv/nod/pull/392), ADR-197): quando o pedido aponta para um app que só existe no seu computador (Numbers, Excel, um sistema instalado), o bot pede num cartão — "Permitir desta vez", "Sempre no {app}" ou "Agora não" — e trabalha por trás da janela, sem tomar o seu mouse. Uma ilha no topo da tela mostra quem, em qual app e o que está fazendo, com Parar; a janela do app ganha uma borda âmbar. Senhas, Ajustes do Sistema, gerenciadores de senha, Terminal e o próprio nod ficam sempre de fora. No Mac, o nod usa as permissões de Acessibilidade e Gravação de Tela (Ajustes › Máquinas › Seu Mac mostra as duas e onde ligar). O motor é o cua-driver 0.62.1 (trycua, MIT), dentro do app, com hash conferido.
- **O bot escolhe melhor onde trabalhar**: app conectado, depois o navegador dele, depois o computador dele na nuvem e, por último, o seu computador — e diz em uma frase onde vai e por quê.
- **Cofre: chaves na tela e o cartão da Orgo** ([#391](https://github.com/marlonwlv/nod/pull/391), ADR-195).

## Registro da versão

```text
Versão / tag / SHA: 1.0.0-rc.15 / v1.0.0-rc.15 / <SHA> (último PR no commit: <PR>)
PR e execução do Actions: desktop-release run <RUN> (verify, vm-local arm64 e amd64, windows, mac arm64 e x64, draft)
Servidor e migrações compatíveis: https://app.nodbot.ai, mesma tag
DMGs, ZIPs, .exe e hashes: ver SHA256-arm64.txt, SHA256-x64.txt e SHA256-win-x64.txt anexos
Disco da VM local (Mac): nod-vm-1.0.0-rc.15-arm64.img.zst e -amd64.img.zst, com .sha256, anexos e em gs://nodbot-downloads/v1.0.0-rc.15/
Windows: nod-windows-x64.exe (nome estável, /download/windows e o botão do site) e nod-1.0.0-rc.15-win-x64.exe (feed da atualização) em gs://nodbot-downloads
Atualização automática (ZIPs e .exe no bucket, NOD_APP_VERSAO_PUBLICADA e NOD_APP_ATUALIZACAO_SHA256, deploy): pendente
Assinatura e notarização: Mac pendente de conferir nas duas arquiteturas (Developer ID, notarizado e grampeado); Windows sem assinatura (NOD-471)
Aceite Intel (pessoa, Mac, macOS, resultado): pendente
Aceite ARM (pessoa, Mac, macOS, resultado): pendente
Aceite Windows (pessoa, versão do Windows, resultado): pendente
Atualização desde a versão anterior: pendente (origem 1.0.0-rc.14)
Custo dos turnos do aceite: pendente
Limitações e recuperação: candidata (pre-release). Windows: SmartScreen na primeira execução. Mac: primeira abertura baixa o disco da VM (~750 MB).
O que falhou e o que melhorar na próxima versão: <preencher com o estado da CI no merge>
```

Aceite Intel/ARM/Windows: pendente.
