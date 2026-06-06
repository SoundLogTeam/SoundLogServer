import { env } from '../config/env.js';
import { mockSoundlogService } from './mock-soundlog.service.js';
import { soundlogService } from './soundlog.service.js';

export const apiService = env.USE_MOCK_DB ? mockSoundlogService : soundlogService;

