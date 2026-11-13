const AffiliateConsent = require('../models/AffiliateConsent');
const AffiliateSupportEntitlement = require('../models/AffiliateSupportEntitlement');
const AffiliateSupportSession = require('../models/AffiliateSupportSession');
const User = require('../models/User');
const { decryptSupportNote, encryptSupportNote } = require('../utils/affiliateSupportCrypto');
const { runInTransaction } = require('./affiliateLedgerService');
const { writeAudit } = require('./affiliateAuditService');
const { assertAffiliateFeatureEnabled } = require('./affiliateConfigService');

function supportError(message, statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

function validateSchedule(value, startsAt, endsAt) {
    const scheduledAt = new Date(value);
    if (!Number.isFinite(scheduledAt.getTime()) || scheduledAt <= new Date()
        || scheduledAt < startsAt || scheduledAt > endsAt) {
        throw supportError('Select a future appointment time within the support entitlement period.');
    }
    return scheduledAt;
}

async function assertSupportConsent(customer, version, session) {
    let query = AffiliateConsent.exists({
        user: customer,
        purpose: 'DOCTOR_SUPPORT',
        version,
        granted: true,
    });
    if (session) query = query.session(session);
    if (!await query) throw supportError('Current doctor-support consent is required.', 403);
}

async function scheduleSession({ customer, entitlementId, scheduledAt, req }) {
    const config = await assertAffiliateFeatureEnabled();
    return runInTransaction(async (session) => {
        const entitlement = await AffiliateSupportEntitlement.findOne({
            _id: entitlementId,
            customer,
            status: 'ACTIVE',
        }).session(session);
        if (!entitlement || entitlement.endsAt <= new Date()) {
            throw supportError('Active support entitlement was not found.', 404);
        }
        if (entitlement.usedSessions >= entitlement.totalSessions) {
            throw supportError('All support sessions have already been reserved.', 409);
        }
        await assertSupportConsent(customer, config.supportConsentVersion, session);
        const at = validateSchedule(scheduledAt, entitlement.startsAt, entitlement.endsAt);
        entitlement.usedSessions += 1;
        if (entitlement.usedSessions >= entitlement.totalSessions) entitlement.status = 'EXHAUSTED';
        await entitlement.save({ session });
        const [created] = await AffiliateSupportSession.create([{
            entitlement: entitlement._id,
            customer,
            scheduledAt: at,
            status: 'SCHEDULED',
            customerConsentAt: new Date(),
            createdBy: customer,
        }], { session });
        await writeAudit({
            actor: customer,
            action: 'AFFILIATE_SUPPORT_SESSION_SCHEDULED',
            resourceType: 'AffiliateSupportSession',
            resourceId: created._id,
            after: { entitlement: entitlement._id, scheduledAt: at },
            req,
            session,
        });
        return created;
    });
}

async function listSupportSessions({ user, roles, page = 1, limit = 25 }) {
    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 25));
    let filter;
    if (roles.includes('doctor')) {
        filter = { assignedDoctor: user };
    } else if (roles.includes('support_agent')) {
        filter = { assignedAgent: user };
    } else if (roles.includes('affiliate_manager') || roles.includes('super_admin')) {
        filter = {};
    } else if (roles.includes('customer')) {
        filter = { customer: user };
    } else {
        throw supportError('You are not allowed to view support sessions.', 403);
    }
    const [items, total] = await Promise.all([
        AffiliateSupportSession.find(filter)
            .sort({ scheduledAt: -1, createdAt: -1 })
            .skip((safePage - 1) * safeLimit)
            .limit(safeLimit)
            .select('-notesEncrypted -notesIv -notesAuthTag')
            .lean(),
        AffiliateSupportSession.countDocuments(filter),
    ]);
    return { items, page: safePage, limit: safeLimit, total };
}

