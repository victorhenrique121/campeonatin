# FC Arena

Aplicação desktop local para organizar partidas e campeonatos de EA Sports FC entre amigos.

## Executar

```powershell
npm install --cache .npm-cache
npm run dev
```

Os dados ficam em um arquivo SQLite no diretório de dados do aplicativo. O processo principal do Electron é o único que acessa esse arquivo; a interface usa uma API IPC com contexto isolado.

## Primeira entrega

- Dashboard com métricas, ranking e últimas partidas.
- Cadastro/exclusão de jogadores e catálogo local de clubes.
- Registro de resultado, histórico e ranking calculado diretamente das partidas.
- Criação de campeonatos de pontos corridos com participantes.
- Backup do banco SQLite pelo aplicativo.

O ranking é derivado da fonte de verdade (`matches`), em vez de ser salvo e suscetível a inconsistências. A migração inicial já contempla campeonatos, participantes e integridade referencial, deixando espaço para calendário, fases eliminatórias, Elo, temporadas, conquistas e sincronização de rede.
