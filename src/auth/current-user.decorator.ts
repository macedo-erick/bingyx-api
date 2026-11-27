import { type ExecutionContext, UnauthorizedException, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';

import type { AuthenticatedUser } from './jwt.guard';

export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<Request>();
  const sub = request.user?.sub;

  if (sub === undefined) {
    throw new UnauthorizedException();
  }

  return sub;
});

export const CurrentUserProfile = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const user = context.switchToHttp().getRequest<Request>().user;

    if (user === undefined) {
      throw new UnauthorizedException();
    }

    return user;
  },
);
