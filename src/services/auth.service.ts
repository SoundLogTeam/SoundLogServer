import { env } from '../config/env.js';
import { prisma } from '../config/prisma.js';
import {
  createRefreshToken,
  hashToken,
  signAccessToken,
} from '../utils/tokens.js';
import { unauthorized } from '../utils/http-error.js';

type SocialLoginInput = {
  deviceId?: string;
  provider: 'kakao' | 'apple' | 'google';
  providerToken: string;
};

export const authService = {
  async socialLogin(input: SocialLoginInput) {
    const providerUserId = input.deviceId ?? hashToken(input.providerToken).slice(0, 24);

    const user = await prisma.user.upsert({
      where: {
        provider_providerUserId: {
          provider: input.provider,
          providerUserId,
        },
      },
      update: {},
      create: {
        provider: input.provider,
        providerUserId,
        displayName: 'Soundlog User',
        profile: {
          create: {
            locationRecommendationEnabled: true,
            preferredGenres: [],
            preferredMoods: [],
            travelStyles: [],
            completedOnboarding: false,
          },
        },
        musicPlatform: {
          create: {
            selectedPlatformId: 'none',
            connected: false,
          },
        },
      },
    });

    return createTokenPair(user.id);
  },

  async refresh(refreshToken: string) {
    const tokenHash = hashToken(refreshToken);
    const record = await prisma.refreshToken.findUnique({
      where: { tokenHash },
    });

    if (!record || record.expiresAt < new Date()) {
      throw unauthorized('refresh token이 유효하지 않습니다.');
    }

    await prisma.refreshToken.delete({
      where: { id: record.id },
    });

    return createTokenPair(record.userId);
  },
};

async function createTokenPair(userId: string) {
  const refreshToken = createRefreshToken();

  await prisma.refreshToken.create({
    data: {
      tokenHash: hashToken(refreshToken),
      userId,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });

  return {
    accessToken: signAccessToken(userId),
    refreshToken,
    expiresIn: env.JWT_EXPIRES_IN_SECONDS,
  };
}
