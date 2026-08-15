import { Prisma } from '@prisma/client';

import { env } from '../config/env.js';
import { prisma } from '../config/prisma.js';
import { ERROR_CODES, ERROR_MESSAGES } from '../constants/error.constants.js';
import { CURRENT_TERMS_VERSION } from '../constants/legal.constants.js';
import { HttpError, badRequest, notFound } from '../utils/http-error.js';

export const REPORT_RESPONSE_HOURS = 24;
export const REPORT_REMINDER_HOURS = 20;

export const MODERATION_TARGET_TYPES = [
  'user',
  'sound_pin',
  'recap',
  'travel_room_moment',
  'travel_room_comment',
  'mate_request',
] as const;

export type ModerationTargetType = (typeof MODERATION_TARGET_TYPES)[number];

const blockedCompactTerms = [
  '씨발',
  '시발',
  '병신',
  '개새끼',
  '죽어',
  '자살해',
  'nude',
  'porn',
  'kill yourself',
];

const contactPatterns = [
  /(?:https?:\/\/|www\.)\S+/iu,
  /[\w.+-]+@[\w.-]+\.[a-z]{2,}/iu,
  /(?:\+?82[- .]?)?0?1[016789][- .]?\d{3,4}[- .]?\d{4}/u,
  /(?:카카오톡|카톡|텔레그램|telegram|line)\s*(?:아이디|id|:)?\s*[a-z0-9_.-]{3,}/iu,
];

function normalizeCompact(value: string) {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('ko-KR')
    .replace(/[\s\p{P}\p{S}_]+/gu, '');
}

export function inspectUserText(value: string) {
  const trimmed = value.trim();
  const compact = normalizeCompact(trimmed);
  const matchedTerm = blockedCompactTerms.find((term) =>
    compact.includes(normalizeCompact(term)),
  );

  if (matchedTerm) {
    return { allowed: false as const, reason: 'objectionable_language' };
  }

  if (contactPatterns.some((pattern) => pattern.test(trimmed))) {
    return { allowed: false as const, reason: 'external_contact' };
  }

  if (/(.)\1{7,}/u.test(compact)) {
    return { allowed: false as const, reason: 'repeated_spam' };
  }

  return { allowed: true as const };
}

export function assertUserTextAllowed(fields: Record<string, string | undefined>) {
  for (const [field, value] of Object.entries(fields)) {
    if (!value?.trim()) {
      continue;
    }

    const result = inspectUserText(value);

    if (!result.allowed) {
      throw new HttpError(422, ERROR_CODES.CONTENT_REJECTED, ERROR_MESSAGES.CONTENT_REJECTED, {
        field,
        reason: result.reason,
      });
    }
  }
}

async function resolveTarget(input: {
  requestId?: string;
  targetContentId?: string;
  targetPinId?: string;
  targetType: ModerationTargetType;
  targetUserId?: string;
}) {
  if (input.targetType === 'sound_pin') {
    const pinId = input.targetContentId ?? input.targetPinId;
    const pin = pinId ? await prisma.soundMapPin.findUnique({ where: { id: pinId } }) : null;
    if (!pin) throw notFound('신고할 사운드 핀을 찾을 수 없습니다.');
    return {
      targetUserId: pin.userId,
      targetContentId: pin.id,
      snapshot: {
        id: pin.id,
        placeName: pin.placeName,
        track: pin.trackSnapshot,
        visibility: pin.visibility,
      },
    };
  }

  if (input.targetType === 'recap') {
    const recap = input.targetContentId
      ? await prisma.recap.findUnique({ where: { id: input.targetContentId } })
      : null;
    if (!recap) throw notFound('신고할 리캡을 찾을 수 없습니다.');
    return {
      targetUserId: recap.userId,
      targetContentId: recap.id,
      snapshot: {
        id: recap.id,
        title: recap.title,
        placeName: recap.placeName,
        backgroundImageUrl: recap.backgroundImageUrl,
        visibility: recap.visibility,
      },
    };
  }

  if (input.targetType === 'travel_room_moment') {
    const moment = input.targetContentId
      ? await prisma.travelRoomMoment.findUnique({ where: { id: input.targetContentId } })
      : null;
    if (!moment) throw notFound('신고할 공동 리캡을 찾을 수 없습니다.');
    return {
      targetUserId: moment.userId,
      targetContentId: moment.id,
      snapshot: { id: moment.id, note: moment.note, placeName: moment.placeName },
    };
  }

  if (input.targetType === 'travel_room_comment') {
    const comment = input.targetContentId
      ? await prisma.travelRoomMomentComment.findUnique({ where: { id: input.targetContentId } })
      : null;
    if (!comment) throw notFound('신고할 댓글을 찾을 수 없습니다.');
    return {
      targetUserId: comment.userId,
      targetContentId: comment.id,
      snapshot: { id: comment.id, body: comment.body, momentId: comment.momentId },
    };
  }

  if (input.targetType === 'mate_request') {
    const requestId = input.targetContentId ?? input.requestId;
    const request = requestId
      ? await prisma.travelMateRequest.findUnique({ where: { id: requestId } })
      : null;
    if (!request) throw notFound('신고할 동행 요청을 찾을 수 없습니다.');
    return {
      targetUserId: request.requesterId,
      targetContentId: request.id,
      snapshot: {
        id: request.id,
        messageTemplate: request.messageTemplate,
        requesterId: request.requesterId,
        status: request.status,
      },
    };
  }

  if (!input.targetUserId) {
    throw badRequest('신고할 사용자가 필요합니다.');
  }

  const user = await prisma.user.findUnique({
    where: { id: input.targetUserId },
    select: { displayName: true, id: true },
  });
  if (!user) throw notFound('신고할 사용자를 찾을 수 없습니다.');

  return {
    targetUserId: user.id,
    targetContentId: undefined,
    snapshot: user,
  };
}

