import { z } from 'zod';

export const actionStatusSchema = z.enum(['open', 'in_progress', 'done', 'dismissed']);
export type ActionStatus = z.infer<typeof actionStatusSchema>;

export const actionMeasurementSchema = z.enum(['measuring', 'verified']);
export type ActionMeasurement = z.infer<typeof actionMeasurementSchema>;

export const ACTION_STATUS_ANY = 'any';
