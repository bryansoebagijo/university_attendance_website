import type { Prisma } from "@prisma/client";

/** Columns needed to build the public user shape (never the password hash). */
export const userSelect = {
  id: true,
  email: true,
  name: true,
  nip: true,
  role: true,
  unit: true,
  annualQuota: true,
  active: true,
  locale: true,
  theme: true,
  mustChangePassword: true,
  photo: { select: { updatedAt: true } },
} satisfies Prisma.UserSelect;

type UserRow = Prisma.UserGetPayload<{ select: typeof userSelect }>;

export function photoUrl(userId: string, updatedAt: Date) {
  // ?v changes on every upload, so browsers can cache the image safely.
  return `/api/users/${encodeURIComponent(userId)}/photo?v=${updatedAt.getTime()}`;
}

export function toUserDto(u: UserRow) {
  const { photo, ...rest } = u;
  return { ...rest, photoUrl: photo ? photoUrl(u.id, photo.updatedAt) : null };
}

export type UserDto = ReturnType<typeof toUserDto>;
