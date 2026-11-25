import { createRoot } from "react-dom/client";
import { apiDoServidor } from "./react/backoffice/api.ts";
import { AppBackoffice } from "./react/backoffice/app.tsx";

/** ADR-194: /backoffice, o backoffice interno (só leitura). Quem entra o servidor decide; aqui só desenha. */
const raiz = document.getElementById("backoffice");
if (raiz) createRoot(raiz).render(<AppBackoffice api={apiDoServidor()} />);
