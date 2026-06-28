import crypto from 'node:crypto';

import jwt from 'jsonwebtoken';

import { env } from '../config/env.js';
import { prisma } from '../config/prisma.js';
import { mockDb } from '../mock/mock-db.js';
import {
  createRefreshToken,
  hashToken,
  signAccessToken,
} from '../utils/tokens.js';
import { badRequest, unauthorized } from '../utils/http-error.js';

type SocialLoginInput = {
  authorizationCode?: string;
  codeVerifier?: string;
  device?: {
    appVersion?: string;
    deviceId?: string;
    platform: 'ios' | 'android' | 'web';
  };
  deviceId?: string;
  idToken?: string;
  provider: 'kakao' | 'apple' | 'google';
  providerAccessToken?: string;
  providerDisplayName?: string;
  providerToken?: string;
  redirectUri?: string;
};

type VerifiedSocialIdentity = {
  displayName?: string;
  providerUserId: string;
};

type AppleJwtHeader = {
  alg?: string;
  kid?: string;
};

type AppleJwksResponse = {
  keys?: Array<crypto.JsonWebKey & { kid?: string }>;
};

function getProviderCredential(input: SocialLoginInput) {
  return input.idToken ??
    input.authorizationCode ??
    input.providerAccessToken ??
    input.providerToken;
}

async function fetchJson<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, init);

  if (!response.ok) {
    throw unauthorized('provider 인증 정보가 유효하지 않습니다.');
  }

  return (await response.json()) as T;
}

