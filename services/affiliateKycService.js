const crypto = require('crypto');
const AffiliateProfile = require('../models/AffiliateProfile');
const AffiliateKyc = require('../models/AffiliateKyc');
const AffiliateKycDocument = require('../models/AffiliateKycDocument');
const AffiliateConsent = require('../models/AffiliateConsent');
const { encryptKycData, hashKycIdentifier } = require('../utils/kycEncryption');
const { runInTransaction } = require('./affiliateLedgerService');
const { writeAudit } = require('./affiliateAuditService');
const { assertAffiliateFeatureEnabled } = require('./affiliateConfigService');

function kycError(message, statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

function detectDocumentMime(buffer) {
    if (buffer.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
    if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
    return null;
}

function validateDocument(file, fieldName) {
    if (!file) throw kycError(`${fieldName} is required.`);
    const detected = detectDocumentMime(file.buffer);
    if (!detected || detected !== file.mimetype || file.size > 3 * 1024 * 1024) {
        throw kycError(`${fieldName} must be a valid PDF, JPEG or PNG document no larger than 3 MB.`);
    }
}

async function submitKyc(userId, input, files, req) {
    const config = await assertAffiliateFeatureEnabled();
    const affiliate = await AffiliateProfile.findOne({ user: userId });
    if (!affiliate) throw kycError('Affiliate profile not found.', 404);
    const pan = typeof input.pan === 'string' ? input.pan.trim().toUpperCase() : '';
    if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(pan)) throw kycError('Enter a valid PAN number.');
    const address = input.address || {};
    if (typeof input.legalName !== 'string' || !input.legalName.trim()
        || !input.dateOfBirth || typeof address.line1 !== 'string' || !address.line1.trim()
        || typeof address.city !== 'string' || !address.city.trim()
        || typeof address.state !== 'string' || !address.state.trim()
        || typeof address.postalCode !== 'string' || !address.postalCode.trim()) {
        throw kycError('Legal name, date of birth and complete address are required.');
    }
    const dateOfBirth = new Date(input.dateOfBirth);
    if (!Number.isFinite(dateOfBirth.getTime()) || dateOfBirth > new Date()) {
        throw kycError('Enter a valid date of birth.');
    }
    if (!await AffiliateConsent.exists({
        user: userId,
        purpose: 'PAYOUT_KYC',
        version: config.kycConsentVersion,
        granted: true,
    })) {
        throw kycError('Current KYC and payout privacy consent is required before uploading documents.', 403);
    }
    const panDocument = files?.panDocument?.[0];
    const identityDocument = files?.identityDocument?.[0];
    validateDocument(panDocument, 'PAN document');
    validateDocument(identityDocument, 'Identity document');

    const panEncrypted = encryptKycData(Buffer.from(pan, 'utf8'));
    const panHash = hashKycIdentifier(pan);
    const existing = await AffiliateKyc.findOne({ affiliate: affiliate._id }).sort({ version: -1 });
    if (existing?.status === 'APPROVED') throw kycError('Approved KYC cannot be replaced without an administrator review.', 409);

    return runInTransaction(async (session) => {
        const version = (existing?.version || 0) + 1;
        const [application] = await AffiliateKyc.create([{
            affiliate: affiliate._id,
            version,
            status: 'SUBMITTED',
            legalName: input.legalName.trim(),
            dateOfBirth,
            panEncrypted: panEncrypted.encrypted,
            panIv: panEncrypted.iv,
            panAuthTag: panEncrypted.authTag,
            panHash,
            panLastFour: pan.slice(-4),
            address: {
                line1: address.line1.trim(),
                line2: typeof address.line2 === 'string' ? address.line2.trim() : '',
                city: address.city.trim(),
                state: address.state.trim(),
                postalCode: address.postalCode.trim(),
            },
            submittedAt: new Date(),
        }], { session });
        for (const [type, file] of [['PAN', panDocument], ['IDENTITY', identityDocument]]) {
            const encrypted = encryptKycData(file.buffer);
            await AffiliateKycDocument.create([{
                application: application._id,
                affiliate: affiliate._id,
                type,
                originalName: file.originalname.replace(/[^\w.-]/g, '_').slice(0, 180),
                mimeType: file.mimetype,
                encryptedContents: encrypted.encrypted,
                iv: encrypted.iv,
                authTag: encrypted.authTag,
                sha256: crypto.createHash('sha256').update(file.buffer).digest('hex'),
            }], { session });
        }
        await writeAudit({
            actor: userId,
            action: 'AFFILIATE_KYC_SUBMITTED',
            resourceType: 'AffiliateKyc',
            resourceId: application._id,
            after: { version, status: application.status, panLastFour: application.panLastFour },
            req,
            session,
        });
        return application;
    });
}

async function getOwnKycStatus(userId) {
    const affiliate = await AffiliateProfile.findOne({ user: userId }).select('_id');
    if (!affiliate) throw kycError('Affiliate profile not found.', 404);
    return AffiliateKyc.findOne({ affiliate: affiliate._id }).sort({ version: -1 })
        .select('version status panLastFour submittedAt reviewedAt rejectionReason')
        .lean();
}

async function reviewKyc({ applicationId, decision, reason, actor, req }) {
    if (!['APPROVED', 'REJECTED'].includes(decision)) throw kycError('Decision must be APPROVED or REJECTED.');
    if (decision === 'REJECTED' && (!reason || reason.trim().length < 5)) {
        throw kycError('Provide a clear KYC rejection reason.');
    }
    return runInTransaction(async (session) => {
        const application = await AffiliateKyc.findById(applicationId).session(session);
        if (!application || !['SUBMITTED', 'UNDER_REVIEW'].includes(application.status)) {
            throw kycError('KYC application was not found or was already reviewed.', 409);
        }
        const previous = application.status;
        application.status = decision;
        application.reviewedBy = actor;
        application.reviewedAt = new Date();
        application.rejectionReason = decision === 'REJECTED' ? reason.trim() : null;
        await application.save({ session });
        await writeAudit({
            actor,
            action: `AFFILIATE_KYC_${decision}`,
            resourceType: 'AffiliateKyc',
            resourceId: application._id,
            reason,
            before: { status: previous },
            after: { status: application.status, version: application.version },
            req,
            session,
        });
        return application;
    });
}

async function getKycDocument(documentId, actor, req) {
    const document = await AffiliateKycDocument.findById(documentId)
        .select('+encryptedContents +iv +authTag +sha256');
    if (!document) throw kycError('KYC document not found.', 404);
    const application = await AffiliateKyc.findById(document.application).select('status');
    if (!application) throw kycError('KYC application not found.', 404);
    const { decryptKycData } = require('../utils/kycEncryption');
    const content = decryptKycData(document.encryptedContents, document.iv, document.authTag);
    await writeAudit({
        actor,
        action: 'AFFILIATE_KYC_DOCUMENT_ACCESSED',
        resourceType: 'AffiliateKycDocument',
        resourceId: document._id,
        after: { type: document.type, applicationStatus: application.status },
        req,
    });
    return { content, mimeType: document.mimeType, originalName: document.originalName };
}

module.exports = { getKycDocument, getOwnKycStatus, reviewKyc, submitKyc };
