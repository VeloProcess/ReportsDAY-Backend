/**
 * CORE - Rotas da API
 * 
 * Define todas as rotas REST do servidor
 */

import { Router } from 'express';
import api55Service from '../API-55PBX/service.js';
import api55Config from '../API-55PBX/config.js';
import dbService from '../DB-Reports/service.js';
import whatsappService from '../API-WHATSAPP/service.js';
import scheduler from './scheduler.js';
import websocket from './websocket.js';

const router = Router();

// =============================================
// Webhook 55PBX
// =============================================

/**
 * POST /webhook/55pbx
 * Recebe webhooks da 55PBX com dados de chamadas
 */
router.post('/webhook/55pbx', async (req, res) => {
  try {
    // Valida token
    const receivedToken = req.headers['token'] || req.headers['authorization'];
    if (!api55Service.validateToken(receivedToken)) {
      console.warn('⚠️  Webhook: Token inválido recebido');
      return res.status(401).json({ error: 'Token inválido' });
    }
    
    // Processa o webhook
    const result = await api55Service.processWebhook(req.body);
    
    // Notifica o painel via WebSocket
    if (result.processed) {
      websocket.notifyNewCall({
        callId: result.callId,
        status: result.classification,
      });
    }
    
    res.json({ success: true, ...result });
    
  } catch (error) {
    console.error('❌ Webhook: Erro:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /webhook/55pbx (alguns sistemas usam PUT)
 */
router.put('/webhook/55pbx', async (req, res) => {
  // Redireciona para o handler POST
  req.method = 'POST';
  return router.handle(req, res);
});

// =============================================
// API Status
// =============================================

/**
 * GET /api/status
 * Retorna status geral do sistema
 */
router.get('/api/status', async (req, res) => {
  try {
    const [whatsappStatus, cacheExists, cacheTTL, callCount] = await Promise.all([
      whatsappService.getStatus(),
      dbService.hasCache(),
      dbService.getCacheTTL(),
      dbService.countTodayCalls(),
    ]);
    
    res.json({
      whatsapp: {
        status: whatsappStatus.connected ? 'connected' : 
                whatsappStatus.configured ? 'disconnected' : 'not_configured',
        configured: whatsappStatus.configured,
      },
      redis: {
        connected: dbService.getStatus().connected,
        hasCache: cacheExists,
        ttl: cacheTTL > 0 ? cacheTTL : null,
        callCount,
      },
      api55: {
        configured: !!api55Config.token,
      },
      nextRun: scheduler.getNextRun()?.toISOString(),
      wsClients: websocket.getClientCount(),
    });
    
  } catch (error) {
    console.error('❌ API Status: Erro:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// =============================================
// API Relatório D0
// =============================================

/**
 * GET /api/report/d0
 * Retorna os KPIs do dia atual
 */
router.get('/api/report/d0', async (req, res) => {
  try {
    const kpis = await api55Service.calculateDayKPIs();
    res.json(kpis);
  } catch (error) {
    console.error('❌ API D0: Erro:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/report/analise
 * Retorna análise comparativa: hoje vs últimos 15 dias
 */
router.get('/api/report/analise', async (req, res) => {
  try {
    const analise = await api55Service.analisarDiaAtual();
    res.json(analise);
  } catch (error) {
    console.error('❌ API Análise: Erro:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/report/historico
 * Retorna histórico dos últimos N dias (padrão: 15)
 */
router.get('/api/report/historico', async (req, res) => {
  try {
    const dias = parseInt(req.query.dias) || 15;
    const historico = await api55Service.fetchHistoricalData(dias);
    res.json(historico);
  } catch (error) {
    console.error('❌ API Histórico: Erro:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// =============================================
// API Histórico
// =============================================

/**
 * GET /api/history
 * Retorna histórico de execuções
 */
router.get('/api/history', (req, res) => {
  try {
    const history = scheduler.getHistory();
    res.json({ history });
  } catch (error) {
    console.error('❌ API History: Erro:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// =============================================
// API Trigger Manual
// =============================================

/**
 * POST /api/trigger
 * Dispara o relatório manualmente
 */
router.post('/api/trigger', async (req, res) => {
  try {
    websocket.broadcastLog('Disparo manual solicitado', 'event');
    
    // Executa em background para não bloquear a resposta
    scheduler.executeReport().catch(err => {
      console.error('Trigger: Erro na execução:', err.message);
    });
    
    res.json({ 
      success: true, 
      message: 'Relatório sendo gerado...',
    });
    
  } catch (error) {
    console.error('❌ API Trigger: Erro:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// =============================================
// API Next Run
// =============================================

/**
 * GET /api/next-run
 * Retorna o próximo horário de disparo
 */
router.get('/api/next-run', (req, res) => {
  try {
    const nextRun = scheduler.getNextRun();
    res.json({ 
      nextRun: nextRun?.toISOString(),
      formatted: nextRun?.toLocaleString('pt-BR'),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =============================================
// Health Check
// =============================================

/**
 * GET /health
 * Health check para monitoramento
 */
router.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

export default router;

