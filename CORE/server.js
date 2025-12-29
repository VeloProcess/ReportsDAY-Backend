/**
 * CORE - Servidor Principal
 * 55SYSTEM - ETL e Notificação
 * 
 * Servidor Express + WebSocket na porta 3005
 */

import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import dotenv from 'dotenv';

import routes from './routes.js';
import { initWebSocket } from './websocket.js';
import { initScheduler } from './scheduler.js';
import dbService from '../DB-Reports/service.js';

// Carrega variáveis de ambiente
dotenv.config();

// Porta do servidor (Backend: 3005, Frontend: 8080)
const PORT = process.env.PORT || 3005;

// Cria app Express
const app = express();

// Middlewares
app.use(cors({
  origin: '*', // Em produção, especifique as origens permitidas
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'token'],
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Log de requisições
app.use((req, res, next) => {
  const timestamp = new Date().toLocaleTimeString('pt-BR');
  console.log(`[${timestamp}] ${req.method} ${req.path}`);
  next();
});

// Rotas
app.use(routes);

// Rota raiz
app.get('/', (req, res) => {
  res.json({
    name: '55SYSTEM',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      webhook: 'POST /webhook/55pbx',
      status: 'GET /api/status',
      reportD0: 'GET /api/report/d0',
      history: 'GET /api/history',
      trigger: 'POST /api/trigger',
      health: 'GET /health',
      websocket: 'WS /ws',
    },
  });
});

// Handler de erro 404
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint não encontrado' });
});

// Handler de erro global
app.use((err, req, res, next) => {
  console.error('❌ Erro não tratado:', err);
  res.status(500).json({ error: 'Erro interno do servidor' });
});

// Cria servidor HTTP
const server = createServer(app);

/**
 * Inicializa o servidor
 */
async function start() {
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║                    55SYSTEM - CORE                        ║');
  console.log('║              ETL + Notificação + Painel                   ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('\n');
  
  try {
    // 1. Inicializa armazenamento de dados
    await dbService.connect();
    
    // 2. Inicializa WebSocket
    console.log('🔗 Inicializando WebSocket...');
    initWebSocket(server);
    
    // 3. Inicializa Scheduler
    console.log('⏰ Configurando agendamentos...');
    initScheduler();
    
    // 4. Inicia o servidor
    server.listen(PORT, () => {
      console.log('\n');
      console.log('╔══════════════════════════════════════════════════════════╗');
      console.log(`║           ✅ SERVIDOR RODANDO NA PORTA ${PORT}              ║`);
      console.log('╚══════════════════════════════════════════════════════════╝');
      console.log('\n');
      console.log('📡 Endpoints disponíveis:');
      console.log(`   • Webhook 55PBX: POST http://localhost:${PORT}/webhook/55pbx`);
      console.log(`   • API Status:    GET  http://localhost:${PORT}/api/status`);
      console.log(`   • Relatório D0:  GET  http://localhost:${PORT}/api/report/d0`);
      console.log(`   • WebSocket:     WS   ws://localhost:${PORT}/ws`);
      console.log('\n');
      console.log('🖥️  Painel ReportsDAY:');
      console.log('   Abra o arquivo FRONT-END PAINEL/index.html no navegador');
      console.log('\n');
    });
    
  } catch (error) {
    console.error('\n❌ Erro fatal ao iniciar servidor:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Handler de encerramento gracioso
process.on('SIGINT', async () => {
  console.log('\n\n🛑 Encerrando servidor...');
  
  try {
    await dbService.disconnect();
    server.close();
    console.log('👋 Servidor encerrado com sucesso\n');
    process.exit(0);
  } catch (error) {
    console.error('Erro ao encerrar:', error.message);
    process.exit(1);
  }
});

process.on('SIGTERM', () => process.emit('SIGINT'));

// Inicia o servidor
start();