async function verifyGoogleIdentity(input: SocialLoginInput): Promise<VerifiedSocialIdentity> {
  if (input.idToken) {
    if (!env.GOOGLE_CLIENT_ID && env.NODE_ENV === 'production') {
      throw badRequest('GOOGLE_CLIENT_ID 설정이 필요합니다.');
    }

    const data = await fetchJson<{
      aud?: string;
      email?: string;
      name?: string;
      sub?: string;
    }>(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(input.idToken)}`);

    if (!data.sub || (env.GOOGLE_CLIENT_ID && data.aud !== env.GOOGLE_CLIENT_ID)) {
      throw unauthorized('provider 인증 정보가 유효하지 않습니다.');
    }

    return {
      displayName: data.name ?? data.email,
      providerUserId: data.sub,
    };
  }

  const accessToken = input.providerAccessToken ?? input.providerToken;

  if (!accessToken) {
    throw badRequest('Google provider token이 필요합니다.');
  }

  const data = await fetchJson<{
    email?: string;
    name?: string;
    sub?: string;
  }>('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!data.sub) {
    throw unauthorized('provider 인증 정보가 유효하지 않습니다.');
  }

  return {
    displayName: data.name ?? data.email,
    providerUserId: data.sub,
  };
}

async function verifyKakaoIdentity(input: SocialLoginInput): Promise<VerifiedSocialIdentity> {
  const accessToken = input.providerAccessToken ?? input.providerToken;

  if (!accessToken) {
    throw badRequest('Kakao provider access token이 필요합니다.');
  }

  if (!env.KAKAO_APP_ID && env.NODE_ENV === 'production') {
    throw badRequest('KAKAO_APP_ID 설정이 필요합니다.');
  }

  const tokenInfo = await fetchJson<{
    app_id?: number;
    id?: number;
  }>('https://kapi.kakao.com/v1/user/access_token_info', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!tokenInfo.id) {
    throw unauthorized('provider 인증 정보가 유효하지 않습니다.');
  }

  if (env.KAKAO_APP_ID && String(tokenInfo.app_id) !== env.KAKAO_APP_ID) {
    throw unauthorized('provider 인증 정보가 유효하지 않습니다.');
  }

  const data = await fetchJson<{
    id?: number;
    kakao_account?: {
      email?: string;
      profile?: {
        nickname?: string;
      };
    };
    properties?: {
      nickname?: string;
    };
  }>('https://kapi.kakao.com/v2/user/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!data.id) {
    throw unauthorized('provider 인증 정보가 유효하지 않습니다.');
  }

  return {
    displayName:
      data.kakao_account?.profile?.nickname ??
      data.properties?.nickname ??
      data.kakao_account?.email,
    providerUserId: String(data.id),
  };
}

async function verifyAppleIdentity(input: SocialLoginInput): Promise<VerifiedSocialIdentity> {
  if (!input.idToken) {
    throw badRequest('Apple idToken이 필요합니다.');
  }

  if (!env.APPLE_CLIENT_ID && env.NODE_ENV === 'production') {
    throw badRequest('APPLE_CLIENT_ID 설정이 필요합니다.');
  }

  const decoded = jwt.decode(input.idToken, { complete: true }) as
    | { header?: AppleJwtHeader }
    | null;
  const kid = decoded?.header?.kid;

  if (!kid) {
    throw unauthorized('provider 인증 정보가 유효하지 않습니다.');
  }

  const jwks = await fetchJson<AppleJwksResponse>('https://appleid.apple.com/auth/keys');
  const jwk = jwks.keys?.find((key) => key.kid === kid);

  if (!jwk) {
    throw unauthorized('provider 인증 정보가 유효하지 않습니다.');
  }

  const publicKey = crypto.createPublicKey({
    key: jwk,
    format: 'jwk',
  } as crypto.JsonWebKeyInput);
  const payload = jwt.verify(input.idToken, publicKey, {
    algorithms: ['RS256'],
    audience: env.APPLE_CLIENT_ID,
    issuer: 'https://appleid.apple.com',
  }) as { email?: string; sub?: string };

  if (!payload.sub) {
    throw unauthorized('provider 인증 정보가 유효하지 않습니다.');
  }

  return {
    displayName: input.providerDisplayName ?? payload.email,
    providerUserId: payload.sub,
  };
}

async function verifySocialIdentity(input: SocialLoginInput): Promise<VerifiedSocialIdentity> {
  switch (input.provider) {
    case 'google':
      return verifyGoogleIdentity(input);
    case 'kakao':
      return verifyKakaoIdentity(input);
    case 'apple':
      return verifyAppleIdentity(input);
    default:
      throw badRequest('지원하지 않는 provider입니다.');
  }
}

function shouldUseDevSocialLoginFallback() {
  if (env.NODE_ENV === 'production') {
    return false;
  }

  return env.ALLOW_DEV_AUTH_FALLBACK || env.NODE_ENV === 'development' || env.NODE_ENV === 'test';
}

export const authService = {
  async socialLogin(input: SocialLoginInput) {
    if (env.USE_MOCK_DB) {
      return createMockTokenPair(false);
    }

    const useDevSocialLoginFallback = shouldUseDevSocialLoginFallback();
    const explicitDeviceId =
      useDevSocialLoginFallback ? input.device?.deviceId ?? input.deviceId : undefined;
    const providerCredential = getProviderCredential(input);
    const verifiedIdentity = useDevSocialLoginFallback
      ? {
          displayName: 'Soundlog User',
          providerUserId:
            explicitDeviceId ?? hashToken(`${input.provider}:${providerCredential}`).slice(0, 24),
        }
      : await verifySocialIdentity(input);

    const existingUser = await prisma.user.findUnique({
      where: {
        provider_providerUserId: {
          provider: input.provider,
          providerUserId: verifiedIdentity.providerUserId,
        },
      },
    });
    const user =
      existingUser ??
      (await prisma.user.create({
        data: {
          provider: input.provider,
          providerUserId: verifiedIdentity.providerUserId,
          displayName: verifiedIdentity.displayName ?? 'Soundlog User',
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
      }));

    return createTokenPair(user.id, !existingUser);
  },

  async refresh(refreshToken: string) {
    if (env.USE_MOCK_DB) {
      const tokenHash = hashToken(refreshToken);
      const record = mockDb.refreshTokens.find((item) => item.tokenHash === tokenHash);

      if (!record || record.expiresAt < new Date()) {
        throw unauthorized('refresh token이 유효하지 않습니다.');
      }

      mockDb.refreshTokens = mockDb.refreshTokens.filter(
        (item) => item.tokenHash !== tokenHash,
      );

      return createMockTokenPair(false);
    }

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

    return createTokenPair(record.userId, false);
  },

  async logout(refreshToken?: string) {
    if (!refreshToken) {
      return;
    }

    const tokenHash = hashToken(refreshToken);

    if (env.USE_MOCK_DB) {
      mockDb.refreshTokens = mockDb.refreshTokens.filter(
        (item) => item.tokenHash !== tokenHash,
      );
      return;
    }

    await prisma.refreshToken.deleteMany({
      where: { tokenHash },
    });
  },

  async getMe(userId: string) {
    if (env.USE_MOCK_DB) {
      return {
        musicPlatform: {
          ...mockDb.musicPlatform,
          updatedAt: mockDb.musicPlatform.updatedAt.toISOString(),
        },
        profile: {
          ...mockDb.profile,
          updatedAt: mockDb.profile.updatedAt.toISOString(),
        },
        user: mockUserToDto(),
      };
    }

    return {
      musicPlatform: await getMusicPlatformDto(userId),
      profile: await getProfileDto(userId),
      user: await getUserDto(userId),
    };
  },
};

async function createTokenPair(userId: string, isNewUser: boolean) {
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
    expiresIn: env.JWT_EXPIRES_IN_SECONDS,
    isNewUser,
    profile: await getProfileDto(userId),
    refreshToken,
    user: await getUserDto(userId),
  };
}

function createMockTokenPair(isNewUser: boolean) {
  const refreshToken = createRefreshToken();

  mockDb.refreshTokens.push({
    tokenHash: hashToken(refreshToken),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });

  return {
    accessToken: signAccessToken(mockDb.user.id),
    expiresIn: env.JWT_EXPIRES_IN_SECONDS,
    isNewUser,
    profile: {
      ...mockDb.profile,
      updatedAt: mockDb.profile.updatedAt.toISOString(),
    },
    refreshToken,
    user: mockUserToDto(),
  };
}

async function getUserDto(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      displayName: true,
      id: true,
      provider: true,
    },
  });

  return {
    displayName: user.displayName ?? 'Soundlog User',
    id: user.id,
    provider: user.provider,
  };
}

async function getProfileDto(userId: string) {
  const profile = await prisma.userProfile.upsert({
    where: { userId },
    update: {},
    create: {
      completedOnboarding: false,
      locationRecommendationEnabled: true,
      preferredGenres: [],
      preferredMoods: [],
      travelStyles: [],
      userId,
    },
  });

  return {
    birthYear: profile.birthYear ?? undefined,
    companionType: profile.companionType ?? undefined,
    completedOnboarding: profile.completedOnboarding,
    dislikedArtists: profile.dislikedArtists,
    gender: profile.gender ?? undefined,
    locationRecommendationEnabled: profile.locationRecommendationEnabled,
    preferredGenres: profile.preferredGenres,
    preferredMoods: profile.preferredMoods,
    travelStyles: profile.travelStyles,
    updatedAt: profile.updatedAt.toISOString(),
  };
}

async function getMusicPlatformDto(userId: string) {
  const musicPlatform = await prisma.musicPlatform.upsert({
    where: { userId },
    update: {},
    create: {
      connected: false,
      selectedPlatformId: 'none',
      userId,
    },
  });

  return {
    connected: musicPlatform.connected,
    providerUserId: musicPlatform.providerUserId ?? undefined,
    selectedPlatformId: musicPlatform.selectedPlatformId,
    updatedAt: musicPlatform.updatedAt.toISOString(),
  };
}

function mockUserToDto() {
  return {
    displayName: mockDb.user.displayName ?? 'Soundlog Mock User',
    id: mockDb.user.id,
    provider: mockDb.user.provider,
  };
}
