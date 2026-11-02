'use strict';

const express = require('express');
const crypto = require('node:crypto');

function createAuditRouter({ auditService, middleware, rolesService, complaintsService }) {
  const router = express.Router();
  const { requireAuth } = middleware;
  if (!rolesService || typeof rolesService.requirePermission !== 'function') {
    throw new Error('Role enforcement service is required for protected routes.');
  }
  const requirePermission = (action) => rolesService.requirePermission(action);

  router.get('/audit', requireAuth, requirePermission('audit.read'), (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : 500;
    const events = auditService.listEvents({ limit });
    res.json({ events, count: events.length });
  });

  router.get('/audit/verify', requireAuth, requirePermission('audit.verify'), (req, res) => {
    const result = auditService.verifyChain();
    res.status(result.ok ? 200 : 409).json(result);
  });

  // Authenticated verification; this code never creates a public citizen-data URL.
  router.post('/documents/reply/:id',requireAuth,requirePermission('export.xlsx'),middleware.requireCsrf,(req,res)=>{
    const complaint=complaintsService.readState().state.complaints.find(c=>c.id===req.params.id);
    if(!complaint?.reply||!['approved','sent'].includes(complaint.reply.status))return res.status(409).json({error:'يلزم رد معتمد قبل الطباعة.'});
    const chain=auditService.verifyChain();if(!chain.ok)return res.status(409).json({error:'فشل التحقق من سلامة سجل التدقيق.'});
    const payload={id:complaint.id,text:complaint.reply.text,author:complaint.reply.author};
    const digest=crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const proof=auditService.record(req.user.id,'reply_document_issued','complaint',complaint.id,{digest});
    res.set('Cache-Control','no-store');res.json({code:proof.eventHash,digest,payload,issuedAt:new Date().toISOString()});
  });
  router.get('/documents/verify/:code',requireAuth,requirePermission('complaints.read'),(req,res)=>{
    const code=req.params.code;if(!/^[a-f0-9]{64}$/.test(code))return res.status(400).json({error:'رمز التحقق غير صالح.'});
    const event=auditService.findDocumentProof(code);
    if(!event)return res.status(404).json({error:'لم يُعثر على مستند بهذا الرمز.'});
    const chain=auditService.verifyChain();
    const complaint=complaintsService.readState().state.complaints.find(c=>c.id===event.targetId);
    const payload=complaint?.reply?{id:complaint.id,text:complaint.reply.text,author:complaint.reply.author}:null;
    const currentDigest=payload?crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex'):null;
    res.set('Cache-Control','no-store');res.json({valid:chain.ok&&currentDigest===event.digest,id:event.targetId,issuedAt:event.createdAt,chainValid:chain.ok,text:payload?.text||null});
  });

  return router;
}

module.exports = { createAuditRouter };
