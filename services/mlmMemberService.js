const crypto = require('crypto');
const mongoose = require('mongoose');
const User = require('../models/User');
const MlmCommission = require('../models/MlmCommission');
const MlmMember = require('../models/MlmMember');
const MlmVolumeEvent = require('../models/MlmVolumeEvent');
const { calculateFundDistribution } = require('./mlmDistributionService');
const { getPackage } = require('./mlmPackageService');
const { getIndiaDateKey } = require('../utils/mlmDate');
const MlmPayoutAccount = require('../models/MlmPayoutAccount');
const { assertPhoneVerified, buildPayoutAccount } = require('./mlmRegistrationService');
const generateToken = require('../utils/generateToken');

function validationError(message, statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

async function enrollMember({ userId, packageId, sponsorCode, placementCode, placementLeg }) {
    const selectedPackage = getPackage(packageId);
    if (placementCode && !['left', 'right'].includes(placementLeg)) {
        throw validationError('Choose a left or right placement leg.');
    }
    if (!placementCode && placementLeg) {
        throw validationError('A placement member code is required when selecting a leg.');
    }

    const existingMember = await MlmMember.findOne({ user: userId });
    if (existingMember) throw validationError('This account already has an MLM enrollment.');

    return MlmMember.create({
        user: userId,
        memberCode: `AYV-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
        packageId: selectedPackage.id,
        packageSnapshot: selectedPackage,
        requestedSponsorCode: sponsorCode || null,
        requestedPlacementCode: placementCode || null,
        requestedPlacementLeg: placementLeg || null,
    });
}

const APPLICANT_CATEGORIES = ['ayurvedic_practitioner', 'wellness_professional', 'health_advocate', 'other'];

function buildApplicantProfile(input) {
    if (!input) return null;
    if (typeof input !== 'object') throw validationError('The applicant profile is invalid.');
    const text = (value) => (typeof value === 'string' ? value.trim() : '');
    const profile = {
        category: text(input.category),
        councilRegistrationNo: text(input.councilRegistrationNo),
        organizationName: text(input.organizationName),
        state: text(input.state),
        city: text(input.city),
        pinCode: text(input.pinCode),
    };
    if (!APPLICANT_CATEGORIES.includes(profile.category)) throw validationError('Select a valid applicant category.');
    if (!profile.state || !profile.city) throw validationError('State and city are required.');
    if (!/^[1-9]\d{5}$/.test(profile.pinCode)) throw validationError('Enter a valid 6-digit PIN code.');
    if (input.undertakingAccepted !== true) throw validationError('Accept the undertaking to continue.');
    return { ...profile, undertakingAcceptedAt: new Date() };
}

async function registerMember({ name, email, phone, password, packageId, sponsorCode, placementCode, placementLeg, applicantProfile, payoutAccount, phoneVerificationToken }) {
    const profile = buildApplicantProfile(applicantProfile);
    const selectedPackage = getPackage(packageId);
    if (typeof name !== 'string' || !name.trim()) throw validationError('Full name is required.');
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        throw validationError('Enter a valid email address.');
    }
    if (typeof phone !== 'string' || !/^\+[1-9]\d{7,14}$/.test(phone.trim())) {
        throw validationError('Phone number must use international format, such as +919876543210.');
    }
    if (typeof password !== 'string' || password.length < 8) {
        throw validationError('Password must be at least 8 characters long.');
    }
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedPhone = phone.trim();
    // The public partner application enforces OTP and payout details; legacy registrations (e.g. a member adding a downline entry) do not send a profile.
    if (profile) assertPhoneVerified(normalizedPhone, phoneVerificationToken);
    const payout = profile ? buildPayoutAccount(payoutAccount, name) : null;
    if (sponsorCode && (typeof sponsorCode !== 'string' || !sponsorCode.trim())) {
        throw validationError('The sponsor code is invalid.');
    }
    if (placementCode && (typeof placementCode !== 'string' || !['left', 'right'].includes(placementLeg))) {
        throw validationError('Choose an available placement under your sponsor.');
    }

    const session = await mongoose.startSession();
    let result;
    try {
        await session.withTransaction(async () => {
            let sponsor = null;
            if (sponsorCode) {
                sponsor = await MlmMember.findOne({ memberCode: sponsorCode, status: 'active' }).session(session);
                if (!sponsor) throw validationError('The selected sponsor is not active.');
            }

            let placementParent = null;
            if (placementCode) {
                placementParent = await MlmMember.findOne({ memberCode: placementCode, status: 'active' }).session(session);
                if (!placementParent) throw validationError('The selected placement member is not active.');
                if (sponsor) {
                    const [sponsorNetwork] = await MlmMember.aggregate([
                        { $match: { _id: sponsor._id } },
                        {
                            $graphLookup: {
                                from: MlmMember.collection.name,
                                startWith: '$_id',
                                connectFromField: '_id',
                                connectToField: 'placementParent',
                                as: 'downline',
                                restrictSearchWithMatch: { status: 'active' },
                            },
                        },
                        { $project: { downline: 1 } },
                    ]).session(session);
                    const allowedPlacementIds = new Set([
                        sponsor._id.toString(),
                        ...(sponsorNetwork?.downline || []).map((member) => member._id.toString()),
                    ]);
                    if (!allowedPlacementIds.has(placementParent._id.toString())) {
                        throw validationError('The placement must be within the selected sponsor network.');
                    }
                }
                const occupied = await MlmMember.exists({
                    placementParent: placementParent._id,
                    placementLeg,
                }).session(session);
                if (occupied) throw validationError(`The ${placementLeg} placement is already occupied.`);
            }

            const [emailUser, phoneUser] = await Promise.all([
                User.findOne({ email: normalizedEmail }).session(session),
                User.findOne({ phone: normalizedPhone }).session(session),
            ]);
            if (emailUser && phoneUser && !emailUser._id.equals(phoneUser._id)) {
                throw validationError('That email and phone number belong to different accounts.', 409);
            }

            let user = emailUser || phoneUser;
            if (user) {
                if (user.isAdmin) throw validationError('Admin accounts cannot use member registration.', 409);
                if (user.email && user.email.toLowerCase() !== normalizedEmail) {
                    throw validationError('This phone number is already connected to another email account.', 409);
                }
                if (user.phone && user.phone !== normalizedPhone) {
                    throw validationError('This email is already connected to another phone number.', 409);
                }
                if (!(await user.matchPassword(password))) {
                    throw validationError('An account already exists. Sign in with that account or use a different email and phone.', 409);
                }
                if (await MlmMember.exists({ user: user._id }).session(session)) {
                    throw validationError('This account already has an MLM profile. Sign in instead.', 409);
                }
                user.email = normalizedEmail;
                user.phone = normalizedPhone;
                await user.save({ session });
            } else {
                [user] = await User.create([{
                    name: name.trim(),
                    email: normalizedEmail,
                    phone: normalizedPhone,
                    password,
                    isAdmin: false,
                }], { session });
            }

            const [member] = await MlmMember.create([{
                user: user._id,
                memberCode: `AYV-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
                packageId: selectedPackage.id,
                packageSnapshot: selectedPackage,
                requestedSponsorCode: sponsor?.memberCode || null,
                requestedPlacementCode: placementParent?.memberCode || null,
                requestedPlacementLeg: placementParent ? placementLeg : null,
                applicantProfile: profile,
            }], { session });

            if (payout) {
                const duplicatePan = await MlmPayoutAccount.exists({ panHash: payout.panHash }).session(session);
                if (duplicatePan) throw validationError('This PAN is already registered with another member.', 409);
                await MlmPayoutAccount.create([{ member: member._id, ...payout }], { session });
            }

            result = {
                token: generateToken(user._id),
                user: { _id: user._id, name: user.name, email: user.email, phone: user.phone, isAdmin: false },
                member,
            };
        });
    } finally {
        await session.endSession();
    }
    return result;
}

