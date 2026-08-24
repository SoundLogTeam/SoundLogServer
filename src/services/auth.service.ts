import bcrypt from 'bcrypt';

import { env } from '../config/env.js';
import { ERROR_MESSAGES } from '../constants/error.constants.js';
import { prisma } from '../config/prisma.js';
import { mockDb } from '../mock/mock-db.js';
import {
  createRefreshToken,
  hashToken,
  signAccessToken,
} from '../utils/tokens.js';
import { badRequest, unauthorized } from '../utils/http-error.js';

type EmailPasswordAuthInput = {
  displayName?: string;
  email: string;
  password: string;
};

const FIRST_PARTY_PROVIDER = 'email';
const PASSWORD_SALT_ROUNDS = 12;

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function getDefaultDisplayName(email: string) {
  return email.split('@')[0] || 'Soundlog User';
}

function getEmailDisplayName(input: EmailPasswordAuthInput) {
  const displayName = input.displayName?.trim();

  return displayName || getDefaultDisplayName(normalizeEmail(input.email));
}

export const authService = {
  async login(input: EmailPasswordAuthInput) {
    if (env.USE_MOCK_DB) {
      return loginMockEmailUser(input);
    }

    const email = normalizeEmail(input.email);
    const user = await prisma.user.findUnique({
      where: {
        provider_providerUserId: {
          provider: FIRST_PARTY_PROVIDER,
          providerUserId: email,
        },
      },
      select: {
        id: true,
        passwordHash: true,
      },
    });

    if (!user?.passwordHash) {
      throw unauthorized(ERROR_MESSAGES.INVALID_EMAIL_OR_PASSWORD);
    }

    const isPasswordValid = await bcrypt.compare(input.password, user.passwordHash);

    if (!isPasswordValid) {
      throw unauthorized(ERROR_MESSAGES.INVALID_EMAIL_OR_PASSWORD);
    }

    return createTokenPair(user.id, false);
  },

  async register(input: EmailPasswordAuthInput) {
    if (env.USE_MOCK_DB) {
      return registerMockEmailUser(input);
    }

    const email = normalizeEmail(input.email);
    const existingUser = await prisma.user.findUnique({
      where: {
        provider_providerUserId: {
          provider: FIRST_PARTY_PROVIDER,
          providerUserId: email,
        },
      },
      select: { id: true },
    });

    if (existingUser) {
      throw badRequest(ERROR_MESSAGES.USER_ALREADY_EXISTS);
    }

    const passwordHash = await bcrypt.hash(input.password, PASSWORD_SALT_ROUNDS);
    const user = await prisma.user.create({
      data: {
        displayName: getEmailDisplayName(input),
        passwordHash,
        provider: FIRST_PARTY_PROVIDER,
        providerUserId: email,
        profile: {
          create: {
            locationRecommendationEnabled: true,
            preferredGenres: [],
            preferredMoods: [],
            travelStyles: [],
            completedOnboarding: false,
          },
        },
      },
    });

    return createTokenPair(user.id, true);
  },

  async refresh(refreshToken: string) {
    if (env.USE_MOCK_DB) {
      const tokenHash = hashToken(refreshToken);
      const record = mockDb.refreshTokens.find((item) => item.tokenHash === tokenHash);

      if (!record || record.expiresAt < new Date()) {
        throw unauthorized(ERROR_MESSAGES.INVALID_REFRESH_TOKEN);
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
      throw unauthorized(ERROR_MESSAGES.INVALID_REFRESH_TOKEN);
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
        profile: {
          ...mockDb.profile,
          updatedAt: mockDb.profile.updatedAt.toISOString(),
        },
        user: mockUserToDto(),
      };
    }

    return {
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
      providerUserId: true,
    },
  });

  return {
    displayName: user.displayName ?? 'Soundlog User',
    email: user.provider === FIRST_PARTY_PROVIDER ? user.providerUserId : undefined,
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

function mockUserToDto() {
  return {
    displayName: mockDb.user.displayName ?? 'Soundlog Mock User',
    email:
      mockDb.user.provider === FIRST_PARTY_PROVIDER
        ? mockDb.user.providerUserId
        : undefined,
    id: mockDb.user.id,
    provider: mockDb.user.provider,
  };
}

function setMockEmailUser(user: { displayName: string; email: string; id: string }) {
  Object.assign(mockDb.user, {
    displayName: user.displayName,
    id: user.id,
    provider: FIRST_PARTY_PROVIDER,
    providerUserId: user.email,
  });
}

async function registerMockEmailUser(input: EmailPasswordAuthInput) {
  const email = normalizeEmail(input.email);
  const existingUser = mockDb.passwordUsers.find((user) => user.email === email);

  if (existingUser) {
    throw badRequest(ERROR_MESSAGES.USER_ALREADY_EXISTS);
  }

  const user = {
    displayName: getEmailDisplayName(input),
    email,
    id: `mock-user-email-${hashToken(email).slice(0, 12)}`,
    passwordHash: await bcrypt.hash(input.password, PASSWORD_SALT_ROUNDS),
  };

  mockDb.passwordUsers.push(user);
  setMockEmailUser(user);

  return createMockTokenPair(true);
}

async function loginMockEmailUser(input: EmailPasswordAuthInput) {
  const email = normalizeEmail(input.email);
  const user = mockDb.passwordUsers.find((item) => item.email === email);

  if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
    throw unauthorized(ERROR_MESSAGES.INVALID_EMAIL_OR_PASSWORD);
  }

  setMockEmailUser(user);

  return createMockTokenPair(false);
}
