# Gestão de Armazéns — Guia de Configuração

Arquitetura: **frontend estático** (HTML/CSS/JS, hospedado no GitHub Pages,
igual ao site que você já tem) + **backend em Google Apps Script**, que lê e
escreve direto na sua planilha do Google Sheets. Não há servidor próprio nem
banco de dados separado — a planilha *é* o banco de dados, como pedido na spec.

---

## FASE 1 — Criar a planilha e o backend

1. Crie uma planilha nova no Google Sheets (ex: "Gestão de Armazéns - Dados").
2. Nela, vá em **Extensões → Apps Script**.
3. Apague o conteúdo padrão do `Code.gs` e cole o conteúdo do arquivo `Code.gs` deste projeto.
4. No topo da barra de ferramentas do editor, selecione a função `configurarPlanilha` no dropdown e clique em **Executar** (▶). Na primeira vez, o Google vai pedir autorização — aceite (é a sua própria conta acessando a sua própria planilha).
5. Volte na planilha: as abas `CONFIG_UNIDADES`, `CONFIG_USUARIOS`, `CONFIG_ARMAZENS`, `CONFIG_ARMADILHAS`, `CONFIG_OCORRENCIAS`, `INSPECOES`, `OCORRENCIAS_INSPECAO`, `CAPTURA_CARUNCHOS`, `CHECKLIST_LIMPEZA`, `PENDENCIAS` e `_SEQ` foram criadas com cabeçalhos e alguns dados de exemplo (Macatuba, Lucas admin, João conferente, Armazém 01).
6. **Apague/edite os dados de exemplo** e cadastre suas unidades, usuários, armazéns e armadilhas reais.

### Publicar a API (Web App)

1. No editor do Apps Script: **Implantar → Nova implantação**.
2. Tipo: **App da Web**.
3. Configurações:
   - Executar como: **Eu**
   - Quem pode acessar: **Qualquer pessoa**
4. Clique em **Implantar**, autorize novamente se pedido, e copie a **URL do app da Web** (termina em `/exec`).

> Sempre que você editar o `Code.gs`, é preciso criar uma **nova versão** da implantação (Implantar → Gerenciar implantações → ✏️ → Nova versão) para as mudanças valerem na URL publicada.

---

## FASE 2 — Conectar o frontend

1. Abra `app.js`.
2. Na primeira linha de código, troque:
   ```js
   const API_URL = 'COLE_A_URL_DO_SEU_APPS_SCRIPT_AQUI';
   ```
   pela URL que você copiou (terminando em `/exec`).
3. Suba os arquivos `index.html`, `style.css` e `app.js` para o seu repositório `gestao-armazens` no GitHub (mesma pasta, substituindo os atuais).
4. O GitHub Pages já publica automaticamente em `https://lucasgomes-droid.github.io/gestao-armazens/`.

---

## Estrutura de dados (abas da planilha)

| Aba | Uso |
|---|---|
| `CONFIG_UNIDADES` | Unidades (Macatuba, Jundiaí I, Jundiaí II...). `ATIVO = SIM/NAO` controla se aparece no login. |
| `CONFIG_USUARIOS` | Usuários por unidade. `TIPO = ADMIN` ou `CONFERENTE`. Só ADMIN usa `SENHA`. |
| `CONFIG_ARMAZENS` | Armazéns por unidade + `RESPONSAVEL`/`ID_RESPONSAVEL` (usado no direcionamento automático de pendências). |
| `CONFIG_ARMADILHAS` | Armadilhas por armazém (usadas na captura de carunchos). |
| `CONFIG_OCORRENCIAS` | Tipos de ocorrência disponíveis ao registrar pendência manual. |
| `INSPECOES` / `OCORRENCIAS_INSPECAO` / `CAPTURA_CARUNCHOS` | Geradas automaticamente pelo formulário de inspeção do conferente. |
| `CHECKLIST_LIMPEZA` | Gerada pelo checklist de limpeza (diário/semanal/mensal/anual). |
| `PENDENCIAS` | Pendências, com todo o fluxo de status. |
| `_SEQ` | Interna — controla a numeração dos IDs (INS-000001, PEN-000001...). Não edite manualmente. |

Editar unidades, usuários, armazéns, armadilhas e tipos de ocorrência **direto na planilha** já reflete no app automaticamente (nada fica fixo no código, como pedido na spec).

---

## O que já está implementado

- Login em 2 (ou 3) passos: Unidade → Usuário → Senha (só para ADMIN), com sessão em memória (sem repetir unidade/usuário nos formulários).
- Isolamento total por unidade em todas as consultas (o backend sempre filtra por `UNIDADE`).
- **Inspeção dos galpões** com toda a árvore de perguntas condicionais da spec: produto avariado, goteiras (incluindo o desdobramento de "material não removido"), risco de queda, risco de tombamento, e captura de várias armadilhas dentro da mesma inspeção.
- **Checklist de limpeza** diário/semanal/mensal/anual, com campo obrigatório de manutenção quando o aspirador (ou outro item) "necessita manutenção".
- **Pendências**: direcionamento automático pelo responsável do armazém, fluxo de status ABERTA → EM_TRATAMENTO/AGUARDANDO_VALIDACAO → FINALIZADA, foto obrigatória para o conferente resolver, validação pelo admin.
- **Validação de inspeções** pelo admin, com opção de abrir pendência diretamente a partir de uma inspeção reprovada.
- **Histórico** do conferente (só os próprios registros).
- **Dashboards** de carunchos, limpeza e pendências (cards + gráficos de barra simples), filtrados pela unidade da sessão.
- Fotos são enviadas em base64 e salvas automaticamente numa pasta do Google Drive (`GestaoArmazens_Fotos`), com o link salvo na planilha.

## O que ainda precisa de atenção (próximos incrementos)

- **Notificações** (seção 18 da spec): hoje a pendência é criada e aparece na lista do responsável ao abrir o app; não há push/e-mail automático. Isso pode ser adicionado no `Code.gs` com `MailApp.sendEmail()` disparado dentro de `criarPendencia_`.
- **Filtros de dashboard por período/mês** (seção 21-23): o backend já aceita `dataInicial`/`dataFinal` no dashboard de carunchos; falta adicionar os seletores de data na tela (fácil de estender).
- **Cadastro de administradores/senhas via app**: hoje isso é feito só pela planilha (`CONFIG_USUARIOS`), como pedido na seção 2 — nenhuma tela de "criar admin" foi feita no app, propositalmente.
- **Edição de tipos de ocorrência "Outro" persistente**: quando o admin digita uma ocorrência customizada, ela é salva na pendência mas não é automaticamente adicionada de volta à aba `CONFIG_OCORRENCIAS`.
- Senhas de admin ficam em texto simples na planilha (igual à estrutura pedida na spec). Para mais segurança no futuro, dá para trocar por hash, mas isso está fora do escopo do documento original.

## Testes recomendados (seção 44 da spec)

Depois de configurar suas unidades/usuários reais, siga a lista de 13 testes do documento original — a estrutura do app foi pensada exatamente para passar por eles (isolamento por unidade, foto obrigatória em avaria/risco de queda/resolução de pendência, direcionamento automático ao trocar responsável, etc.).
