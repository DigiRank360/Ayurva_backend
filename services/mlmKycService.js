const crypto = require('crypto');
const path = require('path');
const mongoose = require('mongoose');
const MlmKyc = require('../models/MlmKyc');
const MlmKycDocument = require('../models/MlmKycDocument');
const MlmMember = require('../models/MlmMember');
const { decryptKycData, encryptKycData, getEncryptionKey, hashKycIdentifier } = require('../utils/kycEncryption');

function kycError(message, statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

function validateDocument(file) {
    if (!file?.buffer?.length) throw kycError('Upload both the PAN card and government ID document.');
    const bytes = file.buffer;
    const actualMime = bytes.subarray(0, 5).toString() === '%PDF-'
        ? 'application/pdf'
        : bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
            ? 'image/jpeg'
            : bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
                ? 'image/png'
                : null;
    if (!actualMime || actualMime !== file.mimetype) {
        throw kycError('Document content does not match its file type. Upload a valid PDF, JPEG, or PNG.');
    }
    return actualMime;
}

function encryptedDocument(memberId, applicationId, type, file) {
    const mimeType = validateDocument(file);
    const encrypted = encryptKycData(file.buffer);
    return {
        member: memberId,
        application: applicationId,
        type,
        originalName: path.basename(file.originalname || `${type}.${mimeType.split('/')[1]}`).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100),
        mimeType,
        encryptedContents: encrypted.encrypted,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        sha256: crypto.createHash('sha256').update(file.buffer).digest('hex'),
    };
}

async function submitKyc({ userId, body, files }) {
    const legalName = typeof body.legalName === 'string' ? body.legalName.trim() : '';
    const dateOfBirth = new Date(body.dateOfBirth);
    const panNumber = typeof body.panNumber === 'string' ? body.panNumber.trim().toUpperCase() : '';
    const identityDocumentType = body.identityDocumentType;
    const address = {
        line1: typeof body.addressLine1 === 'string' ? body.addressLine1.trim() : '',
        line2: typeof body.addressLine2 === 'string' ? body.addressLine2.trim() : '',
        city: typeof body.city === 'string' ? body.city.trim() : '',
        state: typeof body.state === 'string' ? body.state.trim() : '',
        pincode: typeof body.pincode === 'string' ? body.pincode.trim() : '',
    };

    if (legalName.length < 2 || legalName.length > 120) throw kycError('Enter your full legal name.');
    if (Number.isNaN(dateOfBirth.getTime()) || dateOfBirth >= new Date()) throw kycError('Enter a valid date of birth.');
    const today = new Date();
    let age = today.getFullYear() - dateOfBirth.getFullYear();
    if (today.getMonth() < dateOfBirth.getMonth()
        || (today.getMonth() === dateOfBirth.getMonth() && today.getDate() < dateOfBirth.getDate())) age -= 1;
    if (age < 18) throw kycError('KYC applications require the member to be at least 18 years old.');
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(panNumber)) throw kycError('Enter a valid PAN number.');
    if (!['aadhaar', 'passport', 'voter_id', 'driving_license'].includes(identityDocumentType)) {
        throw kycError('Select a supported government ID type.');
    }
    if (!address.line1 || !address.city || !address.state || !/^\d{6}$/.test(address.pincode)) {
        throw kycError('Enter a complete address with a valid 6-digit PIN code.');
    }
    const panFile = files?.panDocument?.[0];
    const identityFile = files?.identityDocument?.[0];
    validateDocument(panFile);
    validateDocument(identityFile);
    const encryptedPan = encryptKycData(Buffer.from(panNumber));
    const panHash = hashKycIdentifier(panNumber);

    const member = await MlmMember.findOne({ user: userId });
    if (!member) throw kycError('MLM enrollment not found.', 404);
    const existingPan = await MlmKyc.findOne({ panHash, member: { $ne: member._id } }).select('+panHash');
    if (existingPan) throw kycError('This PAN is already associated with another member account.', 409);
    const currentApplication = await MlmKyc.findOne({ member: member._id });
    if (currentApplication && ['submitted', 'under_review', 'approved'].includes(currentApplication.status)) {
        throw kycError('A KYC application is already in progress or approved.', 409);
    }

    const session = await mongoose.startSession();
    let application;
    try {
        await session.withTransaction(async () => {
            const values = {
                member: member._id,
                status: 'submitted',
                legalName,
                dateOfBirth,
                panEncrypted: encryptedPan.encrypted,
                panIv: encryptedPan.iv,
                panAuthTag: encryptedPan.authTag,
                panHash,
                panLastFour: panNumber.slice(-4),
                identityDocumentType,
                address,
                submittedAt: new Date(),
                reviewedBy: null,
                reviewedAt: null,
                rejectionReason: null,
            };
            application = currentApplication
                ? await MlmKyc.findOneAndUpdate({ _id: currentApplication._id }, { $set: values }, { new: true, session })
                : await MlmKyc.create([values], { session }).then(([created]) => created);

            await MlmKycDocument.deleteMany({ application: application._id }).session(session);
            await MlmKycDocument.create([
                encryptedDocument(member._id, application._id, 'pan', panFile),
                encryptedDocument(member._id, application._id, 'identity', identityFile),
            ], { session });
            await MlmMember.updateOne(
                { _id: member._id },
                { $set: { kycStatus: 'submitted', kycVerifiedAt: null } },
                { session },
            );
        });
    } finally {
        await session.endSession();
    }
    return publicKycStatus(application);
}

