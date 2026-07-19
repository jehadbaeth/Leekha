import { z } from 'zod';

// Low-level card/seat primitives shared by the Leekha schema (schema.ts) and the
// Trix schema (trix.ts). Kept in their own module so the two can both import
// them without a circular dependency.

export const SuitSchema = z.enum(['S', 'H', 'D', 'C']);
export const RankSchema = z.union([
  z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6), z.literal(7),
  z.literal(8), z.literal(9), z.literal(10), z.literal(11), z.literal(12), z.literal(13), z.literal(14),
]);
export const CardSchema = z.object({ suit: SuitSchema, rank: RankSchema });
export const SeatSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
export const BotLevelSchema = z.enum(['easy', 'medium', 'hard', 'insane']);
