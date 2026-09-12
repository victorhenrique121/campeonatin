# FC Arena

Aplicação desktop para organizar partidas, jogadores, times, rankings e campeonatos de **EA Sports FC** entre amigos.

O projeto foi desenvolvido para funcionar localmente, mantendo os dados em um banco SQLite e oferecendo uma interface gráfica para registrar partidas e acompanhar competições.

> **Status:** em desenvolvimento. O núcleo de partidas, ranking e campeonatos já está implementado; novas funcionalidades podem ser adicionadas conforme o projeto evolui.

---

## Sumário

- [Visão geral](#visão-geral)
- [Funcionalidades](#funcionalidades)
- [Sistema de partidas](#sistema-de-partidas)
- [Campeonatos](#campeonatos)
- [Ranking](#ranking)
- [Banco de dados](#banco-de-dados)
- [Arquitetura](#arquitetura)
- [Tecnologias](#tecnologias)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Instalação](#instalação)
- [Desenvolvimento](#desenvolvimento)
- [Build para Windows](#build-para-windows)
- [Backup e restauração](#backup-e-restauração)
- [Validações](#validações)
- [Como funciona o fluxo de dados](#como-funciona-o-fluxo-de-dados)
- [Modelo de dados](#modelo-de-dados)
- [Scripts disponíveis](#scripts-disponíveis)
- [Roadmap](#roadmap)

---

## Visão geral

O FC Arena funciona como um gerenciador local de campeonatos e partidas de EA Sports FC.

A aplicação permite cadastrar jogadores, utilizar um catálogo de clubes, registrar resultados, consultar estatísticas e criar campeonatos com calendário ou chave eliminatória.

O banco de dados é acessado exclusivamente pelo processo principal do Electron. A interface React não acessa o SQLite diretamente; ela utiliza uma API exposta pelo preload através de IPC e `contextIsolation`.

### Principais objetivos

- Centralizar os resultados das partidas.
- Evitar cálculos manuais de classificação.
- Organizar campeonatos entre amigos.
- Gerar automaticamente confrontos.
- Manter os dados armazenados localmente.
- Permitir backup do banco de dados.

---

## Funcionalidades

### Dashboard

A tela inicial reúne informações gerais da aplicação, incluindo:

- quantidade de jogadores;
- quantidade de partidas;
- líder do ranking;
- time mais utilizado;
- partidas recentes;
- ranking geral.

Os dados estatísticos são calculados a partir das partidas registradas.

### Jogadores

É possível:

- cadastrar jogadores;
- definir nome e apelido;
- armazenar avatar quando disponível;
- listar jogadores;
- excluir jogadores;
- remover os registros relacionados ao jogador de acordo com as regras de integridade do banco.

O apelido (`nickname`) é único no banco de dados.

### Times

O aplicativo possui um catálogo local de clubes com:

- nome do time;
- liga;
- país.

Os times podem ser pesquisados pela interface de registro de partidas.

O projeto também possui scripts/dados para geração e manutenção do catálogo de clubes.

### Partidas

O módulo de partidas permite:

- registrar partidas;
- selecionar dois jogadores;
- selecionar dois times;
- definir o placar;
- associar uma partida a um campeonato ou registrá-la como partida avulsa;
- visualizar o histórico;
- editar resultados já registrados;
- limpar o histórico de partidas.

São aplicadas validações para impedir, por exemplo, que o mesmo jogador enfrente a si próprio ou que os dois lados utilizem o mesmo time.

### Ranking

O ranking é calculado diretamente a partir da tabela `matches`.

As estatísticas incluem:

- partidas jogadas;
- vitórias;
- empates;
- derrotas;
- gols marcados;
- gols sofridos;
- saldo de gols;
- pontos;
- aproveitamento.

O sistema utiliza a pontuação tradicional de:

- **3 pontos** por vitória;
- **1 ponto** por empate;
- **0 pontos** por derrota.

Isso evita manter uma tabela de ranking duplicada que poderia ficar inconsistente em relação às partidas reais.

---

## Sistema de partidas

Cada partida possui:

- jogador 1;
- jogador 2;
- time do jogador 1;
- time do jogador 2;
- placar do jogador 1;
- placar do jogador 2;
- campeonato opcional;
- data/hora da partida.

### Partida avulsa

Quando nenhum campeonato é selecionado, a partida é registrada normalmente no histórico geral.

### Partida de campeonato

Quando um campeonato é selecionado, o sistema verifica se o confronto corresponde a um `fixture` pendente daquele campeonato.

Depois do registro:

1. a partida é salva;
2. o `fixture` correspondente recebe o `match_id`;
3. a classificação pode ser recalculada a partir das partidas;
4. em mata-mata, o vencedor pode avançar automaticamente para a próxima fase.

---

## Campeonatos

O FC Arena possui dois formatos principais.

### Pontos corridos

Formato `league`.

Ao criar o campeonato, o sistema recebe os participantes e gera automaticamente as rodadas utilizando um algoritmo de calendário.

O sistema suporta número par ou ímpar de participantes. Quando necessário, um participante fictício (`bye`) é utilizado internamente para gerar as rodadas.

Cada confronto fica registrado como um `fixture` e pode receber posteriormente o resultado da partida.

A classificação do campeonato é calculada somente com as partidas daquele campeonato.

### Mata-mata

Formato `knockout`.

O número de participantes permitido é:

- 2;
- 4;
- 8;
- 16;
- 32.

A fase inicial é determinada automaticamente:

| Participantes | Fase inicial |
|---:|---|
| 2 | Final |
| 4 | Semifinal |
| 8 | Quartas de final |
| 16 | Oitavas de final |
| 32 | Dezesseis-avos |

Empates são bloqueados nas fases eliminatórias.

Depois que todos os confrontos de uma fase são concluídos, os vencedores são identificados e os próximos confrontos são gerados automaticamente.

Quando apenas uma partida resta e ela é concluída, o campeonato é marcado como `finished`.

### Detalhes do campeonato

A tela de detalhes apresenta:

- participantes;
- classificação quando aplicável;
- calendário de rodadas;
- chave eliminatória;
- confrontos pendentes;
- partidas já registradas;
- placares dos confrontos concluídos.

O registro de resultado pode ser iniciado diretamente a partir de um confronto pendente do campeonato.

---

## Ranking

O ranking geral é baseado na seguinte consulta lógica:

```text
Vitória = 3 pontos
Empate  = 1 ponto
Derrota = 0 pontos
```

Em caso de empate na pontuação, a ordenação considera o saldo de gols, depois os gols marcados e, por fim, o nome do jogador.

O ranking de um campeonato utiliza somente as partidas cujo `championship_id` corresponde ao campeonato selecionado.

---

## Banco de dados

O FC Arena utiliza **SQLite** através do pacote `better-sqlite3`.

O banco é criado no diretório de dados do usuário do Electron com o nome:

```text
fc-arena.sqlite
```

### Tabelas principais

#### `players`

Armazena os jogadores cadastrados.

Campos principais:

- `id`
- `name`
- `nickname`
- `avatar`
- `created_at`

#### `teams`

Catálogo de clubes.

Campos:

- `id`
- `name`
- `league`
- `country`

#### `championships`

Armazena os campeonatos.

Campos:

- `id`
- `name`
- `format`
- `starts_at`
- `status`

Formatos previstos no modelo:

```text
league
knockout
groups_knockout
```

O formato `groups_knockout` está previsto no modelo do domínio, mas a criação dessa modalidade depende da implementação da funcionalidade correspondente.

#### `championship_participants`

Relaciona jogadores e campeonatos.

Possui uma chave composta:

```text
(championship_id, player_id)
```

#### `fixtures`

Representa os confrontos previstos em um campeonato.

Campos importantes:

- campeonato;
- rodada;
- fase;
- jogador 1;
- jogador 2;
- partida registrada.

#### `matches`

Fonte de verdade dos resultados.

Campos importantes:

- jogadores;
- times;
- placar;
- campeonato;
- data da partida.

---

## Integridade do banco

O SQLite é configurado com:

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
```

Também existem índices para consultas frequentes, como partidas por data, jogadores e fixtures por campeonato/rodada.

Relacionamentos importantes utilizam `ON DELETE` para controlar o comportamento das entidades relacionadas.

Operações que alteram várias tabelas são executadas dentro de transações SQLite para reduzir o risco de deixar o banco em estado inconsistente.

---

## Arquitetura

A aplicação segue uma arquitetura dividida em três partes principais:

```text
┌─────────────────────────────┐
│        React Renderer       │
│  Interface e estado da UI   │
└──────────────┬──────────────┘
               │
               │ window.arena
               ▼
┌─────────────────────────────┐
│          Preload             │
│ contextBridge + IPC          │
└──────────────┬──────────────┘
               │
               │ ipcRenderer.invoke
               ▼
┌─────────────────────────────┐
│      Electron Main           │
│       ipcMain.handle         │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│        Repository            │
│ Regras de negócio + SQLite   │
└─────────────────────────────┘
```

### Renderer

Responsável pela interface React, formulários, modais, listas e interação do usuário.

Arquivo principal:

```text
src/renderer/main.tsx
```

### Preload

Expõe somente a API necessária para o renderer usando `contextBridge`.

Arquivo:

```text
src/preload/index.ts
```

### Main

Executa o processo principal do Electron, cria a janela e registra os handlers IPC.

Arquivo:

```text
src/main/index.ts
```

### Repository

Centraliza acesso ao SQLite e regras de negócio.

Arquivo:

```text
src/main/repository.ts
```

### Shared

Contém os modelos TypeScript e o contrato da API utilizada entre renderer e processo principal.

Arquivos:

```text
src/shared/models.ts
src/shared/api.ts
```

---

## Tecnologias

| Tecnologia | Uso |
|---|---|
| Electron | Aplicação desktop |
| React | Interface |
| TypeScript | Tipagem e desenvolvimento |
| Vite | Build e servidor de desenvolvimento |
| SQLite | Banco de dados local |
| better-sqlite3 | Acesso ao SQLite |
| Lucide React | Ícones |
| Electron Builder | Empacotamento da aplicação |
| concurrently | Execução simultânea do frontend e Electron |
| wait-on | Espera pelo servidor Vite |
| csv-parser | Processamento de dados CSV |

Versões e scripts oficiais do projeto estão definidos no `package.json`.

---

## Estrutura do projeto

```text
campeonatin/
│
├── src/
│   ├── main/
│   │   ├── index.ts
│   │   ├── repository.ts
│   │   ├── clubRows.ts
│   │   └── scripts/
│   │       ├── generate-clubs.ts
│   │       └── FC26_20250921.csv
│   │
│   ├── preload/
│   │   └── index.ts
│   │
│   ├── renderer/
│   │   ├── main.tsx
│   │   ├── index.html
│   │   └── styles/
│   │       ├── app.css
│   │       └── fixtures.css
│   │
│   └── shared/
│       ├── api.ts
│       └── models.ts
│
├── package.json
├── package-lock.json
├── tsconfig.json
├── tsconfig.electron.json
├── vite.config.ts
├── check-db.js
├── clubRows.ts
├── FIXES_SUMMARY.md
└── README.md
```

---

## Instalação

Requisitos:

- Node.js;
- npm;
- Windows recomendado para o fluxo atual de empacotamento.

Clone o repositório:

```bash
git clone https://github.com/victorhenrique121/campeonatin.git
cd campeonatin
```

Instale as dependências:

```bash
npm install
```

Caso seja necessário utilizar o cache local de pacotes:

```powershell
npm install --cache .npm-cache
```

---

## Desenvolvimento

Execute:

```bash
npm run dev
```

Esse comando inicia o Vite e o processo Electron simultaneamente.

O Electron aguarda o servidor do Vite ficar disponível antes de abrir a aplicação.

### Verificação de tipos

Para verificar o TypeScript sem gerar arquivos:

```bash
npm run typecheck
```

---

## Build para Windows

O projeto utiliza Electron Builder com NSIS como alvo do Windows.

Execute:

```bash
npm run build
```

O processo realiza, em sequência:

1. compilação do código Electron;
2. build do frontend com Vite;
3. empacotamento através do Electron Builder.

O aplicativo utiliza o identificador:

```text
com.fcarena.desktop
```

E o nome do produto:

```text
FC Arena
```

---

## Backup e restauração

O aplicativo possui funções para:

### Backup

O usuário escolhe o local onde deseja salvar uma cópia do banco SQLite.

Nome sugerido:

```text
fc-arena-backup.sqlite
```

### Restauração

O usuário seleciona um arquivo SQLite compatível. Depois da restauração, o aplicativo é reiniciado para utilizar o banco restaurado.

> Recomenda-se fazer um backup antes de restaurar uma versão anterior do banco.

---

## Validações

O sistema possui validações tanto na interface quanto no processo principal.

Entre elas:

- nome e apelido de jogador obrigatórios;
- apelido de jogador único;
- pelo menos dois participantes em campeonatos;
- quantidade válida de participantes para mata-mata;
- jogadores diferentes em uma partida;
- times diferentes em uma partida;
- jogadores e times existentes no banco;
- campeonato existente quando selecionado;
- placares inteiros e não negativos;
- confronto pertencente ao campeonato selecionado;
- empate bloqueado em fases eliminatórias.

A validação no processo principal é importante porque impede que a interface seja a única camada responsável pela integridade dos dados.

---

## Como funciona o fluxo de dados

Exemplo: registrar uma partida.

```text
Usuário
  │
  ▼
Formulário React
  │
  ▼
window.arena.saveMatch(...)
  │
  ▼
preload / ipcRenderer.invoke
  │
  ▼
ipcMain.handle("matches:save")
  │
  ▼
repository.saveMatch(...)
  │
  ▼
SQLite
```

O caminho inverso ocorre quando os dados são retornados para a interface.

Essa separação mantém o acesso ao banco fora do renderer e aproveita o isolamento de contexto do Electron.

---

## Modelo de dados

Os principais modelos TypeScript são:

### Player

```ts
type Player = {
  id: number;
  name: string;
  nickname: string;
  avatar?: string;
  createdAt: string;
};
```

### Team

```ts
type Team = {
  id: number;
  name: string;
  league: string;
  country: string;
};
```

### Match

Representa uma partida já registrada, incluindo jogadores, times, placar e campeonato opcional.

### Championship

```ts
type Championship = {
  id: number;
  name: string;
  format: "league" | "knockout" | "groups_knockout";
  startsAt: string;
  status: "draft" | "active" | "finished";
  participants: number;
};
```

### Fixture

Representa um confronto previsto dentro de um campeonato antes ou depois do registro do resultado.

### ChampionshipDetail

Agrupa os dados do campeonato, sua classificação e seus confrontos.

---

## API IPC

A API compartilhada define operações para:

```text
dashboard
players
savePlayer
deletePlayer
teams
matches
saveMatch
updateMatch
clearMatches
ranking
championships
championshipDetail
saveChampionship
backup
restore
```

O objetivo é manter um contrato tipado entre o frontend e o processo principal.

---

## Segurança da aplicação

O BrowserWindow utiliza:

```ts
contextIsolation: true
nodeIntegration: false
```

O renderer não recebe acesso direto às APIs Node.js nem ao SQLite.

A comunicação ocorre através do `contextBridge`, com uma superfície de API controlada.

---

## Migrações e inicialização do banco

Na inicialização, o repository:

1. abre ou cria o banco SQLite;
2. habilita foreign keys;
3. habilita WAL;
4. cria as tabelas necessárias caso ainda não existam;
5. cria índices;
6. executa ajustes de estrutura quando necessários;
7. garante que o catálogo de clubes esteja disponível.

Isso permite que uma instalação nova seja inicializada sem precisar criar manualmente as tabelas.

---

## Scripts disponíveis

### Desenvolvimento

```bash
npm run dev
```

Inicia Vite + Electron.

### Electron em desenvolvimento

```bash
npm run dev:electron
```

Aguarda a porta do Vite e inicia o Electron.

### Typecheck

```bash
npm run typecheck
```

Executa a verificação TypeScript do frontend e do código Electron.

### Build

```bash
npm run build
```

Compila e empacota o aplicativo.

---

## Roadmap

Funcionalidades que podem ser adicionadas ou expandidas no projeto:

- [ ] grupos + mata-mata;
- [ ] edição completa de participantes de campeonatos antes do início;
- [ ] encerramento manual de campeonatos de pontos corridos;
- [ ] estatísticas avançadas por campeonato;
- [ ] histórico por jogador;
- [ ] confrontos diretos;
- [ ] sistema Elo;
- [ ] conquistas e recordes;
- [ ] temporadas;
- [ ] filtros e pesquisa avançada no histórico;
- [ ] gráficos de desempenho;
- [ ] exportação de estatísticas;
- [ ] melhorias adicionais de UX e responsividade;
- [ ] sincronização entre dispositivos.

---

## Filosofia do projeto

O FC Arena prioriza três princípios:

1. **Dados locais:** as informações ficam no computador do usuário.
2. **Fonte de verdade única:** resultados de partidas são a base para rankings e estatísticas.
3. **Regras no backend:** regras importantes não dependem somente da interface para serem respeitadas.

---

## Licença

Este projeto não possui uma licença open source definida atualmente.

Todos os direitos sobre o código permanecem com o autor enquanto uma licença não for adicionada ao repositório.

---

## Repositório

[GitHub — victorhenrique121/campeonatin](https://github.com/victorhenrique121/campeonatin)
