import type { Prisma } from '@prisma/client';

import { env } from '../config/env.js';
import { prisma } from '../config/prisma.js';
import { createPublicId } from '../utils/tokens.js';

type CreateDbTestRecordInput = {
  label?: string;
  payload?: Record<string, unknown>;
};

type DbTestRecordDto = {
  createdAt: string;
  database: 'mock-db' | 'postgres';
  id: string;
  label: string;
  payload?: Record<string, unknown>;
  table: 'DbTestRecord';
};

const mockDbTestRecords: DbTestRecordDto[] = [];

function toDto(record: {
  createdAt: Date;
  id: string;
  label: string;
  payload: Prisma.JsonValue | null;
}): DbTestRecordDto {
  return {
    createdAt: record.createdAt.toISOString(),
    database: 'postgres',
    id: record.id,
    label: record.label,
    payload: record.payload && typeof record.payload === 'object'
      ? record.payload as Record<string, unknown>
      : undefined,
    table: 'DbTestRecord',
  };
}

export const devDbTestService = {
  async createRecord(input: CreateDbTestRecordInput) {
    // Defense in depth: this endpoint must never write to the database in
    // production, even if it were ever reachable there (e.g. misconfigured
    // routing). The route itself is also not registered in production.
    if (env.NODE_ENV === 'production') {
      throw new Error('devDbTestService.createRecord is disabled in production.');
    }

    const label = input.label ?? 'swagger-db-test';
    const payload = input.payload ?? {};

    if (env.USE_MOCK_DB) {
      const record: DbTestRecordDto = {
        createdAt: new Date().toISOString(),
        database: 'mock-db',
        id: createPublicId('dbtest'),
        label,
        payload,
        table: 'DbTestRecord',
      };

      mockDbTestRecords.push(record);
      return record;
    }

    const record = await prisma.dbTestRecord.create({
      data: {
        label,
        payload: payload as Prisma.InputJsonValue,
      },
    });

    return toDto(record);
  },
};