async function getReferralPlacements(memberCode) {
    const [network] = await MlmMember.aggregate([
        { $match: { memberCode, status: 'active' } },
        {
            $graphLookup: {
                from: MlmMember.collection.name,
                startWith: '$_id',
                connectFromField: '_id',
                connectToField: 'placementParent',
                as: 'downline',
                depthField: 'depth',
                restrictSearchWithMatch: { status: 'active' },
            },
        },
        { $project: { memberCode: 1, user: 1, downline: 1 } },
    ]);
    if (!network) throw Object.assign(new Error('Referral code is invalid or inactive.'), { statusCode: 404 });

    const placementMembers = [network, ...network.downline];
    const userIds = placementMembers.map((member) => member.user);
    const users = await User.find({ _id: { $in: userIds } }).select('name');
    const namesById = new Map(users.map((user) => [user._id.toString(), user.name]));
    const occupiedSlots = new Set(network.downline.map((member) => `${member.placementParent}:${member.placementLeg}`));
    const placements = placementMembers.flatMap((member) => ['left', 'right']
        .filter((leg) => !occupiedSlots.has(`${member._id}:${leg}`))
        .map((leg) => ({
            memberCode: member.memberCode,
            name: namesById.get(member.user.toString()) || 'Member',
            leg,
        })));

    return {
        sponsor: {
            memberCode: network.memberCode,
            name: namesById.get(network.user.toString()) || 'Member',
        },
        placements,
    };
}

