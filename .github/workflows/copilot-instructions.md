# FC Arena — Instruções permanentes para IA

Estas instruções são permanentes e devem ser consideradas antes de qualquer alteração no projeto.

O objetivo é evoluir o FC Arena preservando sua arquitetura, regras de negócio, dados e funcionalidades existentes.

---

## Stack

* Electron
* React
* TypeScript
* Vite
* SQLite
* `better-sqlite3`
* Lucide React

---

# Arquitetura — NÃO NEGOCIÁVEL

O fluxo de dados deve seguir:

**Renderer (React) → Preload → IPC → Main → Repository → SQLite**

### Renderer

* O React nunca acessa SQLite diretamente.
* O React nunca importa `better-sqlite3`.
* O React não deve executar SQL.
* O Renderer deve utilizar somente as APIs expostas pelo Preload.

### Preload

* Utilizar `contextBridge`.
* Expor somente funções específicas necessárias ao Renderer.
* Nunca expor `ipcRenderer` inteiro.
* Não criar atalhos que permitam ao Renderer executar canais IPC arbitrários.

### IPC

* Seguir o padrão de canais já existente no projeto.
* Não criar um padrão paralelo de comunicação.
* Validar tipos de entrada e saída quando necessário.

### Main

* Responsável pelo processamento no processo principal.
* Encaminhar operações para o Repository.
* Não mover lógica de banco para o Renderer.

### Repository

* É a camada responsável pelo acesso ao SQLite.
* Queries com `better-sqlite3` devem permanecer nessa camada.
* Reutilizar funções existentes sempre que possível.
* Evitar duplicação de queries e regras de negócio.

---

# Banco de dados

O projeto utiliza:

**SQLite + better-sqlite3**

O schema deve ser sempre consultado no código antes de criar ou modificar queries.

Estruturas principais atualmente utilizadas:

* `players`
* `teams`
* `championships`
* `championship_participants`
* `fixtures`
* `matches`

Antes de assumir qualquer coluna, consultar o schema real.

Não inventar:

* nomes de tabelas;
* nomes de colunas;
* relacionamentos;
* IDs;
* endpoints;
* canais IPC;
* funções do Repository.

---

# Regra de negócio — Ranking

O ranking é calculado a partir das partidas existentes em `matches`.

**Não criar uma tabela separada para armazenar o ranking atual**, salvo se houver uma necessidade de performance comprovada e previamente discutida.

A lógica existente de ranking deve ser preservada.

Não criar uma segunda implementação de:

* pontos;
* vitórias;
* empates;
* derrotas;
* gols marcados;
* gols sofridos;
* saldo;
* aproveitamento;
* sequência.

Se uma dessas regras já existir, reutilizá-la.

---

# Partidas

As partidas existentes devem continuar sendo a fonte dos dados estatísticos.

Antes de alterar qualquer coisa relacionada a partidas, verificar:

* `player1`;
* `player2`;
* `team1`;
* `team2`;
* `score1`;
* `score2`;
* `championship`;
* `playedAt`.

Não assumir que uma partida possui campos diferentes dos existentes.

Alterações em partidas podem afetar:

* ranking;
* histórico;
* campeonatos;
* fixtures;
* estatísticas;
* conquistas;
* perfil dos jogadores.

Verificar esses impactos antes de modificar a lógica.

---

# Campeonatos

O projeto possui suporte existente para:

* liga/round-robin;
* mata-mata/knockout;
* geração automática de fixtures;
* classificação;
* avanço de vencedores.

O modelo também possui suporte previsto para:

**`groups_knockout`**

mas essa funcionalidade pode não estar totalmente implementada.

Antes de implementar grupos + mata-mata, analisar e reutilizar a lógica existente de:

* fixtures;
* classificação;
* pontos;
* avanço;
* finalização do campeonato.

Não duplicar a lógica existente.

---

# Regras de qualidade

## Tipagem

* TypeScript deve permanecer fortemente tipado.
* Nunca utilizar `any` para esconder erro.
* Corrigir a causa do problema de tipagem.
* Atualizar tipos compartilhados quando necessário.

## Build

Após alterações relevantes, executar/verificar:

* TypeScript;
* build;
* testes existentes, quando disponíveis.

Uma tarefa não deve ser considerada concluída enquanto houver erros causados pela implementação.

## Código existente

Preservar funcionalidades existentes.

Não reescrever arquivos inteiros quando uma alteração localizada for suficiente.

Não fazer refatorações não relacionadas à tarefa.

Não alterar comportamento existente apenas para simplificar a implementação.

---

# Regra obrigatória — causa raiz antes da correção

Quando houver um bug:

**NÃO corrigir imediatamente.**

Primeiro investigar e identificar:

1. causa raiz;
2. arquivo responsável;
3. função/componente responsável;
4. fluxo que gera o problema;
5. motivo do comportamento;
6. impacto em outras funcionalidades;
7. menor correção possível.

Somente depois aplicar a correção.

Não fazer alterações experimentais apenas para "ver se funciona".

---

# Regra obrigatória — analisar antes de implementar

Para qualquer funcionalidade nova:

### Etapa 1 — investigar

Ler o código relevante.

### Etapa 2 — localizar reutilização

Verificar se já existe:

* função;
* query;
* componente;
* hook;
* tipo;
* serviço;
* estilo;
* mecanismo de estado;
* canal IPC

