// A entrada do host do native messaging na prova do Windows (o Chrome a inicia pelo .cmd que registrarHostNoWindows
// grava): a mesma função do `nod-motor navegador-host`, com a pasta do motor da prova (NOD_MOTOR_HOME, herdada do Chrome).
import { pipeDoChrome, rodarHostDoChrome, senhaDoChrome } from "../../src/adapters/executor/chrome-da-pessoa.ts";
import { pastaDoMotor } from "../../motor/conexao.ts";

const pasta = pastaDoMotor(process.env);
process.exitCode = await rodarHostDoChrome({ pipe: pipeDoChrome(pasta), senha: await senhaDoChrome(pasta, false), entrada: process.stdin, saida: process.stdout });
