const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const mockServer = require('./mock-supabase.cjs');

async function runTests() {
  console.log('🧪 Iniciando Execução do Test Harness — Etapa 4 (matches)...');
  await mockServer.start();

  try {
    // 1. Modo Legado (sem .env / sem Supabase)
    console.log('\n[Cenário 1] Modo Legado (Sem .env / Supabase não configurado)');
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
    
    // Import do repositório/service após limpar envs
    const repository = require('../../dist-electron/main/repository.js');
    const matchesService = require('../../dist-electron/main/matches-service.js');
    
    repository.initDb();
    repository.clearMatches();

    const legacyMatch = await matchesService.saveMatch({
      player1Id: 1,
      player2Id: 2,
      team1Id: 10,
      team2Id: 20,
      score1: 2,
      score2: 1,
      championshipId: null,
      playedAt: new Date().toISOString(),
    });

    assert.ok(legacyMatch.id > 0, 'Partida deve ter um ID gerado localmente');
    console.log('  ✅ Sucesso: Salvo no modo legado sem erros.');

    // 2. Escrita Remota Bem-sucedida (championship_id = null no remoto)
    console.log('\n[Cenário 2] Escrita Remota com championship_id NULL no Supabase');
    mockServer.resetDb();
    process.env.SUPABASE_URL = `http://localhost:${mockServer.PORT}`;
    process.env.SUPABASE_ANON_KEY = 'mock-anon-key';
    process.env.SUPABASE_APP_EMAIL = 'service@fcarena.local';
    process.env.SUPABASE_APP_PASSWORD = 'password123';

    const supabaseModule = require('../../dist-electron/main/supabase.js');
    await supabaseModule.initSupabase();

    const remoteMatch = await matchesService.saveMatch({
      player1Id: 1,
      player2Id: 2,
      team1Id: 10,
      team2Id: 20,
      score1: 3,
      score2: 0,
      championshipId: 99, // ID local do campeonato
      playedAt: new Date().toISOString(),
    });

    const mockRecord = mockServer.db.matches.find((m) => m.id === remoteMatch.id);
    assert.ok(mockRecord, 'A partida deve estar salva no Supabase');
    assert.strictEqual(mockRecord.championship_id, null, 'championship_id deve ser NULL no Supabase remoto');
    
    const localMatch = repository.getMatches().find((m) => m.id === remoteMatch.id);
    assert.strictEqual(localMatch.championshipId, 99, 'championshipId local deve ser mantido intacto');
    console.log('  ✅ Sucesso: Gravado no Supabase com championship_id NULL e espelhado no SQLite com championshipId=99.');

    // 3. Offline (Erro amigável no save, sem divergência)
    console.log('\n[Cenário 3] Offline (Servidor indisponível)');
    await mockServer.stop(); // Simula servidor fora do ar

    const countBefore = repository.getMatches().length;
    let offlineError = null;

    try {
      await matchesService.saveMatch({
        player1Id: 1,
        player2Id: 2,
        team1Id: 10,
        team2Id: 20,
        score1: 1,
        score2: 1,
        playedAt: new Date().toISOString(),
      });
    } catch (err) {
      offlineError = err;
    }

    assert.ok(offlineError, 'Deveria ter lançado erro amigável ao estar offline');
    assert.strictEqual(
      repository.getMatches().length,
      countBefore,
      'Não deve salvar nada no SQLite local quando a gravação remota falhar'
    );
    console.log('  ✅ Sucesso: Lançou erro amigável e preveniu divergência no SQLite.');

    // Reinicia o server mock
    await mockServer.start();

    // 4. Sem Conta de Serviço
    console.log('\n[Cenário 4] Sem Conta de Serviço / Falha de Auth');
    delete process.env.SUPABASE_APP_PASSWORD;
    await supabaseModule.initSupabase();

    let authError = null;
    try {
      await matchesService.saveMatch({
        player1Id: 1,
        player2Id: 2,
        team1Id: 10,
        team2Id: 20,
        score1: 1,
        score2: 0,
        playedAt: new Date().toISOString(),
      });
    } catch (err) {
      authError = err;
    }

    assert.ok(authError, 'Deveria falhar na ausência de autenticação');
    console.log('  ✅ Sucesso: Operação bloqueada e tratada.');

    // 5. Preservação do championship_id no syncMirror
    console.log('\n[Cenário 5] Regra do syncMirror preservando championship_id local');
    process.env.SUPABASE_APP_PASSWORD = 'password123';
    await supabaseModule.initSupabase();

    // Cria partida no SQLite vinculada ao campeonato 42
    const targetMatch = repository.saveMatch({
      player1Id: 1,
      player2Id: 2,
      team1Id: 10,
      team2Id: 20,
      score1: 0,
      score2: 0,
      championshipId: 42,
      playedAt: new Date().toISOString(),
    });

    // Insere versão remota no mock com championship_id: null e placar alterado (2x2)
    mockServer.db.matches.push({
      id: targetMatch.id,
      player1_id: 1,
      player2_id: 2,
      team1_id: 10,
      team2_id: 20,
      score1: 2,
      score2: 2,
      championship_id: null,
      played_at: targetMatch.playedAt,
      created_by: '00000000-0000-0000-0000-000000000001',
    });

    await matchesService.syncMirrorMatches();

    const syncedLocal = repository.getMatches().find((m) => m.id === targetMatch.id);
    assert.strictEqual(syncedLocal.score1, 2, 'Placar atualizado via syncMirror');
    assert.strictEqual(syncedLocal.championshipId, 42, 'championshipId LOCAL NÃO foi sobrescrito pelo NULL remoto');
    console.log('  ✅ Sucesso: syncMirror atualizou dados remotos mantendo o championshipId local.');

    console.log('\n🎉 TODOS OS TESTES DA ETAPA 4 PASSARAM COM SUCESSO!\n');
  } catch (error) {
    console.error('\n❌ TESTE FALHOU:', error);
    process.exitCode = 1;
  } finally {
    await mockServer.stop();
  }
}

runTests();