async function notifyModeration(payload: Record<string, unknown>) {
  if (env.MODERATION_ALERT_MODE === 'cloud_logging') {
    console.warn(JSON.stringify({
      severity: 'WARNING',
      source: 'soundlog_moderation',
      ...payload,
    }));
    return true;
  }

  if (!env.MODERATION_ALERT_WEBHOOK_URL) {
    return false;
  }

  try {
    const message = [
      '[Soundlog moderation]',
      typeof payload.event === 'string' ? payload.event : 'new_event',
      typeof payload.reportId === 'string' ? `report=${payload.reportId}` : undefined,
      typeof payload.dueAt === 'string' ? `due=${payload.dueAt}` : undefined,
    ]
      .filter(Boolean)
      .join(' ');
    const response = await fetch(env.MODERATION_ALERT_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        content: message,
        source: 'soundlog',
        text: message,
        ...payload,
      }),
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch (error) {
    console.error('Failed to send moderation alert', error);
    return false;
  }
}

async function hideTarget(
  client: Prisma.TransactionClient,
  targetType: string,
  targetContentId?: string | null,
) {
  if (!targetContentId) return;

  if (targetType === 'sound_pin') {
    await client.soundMapPin.deleteMany({ where: { id: targetContentId } });
  } else if (targetType === 'recap') {
    await client.recap.updateMany({
      where: { id: targetContentId },
      data: { moderationStatus: 'rejected', visibility: 'private' },
    });
  } else if (targetType === 'travel_room_moment') {
    await client.travelRoomMoment.updateMany({
      where: { id: targetContentId },
      data: { moderationStatus: 'rejected' },
    });
  } else if (targetType === 'travel_room_comment') {
    await client.travelRoomMomentComment.updateMany({
      where: { id: targetContentId },
      data: { moderationStatus: 'rejected' },
    });
  } else if (targetType === 'mate_request') {
    await client.travelMateRequest.updateMany({
      where: { id: targetContentId },
      data: { status: 'cancelled' },
    });
  }
}

