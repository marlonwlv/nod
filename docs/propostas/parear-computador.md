# Proposta — experiência de parear computador

Data: 2026-11-25

Base examinada: `main` em `969a800b`, depois do merge do PR #325 (sucessão de chave).

Situação: diagnóstico e direções para discutir. Ainda não há decisão. Quando houver, ela vira ADR e issues.

## O que motivou

Em 24/11, a tarefa "Socket do navegador no Mac" do Dev Local ficou "esperando MacBook-Pro-de-Marlon.local · sem
contato desde 09:38". O Mac estava ligado e rodando turnos de outros bots. Na mesma hora, o Mr Mime "trocou de
computador", mas o destino tinha o mesmo nome do computador anterior.

Causa:

- Às 09:38 o app parou o motor. O provável gatilho foi o item de menu "Conexão / verificar conta de IA", que roda
  `parar().then(mostrarSetup)` sem pedir confirmação.
- Na tela de conexão, o "entrar pelo navegador" emitiu uma **chave de máquina nova** com o mesmo nome (o hostname).
- A chave antiga não foi revogada. Os bots (`agentes.maquina_id`) e as sessões das tarefas (`sessao_maquina_id`)
  continuaram apontando para ela, e ninguém mais se conectava com essa chave.
- O "trocar de computador" do Mr Mime valeu só para aquele turno (`turnos.maquina_desta_vez`). O turno seguinte
  voltou para a chave morta.

O caso não é novo. Em 16/11 aconteceu a mesma coisa, e o Comunidade Nod ficou preso desde então numa chave que ninguém
usava. Na mesma conta, o MacBook-Air-de-pablo tem 4 chaves vivas, e o Copiador está preso numa delas.

A produção foi corrigida à mão em 24/11. O PR #325 passou a tratar o caso mais comum: o mesmo app pareando de novo com a
conexão anterior ainda guardada.

## Como funciona hoje

**Para o nod, um computador é uma chave.** O `machineId` que o app e o motor anunciam é o id da chave
(`motor/main.ts:71`). Toda vez que um computador pareia, nasce um "computador novo". Nada liga a chave nova à anterior
da mesma instalação.

Caminhos que emitem chave, todos por `emitirChaveMaquina` (`src/use-cases/chaves-maquina.ts:21`):

| Caminho | Onde | Nome da chave | Aposenta a anterior? |
|---|---|---|---|
| App do Mac, "entrar pelo navegador" | `desktop/parear.ts` → `POST /pareamento/trocar` (`rotas/maquinas.ts`) | `hostname()` | Desde o #325, se o app ainda tinha a conexão anterior |
| Login dentro do app (código por e-mail, Google, troca vinda da web) | `src/use-cases/conta.ts:273`, `:553`, `:739`; `emitirTrocaApp` em `:171` | `aparelho` ou "Este computador" | Desde o #325, pelo mesmo `conectar` do app |
| Motor (Linux/VM/Windows) por código de dispositivo ou convite | `POST /pareamento/dispositivo/trocar` | nome da máquina | Só papel `computador` com `substituir`, VM criada pelo nod (ADR-121) e, desde o #325, `parear --convite` com a conexão anterior |
| Chave criada na web | `POST /maquinas/chaves` | o que a pessoa digitar | Não |

O comentário em `emitirChaveMaquina` registra a regra: "Emitir de novo NÃO cancela as anteriores — quem quer trocar
revoga a velha". Na prática, ninguém revoga.

### O que o #325 resolve e o que não resolve

O #325 trata o caso em que o app, ao reconectar, ainda tem a conexão anterior guardada (`conexao.enc`). Ele manda a chave
antiga como prova junto com a nova. O servidor passa bots, máquina padrão, sessões, turnos pendentes e preferência do
navegador para a nova chave e só depois revoga a antiga. Se a chave nova for de outra pessoa (troca de conta), o
servidor recusa e nada muda.

Continua sem sucessão:

- App reinstalado do zero, `conexao.enc` apagado, outro usuário do macOS no mesmo Mac.
- Chave nova emitida pela web.
- Um app que falhou ao chamar `aposentar` (sem rede no momento, por exemplo). Hoje isso só aparece no log
  `chave_antiga_nao_sucedida`.
- As duplicatas que já existem (as do MacBook-Air-de-pablo).

## Problemas de experiência

1. **Repareamento cria um computador novo.** Para a pessoa, é o mesmo Mac. Para o nod, é outro, e o anterior vira um
   fantasma "sem contato" que segura os bots. O #325 remenda isso por baixo, mas o modelo continua "uma chave = um
   computador".
2. **Repareamento sem querer.** "Conexão / verificar conta de IA" soa como uma checagem, mas derruba o motor, corta o
   turno em andamento e abre a tela de conexão, que leva a parear de novo. Não há confirmação nem aviso de que algo está
   rodando. Até o #325 isso nem ficava no log.