async function activateMember({ memberId, paymentReference }) {
    const reference = typeof paymentReference === 'string' ? paymentReference.trim() : '';
    if (!reference) throw validationError('A verified payment reference is required.');

    const session = await mongoose.startSession();
    let activatedMember;
    try {
        await session.withTransaction(async () => {
            const member = await MlmMember.findById(memberId).session(session);
            if (!member) throw Object.assign(new Error('MLM enrollment not found.'), { statusCode: 404 });
            if (member.status === 'active') {
                if (member.activationReference === reference) {
                    activatedMember = member;
                    return;
                }
                throw validationError('This MLM enrollment is already active.');
            }
            if (member.status !== 'pending') throw validationError('Only pending enrollments can be activated.');

            const existingPayment = await MlmMember.findOne({ activationReference: reference }).session(session);
            if (existingPayment) throw validationError('This payment reference is already in use.');

            let sponsor = null;
            if (member.requestedSponsorCode) {
                sponsor = await MlmMember.findOne({ memberCode: member.requestedSponsorCode, status: 'active' }).session(session);
                if (!sponsor) throw validationError('The selected sponsor is not active.');
                if (sponsor._id.equals(member._id)) throw validationError('A member cannot sponsor themselves.');
            }

            let placementParent = null;
            if (member.requestedPlacementCode) {
                placementParent = await MlmMember.findOne({ memberCode: member.requestedPlacementCode, status: 'active' }).session(session);
                if (!placementParent) throw validationError('The selected placement member is not active.');
                if (placementParent._id.equals(member._id)) throw validationError('A member cannot be placed under themselves.');

                const occupied = await MlmMember.exists({
                    placementParent: placementParent._id,
                    placementLeg: member.requestedPlacementLeg,
                }).session(session);
                if (occupied) throw validationError(`The ${member.requestedPlacementLeg} placement is already occupied.`);
            }

            member.sponsorMember = sponsor?._id || null;
            member.placementParent = placementParent?._id || null;
            member.placementLeg = placementParent ? member.requestedPlacementLeg : null;
            member.status = 'active';
            member.activationReference = reference;
            member.activatedAt = new Date();
            await member.save({ session });

            const dateKey = getIndiaDateKey(member.activatedAt);
            let branch = member;
            let ancestor = placementParent;
            const events = [];
            while (ancestor) {
                events.push({
                    recipientMember: ancestor._id,
                    sourceMember: member._id,
                    side: branch.placementLeg,
                    businessVolume: member.packageSnapshot.businessVolume,
                    dateKey,
                });
                branch = ancestor;
                ancestor = ancestor.placementParent
                    ? await MlmMember.findById(ancestor.placementParent).session(session)
                    : null;
            }
            if (events.length) await MlmVolumeEvent.insertMany(events, { session });

            if (sponsor) {
                const referralAmount = calculateFundDistribution(member.packageSnapshot.businessVolume)
                    .allocations.referralBonus;
                if (referralAmount > 0) {
                    sponsor.walletBalance += referralAmount;
                    sponsor.totalEarnings += referralAmount;
                    await sponsor.save({ session });
                    await MlmCommission.create([{
                        member: sponsor._id,
                        sourceMember: member._id,
                        type: 'referral',
                        dateKey,
                        idempotencyKey: `referral:${member._id}`,
                        grossAmount: referralAmount,
                        paidAmount: referralAmount,
                    }], { session });
                }
            }
            activatedMember = member;
        });
    } finally {
        await session.endSession();
    }

    return activatedMember;
}

module.exports = { enrollMember, registerMember, getReferralPlacements, activateMember };