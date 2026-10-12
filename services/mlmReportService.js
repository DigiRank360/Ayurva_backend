const MlmCommission = require('../models/MlmCommission');
const MlmMember = require('../models/MlmMember');
const MlmVolumeEvent = require('../models/MlmVolumeEvent');
const User = require('../models/User');
const { getIndiaDateKey } = require('../utils/mlmDate');

async function getMemberForUser(userId) {
    const member = await MlmMember.findOne({ user: userId })
        .populate('user', 'name email phone')
        .populate('sponsorMember', 'memberCode packageId status')
        .populate('placementParent', 'memberCode packageId status');
    if (!member) {
        const error = new Error('MLM enrollment not found.');
        error.statusCode = 404;
        throw error;
    }
    return member;
}

async function getCommissionHistory(memberId, page = 1, limit = 25) {
    const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
    const safeLimit = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 25));
    const query = { member: memberId };
    const [commissions, total] = await Promise.all([
        MlmCommission.find(query).sort({ createdAt: -1 }).skip((safePage - 1) * safeLimit).limit(safeLimit)
            .populate('sourceMember', 'memberCode'),
        MlmCommission.countDocuments(query),
    ]);
    return { commissions, page: safePage, limit: safeLimit, total, pages: Math.ceil(total / safeLimit) };
}

async function getPlacementNetwork(memberId) {
    const [result] = await MlmMember.aggregate([
        { $match: { _id: memberId } },
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
        { $project: { memberCode: 1, packageId: 1, packageSnapshot: 1, user: 1, downline: 1 } },
    ]);
    if (!result) {
        const error = new Error('MLM enrollment not found.');
        error.statusCode = 404;
        throw error;
    }

    const networkMembers = [result, ...result.downline];
    const userIds = networkMembers.map((member) => member.user);
    const users = await User.find({ _id: { $in: userIds } }).select('name');
    const nameByUserId = new Map(users.map((user) => [user._id.toString(), user.name]));
    const codeByMemberId = new Map(networkMembers.map((member) => [member._id.toString(), member.memberCode]));
    return {
        memberCode: result.memberCode,
        name: nameByUserId.get(result.user.toString()) || 'Member',
        packageId: result.packageId,
        businessVolume: result.packageSnapshot.businessVolume,
        members: result.downline.map((member) => ({
            memberCode: member.memberCode,
            name: nameByUserId.get(member.user.toString()) || 'Member',
            packageId: member.packageId,
            businessVolume: member.packageSnapshot.businessVolume,
            placementParent: codeByMemberId.get(member.placementParent.toString()),
            leg: member.placementLeg,
            depth: member.depth,
            activatedAt: member.activatedAt,
        })),
    };
}

async function getVolumeHistory(memberId, days = 30) {
    const safeDays = [7, 30, 90].includes(Number(days)) ? Number(days) : 30;
    const [year, month, day] = getIndiaDateKey().split('-').map(Number);
    const dateKeys = Array.from({ length: safeDays }, (_, index) => {
        const date = new Date(Date.UTC(year, month - 1, day - safeDays + index + 1));
        return date.toISOString().slice(0, 10);
    });
    const totals = await MlmVolumeEvent.aggregate([
        { $match: { recipientMember: memberId, dateKey: { $gte: dateKeys[0], $lte: dateKeys.at(-1) } } },
        { $group: { _id: '$dateKey', businessVolume: { $sum: '$businessVolume' } } },
    ]);
    const valueByDate = new Map(totals.map((item) => [item._id, item.businessVolume]));
    const series = dateKeys.map((dateKey) => ({
        dateKey,
        label: new Intl.DateTimeFormat('en-IN', {
            timeZone: 'Asia/Kolkata',
            day: '2-digit',
            month: 'short',
        }).format(new Date(`${dateKey}T12:00:00+05:30`)),
        businessVolume: valueByDate.get(dateKey) || 0,
    }));
    return {
        days: safeDays,
        totalBusinessVolume: series.reduce((total, item) => total + item.businessVolume, 0),
        series,
    };
}

module.exports = { getMemberForUser, getCommissionHistory, getPlacementNetwork, getVolumeHistory };