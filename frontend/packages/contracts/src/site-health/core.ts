import { z } from 'zod';

export const responseObject = <Shape extends z.ZodRawShape>(shape: Shape) => z.object(shape);
export const uuid = () => z.uuid();
