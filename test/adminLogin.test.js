const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { authUser } = require('../controllers/userController');

test('privileged login returns a short MFA setup or verification challenge', async () => {
    const previousJwtSecret = process.env.JWT_SECRET;
    const previousFindOne = User.findOne;
    const users = [
        {
            _id: 'admin-setup',
            accountStatus: 'ACTIVE',
            isAdmin: true,
            roles: [],
            mfaEnabled: false,
            matchPassword: async (password) => password === 'correct-password',
        },
        {
            _id: 'admin-mfa',
            accountStatus: 'ACTIVE',
            isAdmin: true,
            roles: [],
            mfaEnabled: true,
            matchPassword: async (password) => password === 'correct-password',
        },
    ];
    const queries = [];
    process.env.JWT_SECRET = 'admin-login-test-secret';
    User.findOne = async (query) => {
        queries.push(query);
        return users.shift();
    };

    const makeResponse = () => ({
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        },
        cookie() {
            assert.fail('Privileged login must not issue a session cookie before MFA');
        },
    });

    try {
        const setupResponse = makeResponse();
        await authUser({
            body: { identifier: ' Admin@AyurvaPro.com ', password: 'correct-password' },
        }, setupResponse);

        assert.deepEqual(queries[0], {
            $or: [{ email: 'admin@ayurvapro.com' }, { phone: 'Admin@AyurvaPro.com' }],
        });
        assert.equal(setupResponse.body.mfaSetupRequired, true);
        assert.equal(setupResponse.body.token, undefined);
        const setupClaims = jwt.verify(setupResponse.body.setupToken, process.env.JWT_SECRET);
        assert.equal(setupClaims.purpose, 'privileged-mfa-setup');
        assert.equal(setupClaims.id, 'admin-setup');

        const verifyResponse = makeResponse();
        await authUser({
            body: { email: '+919876543210', password: 'correct-password' },
        }, verifyResponse);

        assert.deepEqual(queries[1], {
            $or: [{ email: '+919876543210' }, { phone: '+919876543210' }],
        });
        assert.equal(verifyResponse.body.mfaRequired, true);
        assert.equal(verifyResponse.body.token, undefined);
        const challengeClaims = jwt.verify(verifyResponse.body.challengeToken, process.env.JWT_SECRET);
        assert.equal(challengeClaims.purpose, 'privileged-mfa');
        assert.equal(challengeClaims.id, 'admin-mfa');
    } finally {
        User.findOne = previousFindOne;
        if (previousJwtSecret === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = previousJwtSecret;
    }
});