3. **Nomes iguais.** Duas chaves "MacBook-Pro-de-Marlon.local" aparecem iguais. "Trocou pelo mesmo" e "está fora do ar"
   ao lado de um Mac ligado são o sintoma visível disso.
4. **Muitos caminhos para conectar.** São quatro portas, cada uma emitindo chave do seu jeito, com nomes diferentes
   (hostname, "Este computador", texto livre). Corrigir um caminho não corrige os outros.
5. **Computador de outra pessoa na conta.** O Mac do Pablo está na conta do Marlon com 4 chaves vivas. Não há um lugar
   claro que mostre isso, nem quem pareou ou quando, nem um jeito simples de limpar.
6. **"Trocar de computador" ambíguo.** A pessoa entende "passe o bot para este computador". O nod faz "só esta vez". O
   próximo turno volta para o computador antigo, morto ou não.

## Direções

### A. Identidade estável da instalação (recomendada)

O app e o motor geram um `instalacao_id` aleatório no primeiro uso e o guardam fora da conexão: num arquivo próprio ou
no keychain, para sobreviver a "Conexão" e a um logout. Esse id vai em todo pareamento, por qualquer um dos caminhos.

No servidor, a variante mais leve é guardar `instalacao_id` em `maquina_tokens` e criar uma regra única dentro de
`emitirChaveMaquina`: **uma chave nova da mesma pessoa e da mesma instalação sucede a anterior na mesma transação**. A
sucessão faz o que o #325 faz hoje (`transferirReferencias` + `removerMaquina`), mas no servidor e para todos os
caminhos, sem depender de o app lembrar da chave velha. O `aposentar` com `sucessora` fica como compatibilidade dos apps
antigos.

A variante maior cria uma tabela `computadores`, com `maquina_id` estável e a chave como credencial rotativa. Ela é mais
limpa, mas mexe no `machineId` que bots, turnos, sessões e navegador referenciam. Só vale se outras coisas pedirem a
mesma identidade, como nome editável, histórico e várias contas no mesmo Mac.

Risco: o `instalacao_id` não é segredo. Quem souber o id e estiver logado **na mesma conta** consegue suceder aquela
máquina. O alcance fica dentro da própria pessoa, e um UUID aleatório não se adivinha. Parece aceitável, mas precisa
constar na ADR.

### B. Separar "verificar conta de IA" de "trocar conexão"

- "Verificar conta de IA" passa a só verificar, sem parar o motor.
- "Trocar de conta ou servidor" vira um item próprio. Ele pede confirmação, diz quantos turnos estão rodando e oferece
  esperar terminar ou interromper.
- Com a direção A, mesmo um repareamento acidental deixa de deixar órfãos. A direção B evita o corte do turno.

### C. Lista de computadores que dá para entender

- Mostrar nome editável, "este computador", último contato, versão do app, plataforma e quem pareou e quando.
- Agrupar duplicatas de mesmo nome e oferecer "juntar": mover bots e sessões para a chave viva e revogar as outras.
- Pela regra de paridade (ADR-135, skill `acao-no-chat`), toda ação nova na tela precisa de caminho pelo chat.

### D. Deixar claro o "trocar de computador"

Quando o computador do bot está fora do ar e a pessoa escolhe outro, oferecer as duas opções com nomes que digam o que
fazem: **"Só desta vez"** e **"Passar o bot para este computador"**. Se o computador antigo já estiver revogado ou for
sucedido, a escolha nem deveria aparecer.

### E. Computadores de outra pessoa na conta

Mostrar na lista de que pessoa ou sessão veio cada pareamento e oferecer remover. Se for normal alguém usar a conta de
outra pessoa no próprio Mac, isso pede convite e membros, que é outra conversa.

## Perguntas para o Marlon

1. Parear deveria acontecer **uma vez na vida do computador**, ficando invisível depois, ou você quer um lugar explícito
   para gerenciar computadores?
2. O MacBook-Air-de-pablo na sua conta foi de propósito? Se não foi, revogamos as chaves e passamos o Copiador para a
   chave viva.
3. Para a direção A: a variante leve (`instalacao_id` em `maquina_tokens`) basta, ou já vale ir para `computadores`?
4. Um mesmo Mac com duas contas do nod (duas pessoas) é um caso que precisa ser suportado?

## Pendências operacionais (fora deste PR)

- MacBook-Air-de-pablo: 4 chaves vivas na conta do Marlon. A viva é `2d3d26e0`. O Copiador está preso na `544d763d`,
  com um turno na fila. Aguardando a resposta da pergunta 2.
- Testar o #325 num app de verdade, o que exige uma build nova do app do Mac.