async function assignSupportSession({ sessionId, doctorId, agentId, actor, req }) {
    const [doctor, agent] = await Promise.all([
        doctorId ? User.findById(doctorId).select('roles accountStatus') : null,
        agentId ? User.findById(agentId).select('roles accountStatus') : null,
    ]);
    if (doctorId && (!doctor || doctor.accountStatus !== 'ACTIVE' || !doctor.roles.includes('doctor'))) {
        throw supportError('An active doctor account is required for doctor assignment.');
    }
    if (agentId && (!agent || agent.accountStatus !== 'ACTIVE' || !agent.roles.includes('support_agent'))) {
        throw supportError('An active support agent account is required for support assignment.');
    }
    return runInTransaction(async (session) => {
        const record = await AffiliateSupportSession.findById(sessionId).session(session);
        if (!record || ['COMPLETED', 'CANCELLED'].includes(record.status)) {
            throw supportError('Support session cannot be assigned in its current state.', 409);
        }
        const before = { assignedDoctor: record.assignedDoctor, assignedAgent: record.assignedAgent };
        if (doctorId !== undefined) record.assignedDoctor = doctorId || null;
        if (agentId !== undefined) record.assignedAgent = agentId || null;
        await record.save({ session });
        await writeAudit({
            actor,
            action: 'AFFILIATE_SUPPORT_SESSION_ASSIGNED',
            resourceType: 'AffiliateSupportSession',
            resourceId: record._id,
            before,
            after: { assignedDoctor: record.assignedDoctor, assignedAgent: record.assignedAgent },
            req,
            session,
        });
        return record;
    });
}

async function updateSupportOutcome({ sessionId, actor, roles, status, outcomeCode, notes, req }) {
    const allowedStatuses = ['COMPLETED', 'CUSTOMER_UNAVAILABLE', 'MISSED'];
    if (!allowedStatuses.includes(status)) throw supportError('Unsupported support session outcome.');
    if (notes !== undefined && (typeof notes !== 'string' || notes.length > 10000)) {
        throw supportError('Support notes must be text with a maximum of 10,000 characters.');
    }
    const isDoctor = roles.includes('doctor');
    if (notes?.trim() && !isDoctor) throw supportError('Only the assigned doctor may record clinical notes.', 403);
    return runInTransaction(async (session) => {
        const record = await AffiliateSupportSession.findById(sessionId).session(session);
        if (!record || record.status !== 'SCHEDULED') {
            throw supportError('Only scheduled sessions can be marked with an outcome.', 409);
        }
        if (isDoctor && String(record.assignedDoctor || '') !== String(actor)) {
            throw supportError('Doctors may only update sessions assigned to them.', 403);
        }
        if (!isDoctor && String(record.assignedAgent || '') !== String(actor)) {
            throw supportError('Support agents may only update sessions assigned to them.', 403);
        }
        if (notes?.trim()) {
            const encrypted = encryptSupportNote(notes.trim());
            record.notesEncrypted = encrypted.encrypted;
            record.notesIv = encrypted.iv;
            record.notesAuthTag = encrypted.authTag;
        }
        record.status = status;
        record.outcomeCode = outcomeCode ? String(outcomeCode).slice(0, 80) : null;
        if (status === 'COMPLETED') record.completedAt = new Date();
        await record.save({ session });
        await writeAudit({
            actor,
            action: 'AFFILIATE_SUPPORT_SESSION_OUTCOME_RECORDED',
            resourceType: 'AffiliateSupportSession',
            resourceId: record._id,
            after: { status, outcomeCode: record.outcomeCode, hasClinicalNotes: Boolean(notes?.trim()) },
            req,
            session,
        });
        return record;
    });
}

async function getDoctorNotes({ sessionId, doctor, req }) {
    const record = await AffiliateSupportSession.findOne({ _id: sessionId, assignedDoctor: doctor })
        .select('+notesEncrypted +notesIv +notesAuthTag');
    if (!record) throw supportError('Assigned support session was not found.', 404);
    const notes = record.notesEncrypted
        ? decryptSupportNote(record.notesEncrypted, record.notesIv, record.notesAuthTag)
        : null;
    await writeAudit({
        actor: doctor,
        action: 'AFFILIATE_SUPPORT_NOTES_ACCESSED',
        resourceType: 'AffiliateSupportSession',
        resourceId: record._id,
        after: { hasNotes: Boolean(notes) },
        req,
    });
    return { sessionId: record._id, notes };
}

module.exports = {
    assignSupportSession,
    getDoctorNotes,
    listSupportSessions,
    scheduleSession,
    updateSupportOutcome,
};