function publicKycStatus(application) {
    if (!application) return { status: 'not_submitted' };
    return {
        id: application._id,
        status: application.status,
        legalName: application.legalName,
        panLastFour: application.panLastFour,
        identityDocumentType: application.identityDocumentType,
        submittedAt: application.submittedAt,
        reviewedAt: application.reviewedAt,
        rejectionReason: application.rejectionReason,
    };
}

function getKycStorageConfig() {
    try {
        getEncryptionKey();
        return { enabled: true };
    } catch {
        return { enabled: false };
    }
}

async function getMyKycStatus(userId) {
    const member = await MlmMember.findOne({ user: userId });
    if (!member) throw kycError('MLM enrollment not found.', 404);
    return publicKycStatus(await MlmKyc.findOne({ member: member._id }));
}

async function getKycQueue(status = 'submitted') {
    const query = ['submitted', 'under_review', 'approved', 'rejected'].includes(status) ? { status } : {};
    return MlmKyc.find(query)
        .sort({ submittedAt: 1 })
        .limit(100)
        .populate({ path: 'member', select: 'memberCode user', populate: { path: 'user', select: 'name email phone' } })
        .populate('reviewedBy', 'name email');
}

async function getKycDocument(kycId, type) {
    if (!['pan', 'identity'].includes(type)) throw kycError('Invalid KYC document type.');
    const document = await MlmKycDocument.findOne({ application: kycId, type })
        .select('+encryptedContents +iv +authTag');
    if (!document) throw kycError('KYC document not found.', 404);
    return {
        contents: decryptKycData(document.encryptedContents, document.iv, document.authTag),
        mimeType: document.mimeType,
        filename: document.originalName,
    };
}

async function reviewKyc({ kycId, adminUserId, decision, rejectionReason }) {
    if (!['approved', 'rejected'].includes(decision)) throw kycError('Decision must be approved or rejected.');
    if (decision === 'rejected' && (!rejectionReason || rejectionReason.trim().length < 5)) {
        throw kycError('Provide a clear reason for rejecting this KYC application.');
    }

    const session = await mongoose.startSession();
    let reviewed;
    try {
        await session.withTransaction(async () => {
            reviewed = await MlmKyc.findOneAndUpdate(
                { _id: kycId, status: { $in: ['submitted', 'under_review'] } },
                { $set: {
                    status: decision,
                    reviewedBy: adminUserId,
                    reviewedAt: new Date(),
                    rejectionReason: decision === 'rejected' ? rejectionReason.trim() : null,
                } },
                { new: true, session },
            );
            if (!reviewed) throw kycError('A reviewable KYC application was not found.', 404);
            await MlmMember.updateOne(
                { _id: reviewed.member },
                { $set: {
                    kycStatus: decision,
                    kycVerifiedAt: decision === 'approved' ? new Date() : null,
                } },
                { session },
            );
        });
    } finally {
        await session.endSession();
    }
    return publicKycStatus(reviewed);
}

module.exports = { getKycDocument, getKycQueue, getKycStorageConfig, getMyKycStatus, publicKycStatus, reviewKyc, submitKyc };