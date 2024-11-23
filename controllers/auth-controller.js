const OtpService = require('../services/otp-service');
const HashService = require('../services/hash-service');
const UserService = require('../services/user-service');
const TokenService = require('../services/token-service');
const UserDto = require('.././dtos/user-dto');

class AuthController {
    async sendOtp(req, res) {
        // Logic
        const { phone } = req.body;
        if (!phone) {
            res.status(400).json({ message: "Phone field is required " });
        }

        // generate OTP
        const otp = await OtpService.generateOtp();

        console.log({ otp })


        // Hash Otp
        const ttl = 1000 * 60 * 2;  //time to leave (expire time)
        const expires = Date.now() + ttl;
        const data = `${phone}.${otp}.${expires}`;
        const hash = HashService.hashOtp(data);

        // send OTP
        try {
            // await OtpService.sendBySms(phone, otp);
            res.json({
                hash: `${hash}.${expires}`,
                phone,
                otp,
            })
        } catch (err) {
            console.log(err);
            res.status(500).json({ message: "message sending failed" });
        }

    }

    async verifyOtp(req, res) {
        const { otp, hash, phone } = req.body;
        if (!otp || !hash || !phone) {
            res.status(400).json({ message: 'All fields are required' });
        }

        const [hashedOtp, expires] = hash.split('.');
        if (Date.now() > +expires) {
            res.status(400).json({ message: 'OTP expired' });
        }

        const data = `${phone}.${otp}.${expires}`;

        const isValid = OtpService.verifyOtp(hashedOtp, data);

        if (!isValid) {
            res.status(400).json({ message: 'Invalid OTP' });
        }

        let user;
        // let accessToken;

        try {
            user = await UserService.findUser({ phone: phone });
            if (!user) {
                user = await UserService.createUser({ phone: phone })
            }
        } catch (err) {
            console.log(err);
            res.status(500).json({ message: 'DB error' });
        }


        // JWT
        const { accessToken, refreshToken } = TokenService.generateTokens({
            _id: user._id,
            activated: false,
        });

        await TokenService.storeRefreshToken(refreshToken, user._id);

        // cookie 
        res.cookie('refreshToken', refreshToken, {
            maxAge: 1000 * 60 * 60 * 24 * 30,
            httpOnly: true
        });

        res.cookie('accessToken', accessToken, {
            maxAge: 1000 * 60 * 60 * 24 * 30,
            httpOnly: true
        });

        const userDto = new UserDto(user);
        res.json({ user: userDto, auth: true });


    }

    async refresh(req, res) {
        // get refresh token from cookie
        const { refreshToken: refreshTokenFromCookie } = req.cookies;

        // check if token is valid
        let userData;
        try {
            userData = await TokenService.verifyRefreshToken(
                refreshTokenFromCookie
            );
        } catch (err) {
            return res.status(401).json({ message: 'Invalid Token' });
        }

        // Check if token is in db
        try {
            const token = await TokenService.findRefreshToken(
                userData._id,
                refreshTokenFromCookie
            );
            if (!token) {
                return res.status(401).json({ message: 'Invalid token' });
            }
        } catch (err) {
            return res.status(500).json({ message: 'Internal error' });
        }

        // check if valid user
        const user = await UserService.findUser({ _id: userData._id });
        if (!user) {
            return res.status(404).json({ message: 'No user' });
        }

        // Generate new tokens
        const { refreshToken, accessToken } = TokenService.generateTokens({
            _id: userData._id,
        });

        // Update refresh token
        try {
            await TokenService.updateRefreshToken(userData._id, refreshToken);
        } catch (err) {
            return res.status(500).json({ message: 'Internal error' });
        }

        // put in cookies
        res.cookie('refreshToken', refreshToken, {
            maxAge: 1000 * 60 * 60 * 24 * 30,
            httpOnly: true,
        });

        res.cookie('accessToken', accessToken, {
            maxAge: 1000 * 60 * 60 * 24 * 30,
            httpOnly: true,
        });

        // response
        const userDto = new UserDto(user);
        res.json({ user: userDto, auth: true });
    }

    async logout(req, res) {
        const { refreshToken } = req.cookies;
        // delete refresh token from db
        await TokenService.removeToken(refreshToken);
        // delete cookies
        res.clearCookie('refreshToken');
        res.clearCookie('accessToken');
        res.json({ user: null, auth: false });
    }

}



module.exports = new AuthController();