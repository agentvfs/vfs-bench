/**
 * The OCR fake's kit config: Claw-Eval's OCR service
 * (mock_services/ocr/server.py), which every `ocr_*` service runs, on
 * Mirage's integ kit.
 */
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { serviceConfig } from '../claweval/store.ts'
import type { PrismaClient } from './client/index.js'

export const config = serviceConfig('claweval_ocr', dirname(fileURLToPath(import.meta.url)))

export type C = PrismaClient
