# Computador ao vivo

## O que esta fatia entrega

A sala continua sendo `web/telas/tela-cheia.ts`, aberta pelo chip do computador no chat, pelo painel e por um pedido de
ajuda. Ela mostra `Iniciando desktop`, `Conectando`, `Assistindo`, `Reconectando` e o fallback sem trocar de tela. O
motor mantém o transporte existente; Orgo e Docker usam o mesmo WebSocket público. No Orgo o servidor abre o upstream,
valida o host, termina VNC Auth e oferece ao noVNC uma sessão sem senha. No Docker ele abre uma ponte binária por
`docker exec` até o socket Unix do x11vnc dentro do container. Queda, fila acima de 8 MiB, sessão revogada, tenant ou
Origin errados e protocolo desconhecido fecham a conexão; a sala conserva o último quadro e volta a capturas.

A integração Orgo fica desligada por padrão. Uma regra `NOD_COMPUTADOR_PROVEDOR*=orgo` sozinha não monta o provedor nem
o relay: o servidor exige também `NOD_COMPUTADOR_ORGO=1`, e cada pessoa só alcança a rede depois de ter o conector
privado `orgo` com `ORGO_API_KEY` cifrada no cofre. Sem qualquer uma dessas condições, falha fechado e usa o caminho
local/fallback disponível.

Docker e Orgo entram pelo mesmo `DriverComputador` e pela mesma sala. O Docker declara `telaAoVivo: "vnc_websocket"`,
mas não publica WebSocket nem VNC próprio: o x11vnc sobe com `-rfbport 0 -rfbportv6 0` e só cria
`/tmp/nod-vnc.sock`. O container não tem `EXPOSE` nem `--publish`; somente o processo do servidor, já autorizado no
escopo da pessoa, executa `vnc-bridge.mjs` dentro da máquina e entrega os bytes ao relay. Se qualquer parte cair, a
mesma sala reconecta e conserva as capturas como fallback.

## Provas

Sem conta externa:

```bash
mise exec -- npx vitest run --project unit \
  tests/unit/adapters/computador-relay-vnc.test.ts \
  tests/unit/adapters/computador-docker-vnc.test.ts \
  tests/unit/adapters/computador-provedores.test.ts \
  tests/unit/adapters/computador-vivo.test.ts \
  tests/unit/voz/ws-vivo.test.ts \
  tests/unit/web/tela-cheia.test.ts
mise exec -- npm run typecheck
```

O teste do relay usa VNC Auth de verdade, dois blocos diferentes de framebuffer, filtro de entrada, allowlist e o
contrato comum. A prova Docker atravessa relay → seletor → `docker exec` → ponte → socket VNC, confere o transporte nos
dois sentidos, o fechamento bilateral, o teto da fila e a ausência de listener/porta pública. O filtro RFB prova que
teclado, ponteiro e clipboard não passam ao assistir; pedido de quadro continua passando.

Para a prova Orgo real, o servidor precisa de `NOD_COMPUTADOR_ORGO=1`, escolha `orgo` em
`NOD_COMPUTADOR_PROVEDOR*` e um conector privado `orgo` com `ORGO_API_KEY` cifrada no cofre da pessoa. Nunca coloque a
chave em `.env`, argumento, log ou shell history. Com servidor `NOD_LOGIN=stub` já apontando para esse banco:

```bash
mise exec -- node scripts/ensaio-computador/vivo.ts \
  --formato orgo --api http://127.0.0.1:8889 \
  --tenant <tenant-uuid> --pessoa <pessoa-uuid> --agente <agente-uuid>
```

O ensaio só assiste: acorda pelo caminho normal, abre `?modo=assistir` e prova que o navegador recebe o handshake sem
senha. Nesta entrega a execução real está bloqueada enquanto não existir no produto um meio seguro de cadastrar o
conector `orgo`; a ausência de `ORGO_API_KEY` não é substituída por fixture nem por variável de ambiente.

## Telas, desktop e aplicativos

Uma “screen” do Bot HQ é um display X separado do mesmo computador, normalmente alugado a um bot. Não é um monitor do
bot. A navegação correta no Nod é entre bots/telas pelo chat e pelo painel; abrir um bot abre a sala da tela dele. Esta
fatia não cria uma lista falsa de quatro monitores. O contrato do relay não impede até quatro displays quando o
provedor e o vínculo bot→display existirem, mas esse aluguel ainda não existe no modelo do Orgo do Nod.

Também não entram aqui o `hq-shell.py`, dock, home personalizada, Browser/Terminal/Files nem launchers. Hoje Docker usa
a imagem `nod-computador:1` e Orgo nasce de uma imagem Linux genérica. A próxima fatia deve extrair um bootstrap
idempotente e versionado (wallpaper/tema, shell, dock, home por bot e launchers), executável no build do Docker e pelo
`bash` do Orgo, com teste de versão e sem credenciais na imagem. Só depois disso os dois formatos terão o mesmo desktop,
além da mesma sala.