export const contentModerationService = {
  async listPendingContent(limit: number) {
    const [recaps, moments] = await Promise.all([
      prisma.recap.findMany({
        where: { moderationStatus: 'pending', visibility: 'public' },
        orderBy: { createdAt: 'asc' },
        take: limit,
        select: {
          backgroundImageUrl: true,
          createdAt: true,
          id: true,
          placeName: true,
          title: true,
          userId: true,
        },
      }),
      prisma.momentLog.findMany({
        where: { moderationStatus: 'pending', visibility: 'public' },
        orderBy: { createdAt: 'asc' },
        take: limit,
        select: {
          createdAt: true,
          id: true,
          note: true,
          photoUrl: true,
          placeName: true,
          userId: true,
        },
      }),
    ]);

    return [
      ...recaps.map((recap) => ({ type: 'recap' as const, ...recap })),
      ...moments.map((moment) => ({ type: 'moment_log' as const, ...moment })),
    ]
      .sort((first, second) => first.createdAt.getTime() - second.createdAt.getTime())
      .slice(0, limit);
  },

  async createReport(reporterId: string, input: {
    details?: string;
    reason: string;
    requestId?: string;
    targetContentId?: string;
    targetPinId?: string;
    targetType: ModerationTargetType;
    targetUserId?: string;
  }) {
    assertUserTextAllowed({ details: input.details });
    const target = await resolveTarget(input);

    if (target.targetUserId === reporterId) {
      throw badRequest('자신의 콘텐츠는 신고할 수 없습니다.');
    }

    const existing = await prisma.communityReport.findFirst({
      where: {
        reason: input.reason,
        reporterId,
        status: 'pending',
        targetContentId: target.targetContentId,
        targetType: input.targetType,
        targetUserId: target.targetUserId,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      return { ...existing, notified: false };
    }

    const createdAt = new Date();
    const report = await prisma.communityReport.create({
      data: {
        contentSnapshot: target.snapshot as Prisma.InputJsonValue,
        createdAt,
        details: input.details,
        dueAt: new Date(createdAt.getTime() + REPORT_RESPONSE_HOURS * 60 * 60 * 1000),
        reason: input.reason,
        reporterId,
        requestId: input.requestId,
        targetContentId: target.targetContentId,
        targetPinId: input.targetPinId,
        targetType: input.targetType,
        targetUserId: target.targetUserId,
      },
    });

    const notified = await notifyModeration({
      event: 'community_report_created',
      reportId: report.id,
      reason: report.reason,
      targetType: report.targetType,
      dueAt: report.dueAt.toISOString(),
    });

    return { ...report, notified };
  },

  async createBlockReport(blockerId: string, input: {
    targetContentId?: string;
    targetPinId?: string;
    targetType: ModerationTargetType;
    targetUserId: string;
  }) {
    const target = await resolveTarget({
      targetContentId: input.targetContentId,
      targetPinId: input.targetPinId,
      targetType: input.targetType,
      targetUserId: input.targetUserId,
    });
    const createdAt = new Date();
    const report = await prisma.communityReport.create({
      data: {
        contentSnapshot: {
          action: 'user_blocked',
          content: target.snapshot,
        } as Prisma.InputJsonValue,
        createdAt,
        dueAt: new Date(createdAt.getTime() + REPORT_RESPONSE_HOURS * 60 * 60 * 1000),
        reason: 'blocked_by_user',
        reporterId: blockerId,
        targetContentId: input.targetContentId,
        targetPinId: input.targetPinId,
        targetType: input.targetType,
        targetUserId: input.targetUserId,
      },
    });
    await notifyModeration({
      event: 'community_user_blocked',
      reportId: report.id,
      targetType: report.targetType,
      dueAt: report.dueAt.toISOString(),
    });
    return report;
  },

  async listReports(input: { limit: number; status?: string }) {
    const now = new Date();
    const reports = await prisma.communityReport.findMany({
      where: input.status ? { status: input.status } : undefined,
      orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }],
      take: input.limit,
    });
    return reports.map((report) => ({
      ...report,
      isOverdue: report.status === 'pending' && report.dueAt <= now,
    }));
  },

  async resolveReport(reportId: string, input: {
    action: 'dismiss' | 'hide_content' | 'hide_and_suspend';
    note: string;
    resolvedBy: string;
  }) {
    return prisma.$transaction(async (transaction) => {
      const report = await transaction.communityReport.findFirst({
        where: { id: reportId, status: 'pending' },
      });
      if (!report) throw notFound('처리 대기 중인 신고를 찾을 수 없습니다.');

      if (input.action !== 'dismiss') {
        await hideTarget(
          transaction,
          report.targetType,
          report.targetContentId ?? report.targetPinId,
        );
      }

      if (input.action === 'hide_and_suspend' && report.targetUserId) {
        await transaction.user.updateMany({
          where: { id: report.targetUserId },
          data: {
            moderationStatus: 'suspended',
            suspendedAt: new Date(),
            suspensionReason: input.note,
          },
        });
        await transaction.refreshToken.deleteMany({ where: { userId: report.targetUserId } });
        await transaction.soundMapPin.deleteMany({ where: { userId: report.targetUserId } });
      }

      return transaction.communityReport.update({
        where: { id: report.id },
        data: {
          resolution: `${input.action}: ${input.note}`,
          resolvedAt: new Date(),
          resolvedBy: input.resolvedBy,
          status: input.action === 'dismiss' ? 'dismissed' : 'resolved',
        },
      });
    });
  },

  async sweepReportDeadlines() {
    const now = new Date();
    const reminderThreshold = new Date(
      now.getTime() - REPORT_REMINDER_HOURS * 60 * 60 * 1000,
    );
    const [reminderReports, overdueReports] = await Promise.all([
      prisma.communityReport.findMany({
        where: {
          status: 'pending',
          reminderSentAt: null,
          overdueSentAt: null,
          createdAt: { lte: reminderThreshold },
          dueAt: { gt: now },
        },
      }),
      prisma.communityReport.findMany({
        where: {
          status: 'pending',
          overdueSentAt: null,
          dueAt: { lte: now },
        },
      }),
    ]);

    for (const report of reminderReports) {
      const notified = await notifyModeration({
        event: 'community_report_reminder',
        reportId: report.id,
        dueAt: report.dueAt.toISOString(),
      });
      if (notified) {
        await prisma.communityReport.update({
          where: { id: report.id },
          data: { reminderSentAt: now },
        });
      }
    }

    for (const report of overdueReports) {
      const notified = await notifyModeration({
        event: 'community_report_overdue',
        reportId: report.id,
        dueAt: report.dueAt.toISOString(),
      });
      if (notified) {
        await prisma.communityReport.update({
          where: { id: report.id },
          data: { overdueSentAt: now },
        });
      }
    }

    return {
      overdue: await prisma.communityReport.count({
        where: { status: 'pending', dueAt: { lte: now } },
      }),
      overdueNotificationsAttempted: overdueReports.length,
      remindersAttempted: reminderReports.length,
    };
  },
};