que possa ser reutilizado.

### Etapa 3 — planejar

Informar:

* arquivos que serão alterados;
* arquivos que serão criados;
* lógica necessária;
* possíveis impactos;
* alterações de banco, se houver;
* testes necessários.

### Etapa 4 — implementar

Implementar somente o escopo solicitado.

### Etapa 5 — validar

Verificar:

* TypeScript;
* build;
* imports;
* tipos;
* IPC;
* queries;
* estados da interface;
* regressões.

### Etapa 6 — revisar

Depois da implementação, procurar:

* bugs;
* cálculos incorretos;
* queries incorretas;
* N+1;
* duplicação;
* problemas de estado;
* problemas de responsividade;
* regressões.

---

# Banco e performance

Evitar N+1 queries.

Quando uma estatística puder ser calculada eficientemente pelo SQLite através de:

* `COUNT`;
* `SUM`;
* `AVG`;
* `GROUP BY`;
* `ORDER BY`;
* agregações;

preferir o processamento no banco.

Não buscar milhares de registros para fazer cálculos simples no React sem necessidade.

Criar índices somente quando houver justificativa técnica.

Não adicionar cache ou tabelas redundantes apenas por antecipação.

---

# Interface

Seguir os padrões visuais já existentes no FC Arena.

Reutilizar:

* componentes;
* estilos;
* espaçamentos;
* tipografia;
* cores;
* bordas;
* sombras;
* ícones;
* botões;
* modais;
* cards.

Não introduzir uma nova biblioteca de UI ou um novo sistema de design sem necessidade.

Toda nova interface deve considerar:

* desktop;
* notebook;
* tablet;
* celular;
* loading;
* estado vazio;
* erro;
* acessibilidade básica.

---

# Dependências

Antes de instalar qualquer nova biblioteca:

1. verificar se o projeto já possui uma solução equivalente;
2. verificar se a funcionalidade pode ser implementada com as ferramentas existentes;
3. explicar a necessidade da nova dependência;
4. avaliar impacto no bundle e manutenção.

Não instalar dependências automaticamente sem necessidade.

---

# Segurança

Nunca:

* expor `ipcRenderer` inteiro;
* permitir SQL arbitrário vindo do Renderer;
* confiar cegamente em dados recebidos do Renderer;
* colocar credenciais ou segredos no código;
* ignorar validações existentes.

---

# Alterações no banco

Antes de qualquer alteração de schema:

1. explicar por que ela é necessária;
2. identificar quais funcionalidades serão afetadas;
3. propor a alteração;
4. explicar como os dados existentes serão preservados;
5. verificar se existe uma solução sem alteração de schema.

Nunca fazer uma migração silenciosamente.

---

# Processo para tarefas grandes

Tarefas grandes devem ser divididas em etapas.

Exemplo:

**Etapa 1 → Backend**

**Etapa 2 → IPC/Preload**

**Etapa 3 → Tipos**

**Etapa 4 → Frontend**

**Etapa 5 → Testes**

**Etapa 6 → Revisão**

Não implementar diversas funcionalidades independentes simultaneamente quando isso aumentar o risco de regressão.

Após cada etapa, informar:

* arquivos criados;
* arquivos alterados;
* decisões técnicas;
* testes realizados;
* possíveis pendências.

---

# O que NÃO fazer

Não:

* inventar schema;
* inventar APIs;
* inventar canais IPC;
* criar tabelas redundantes;
* duplicar regras de negócio;
* reescrever arquivos sem necessidade;
* adicionar bibliotecas sem justificativa;
* usar `any` para eliminar erros;
* ignorar erros do TypeScript;
* modificar funcionalidades fora do escopo;
* alterar ranking sem analisar seu funcionamento atual;
* alterar campeonatos sem analisar sua implementação atual;
* alterar o banco sem explicar antes;
* corrigir sintomas sem identificar a causa raiz.

---

# Informações reais do projeto

### Estrutura principal

```text
src/
├── main/
├── preload/
├── renderer/
└── shared/
```

Arquivos importantes:

```text
src/main/repository.ts
src/main/index.ts
src/preload/index.ts
src/shared/api.ts
src/shared/models.ts
src/renderer/main.tsx
src/renderer/styles/app.css
src/renderer/styles/fixtures.css
```

### Banco

```text
SQLite
better-sqlite3
```

### Tabelas principais

```text
players
teams
championships
championship_participants
fixtures
matches
```

### Dados derivados

Ranking e estatísticas gerais devem continuar sendo derivados das partidas existentes, salvo decisão técnica explícita.

---

# Regra final

Antes de escrever código:

**ENTENDER → PLANEJAR → IMPLEMENTAR → VALIDAR → REVISAR**

Nunca:

**PEDIR → ESCREVER CÓDIGO IMEDIATAMENTE**

Se houver uma informação realmente necessária que não possa ser determinada pelo código existente, perguntar antes de assumir.

Se uma decisão puder ser determinada pelo código existente, **não perguntar: investigar o código primeiro.**

Ao terminar uma tarefa, listar:

### Arquivos alterados

### Arquivos criados

### Alterações no banco

### Decisões técnicas

### Testes/validação

### Suposições

### Pendências

Não considerar a tarefa concluída apenas porque o código foi escrito.

A implementação deve estar integrada ao projeto existente, tipada, validada e sem regressões conhecidas.
